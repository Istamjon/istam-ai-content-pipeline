/**
 * Guards for the ops tooling that has to diagnose a bad cover AFTER the fact.
 *
 * Context: a one-post run published successfully but the cover came from the
 * diagram provider. Working out why was impossible, for two compounding
 * reasons:
 *
 *   1. `force-one-post.yml` fetched `docker compose logs --tail=120` and then
 *      printed only `tail -n 15` — discarding 105 lines it had already paid to
 *      fetch.
 *   2. The container is recreated a few seconds after the poll loop ends, so the
 *      log printed by that workflow is the ONLY surviving copy. The container
 *      log on the box is gone by the time anyone looks.
 *
 * Together those destroyed the evidence of which identity providers were tried.
 * These assertions are structural on purpose: they are the cheapest way to stop
 * the same evidence loss being reintroduced by a later tidy-up.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ESM: no __dirname. Same idiom the rest of this repo uses.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(repoRoot, rel), "utf8");

describe("force-one-post.yml keeps the evidence it collects", () => {
  const yml = read(".github/workflows/force-one-post.yml");

  it("no longer truncates the poll window to 15 lines", () => {
    // Assert on the code form, not the bare string: the comment above the loop
    // legitimately quotes `tail -n 15` to explain why it was removed.
    expect(yml).not.toMatch(/echo\s+"\$logs"\s*\|\s*tail\s+-n\s+15\b/);
  });

  it("still prints a usable window each poll", () => {
    expect(yml).toMatch(/echo "\$logs" \| tail -n \d+/);
  });

  it("rescues the image chain from the full log, not from a window", () => {
    // A window can always scroll past the interesting lines between two polls.
    expect(yml).toMatch(/docker compose logs 2>&1[\s\S]{0,400}grep -E/);
    expect(yml).toContain("imagePipeline");
  });

  it("rescues the image chain BEFORE the recreate that wipes the log", () => {
    const rescueAt = yml.indexOf("imagePipeline");
    const recreateAt = yml.lastIndexOf("docker compose up -d || true");
    expect(rescueAt).toBeGreaterThan(-1);
    expect(recreateAt).toBeGreaterThan(-1);
    expect(rescueAt).toBeLessThan(recreateAt);
  });
});

describe("the identity provider probe stays read-only", () => {
  const probe = read("scripts/image-provider-probe.cjs");
  const health = read(".github/workflows/vds-health.yml");

  it("is wired into the health check", () => {
    expect(health).toContain("image-provider-probe.cjs");
    expect(health).toMatch(/docker compose exec -T pipeline node \/tmp\/image-provider-probe\.cjs/);
  });

  it("never touches an image endpoint, so it cannot spend quota", () => {
    // The whole point is to answer "is this key alive?" for free. If it ever
    // grows an image call it stops being safe to run on every health check.
    // Match the endpoint forms, not the words: the probe's own comments name
    // these endpoints to explain that it deliberately avoids them.
    expect(probe).not.toMatch(/\/images\/(edits|generations)/);
    expect(probe).not.toMatch(/:generateContent/);
  });

  it("does not print a full API key", () => {
    // Only the last 6 characters may reach the log. Scope this to console.log
    // call sites: the probe legitimately uses the raw key to build an
    // `Authorization` header and a query string, and neither is ever logged.
    expect(probe).toContain("slice(-6)");
    const logCalls = probe.match(/console\.log\([\s\S]*?\);/g) ?? [];
    expect(logCalls.length).toBeGreaterThan(0);
    for (const call of logCalls) {
      expect(call).not.toMatch(/\$\{\s*(?:key|apiKey)\s*\}/);
    }
  });
});
