/**
 * The identity image chain has one job that is easy to get wrong and expensive
 * to debug: telling you WHY it fell through to the diagram provider.
 *
 * `image_provider_usage` counts successes only, so it can never distinguish a
 * provider that fails every time from one that was never called. That is what
 * made a real run undiagnosable. These tests pin the one-line decision trail
 * that `generateImageBuffer` emits on every exit path instead.
 *
 * Keys are cleared BEFORE the module is imported so the chain resolves to
 * "not configured" and no provider is ever contacted. This matters: jest.config
 * runs `dotenv/config`, so a developer's real `.env` would otherwise put live
 * keys into process.env and these tests would hit the real APIs.
 *
 * Console is captured by direct assignment rather than `jest.spyOn` — this
 * repo's ESM preset does not expose the `jest` object, and no other test here
 * uses it.
 */

/** Type-only import — erased at compile time, so it does not load env.ts early. */
type GenerateFn = typeof import("./imagePipeline.js")["generateImageBuffer"];

/** Every env var any image provider reads a key from. */
const KEY_VARS = [
  "UNOROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_API_KEY_2",
  "GEMINI_API_KEY_3",
  "GEMINI_API_KEYS",
  "NANOBANANA_API_KEYS",
  "SKYWORK_API_KEY",
  "SKYWORK_API_KEY_2",
  "SKYWORK_API_KEY_3",
  "SKYWORK_API_KEY_4",
  "SKYWORK_API_KEY_5",
  "SKYWORK_API_KEYS",
  "XKIRO_API_KEY",
  "XKIRO_API_KEY_2",
  "XKIRO_API_KEY_3",
  "XKIRO_API_KEYS",
];

describe("imagePipeline decision trail", () => {
  let generate: GenerateFn;
  const saved: Record<string, string | undefined> = {};
  const captured: string[] = [];
  const realLog = console.log;
  const realWarn = console.warn;

  beforeAll(async () => {
    for (const k of KEY_VARS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    ({ generateImageBuffer: generate } = await import("./imagePipeline.js"));
  });

  afterAll(() => {
    for (const k of KEY_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  beforeEach(() => {
    captured.length = 0;
    const capture =
      (): ((...args: unknown[]) => void) =>
      (...args: unknown[]) => {
        captured.push(args.map((a) => String(a)).join(" "));
      };
    console.log = capture();
    console.warn = capture();
  });

  afterEach(() => {
    console.log = realLog;
    console.warn = realWarn;
  });

  /** The single line an operator greps for in the deploy log. */
  const chainLine = (): string => {
    const line = captured.find((s) => s.includes("[imagePipeline] chain:"));
    if (!line) {
      throw new Error(
        "no `[imagePipeline] chain:` line was logged — the decision trail is gone",
      );
    }
    return line;
  };

  it("names every provider that was skipped, and why", async () => {
    await expect(generate("a cover prompt")).rejects.toThrow(
      /All image providers failed/,
    );
    const line = chainLine();
    expect(line).toContain("unorouter=not-configured");
    expect(line).toContain("nanobanana=not-configured");
    expect(line).toContain("skywork=not-configured");
    expect(line).toContain("xkiro=not-configured");
  });

  it("keeps the trail on one line, so a truncated log tail still shows it", async () => {
    await expect(generate("a cover prompt")).rejects.toThrow();
    // The ops workflow printed only the last 15 lines of the container log.
    // A multi-line trail would have been the first thing to scroll away.
    expect(chainLine()).not.toContain("\n");
  });

  it("records each provider once, in chain order", async () => {
    await expect(generate("a cover prompt")).rejects.toThrow();
    const trail = chainLine().replace("[imagePipeline] chain:", "");
    const beforeArrow = trail.split("→")[0];
    const names = beforeArrow
      .trim()
      .split(/\s+/)
      .map((entry) => entry.split("=")[0]);
    expect(names).toEqual(["unorouter", "nanobanana", "skywork", "xkiro"]);
  });

  it("ends the trail with the provider that actually produced the cover", async () => {
    await expect(generate("a cover prompt")).rejects.toThrow();
    // Nothing produced a cover here, so the terminal marker is `none`.
    // On a success path the same slot names the winning provider.
    expect(chainLine()).toMatch(/→ none$/);
  });
});
