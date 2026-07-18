import {
  stripMarkdownNoise,
  stripSourceIntros,
} from "./contentClean.js";

describe("stripMarkdownNoise", () => {
  it("removes **bold** markers and keeps words", () => {
    expect(stripMarkdownNoise("1. **Background execution:** uzoq vazifa")).toBe(
      "1. Background execution: uzoq vazifa",
    );
    expect(stripMarkdownNoise("**Nima uchun bu muhim?**\nKeyingi gap.")).toBe(
      "Nima uchun bu muhim?\nKeyingi gap.",
    );
  });

  it("removes __bold__ and leftover stars", () => {
    expect(stripMarkdownNoise("__muhim__ narsa")).toBe("muhim narsa");
    expect(stripMarkdownNoise("qisman ** ochiq")).toBe("qisman ochiq");
  });

  it("unwraps inline code backticks (platforms show them literally)", () => {
    const out = stripMarkdownNoise(
      "Parametr: `background: true` ishlating.",
    );
    expect(out).toContain("background: true");
    expect(out).not.toContain("`");
    expect(out).not.toContain("**");
  });

  it("cleans realistic post snippet", () => {
    const raw = `1. **Background execution:** Uzoq vazifa. \`background: true\` ishlating.

**Nima uchun bu muhim?**
Javob shu.`;
    const out = stripMarkdownNoise(raw);
    expect(out).not.toMatch(/\*\*/);
    expect(out).not.toContain("`");
    expect(out).toMatch(/Background execution:/);
    expect(out).toMatch(/Nima uchun bu muhim\?/);
  });

  it("strips ATX headings and markdown links", () => {
    expect(stripMarkdownNoise("## Asosiy g'oya")).toBe("Asosiy g'oya");
    expect(stripMarkdownNoise("Batafsil: [link](https://x.com)")).toBe(
      "Batafsil: link",
    );
  });

  it("does not destroy snake_case words", () => {
    expect(stripMarkdownNoise("use background_execution flag")).toBe(
      "use background_execution flag",
    );
  });
});

describe("stripSourceIntros", () => {
  it("still strips source intros", () => {
    expect(
      stripSourceIntros("Yangi Skywork AI maqolasi: Agentlar haqida"),
    ).toMatch(/Agentlar/i);
  });
});
