import { stripMarkdownNoise, stripSourceIntros } from "./contentClean.js";

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
    const out = stripMarkdownNoise("Parametr: `background: true` ishlating.");
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

/**
 * The writer is now allowed to emit structure, so this cleaner is the only
 * thing standing between a marker and the reader on every plain-text platform.
 * A marker that is not handled here shows up as literal punctuation on
 * LinkedIn/X — which is why the writer used to be banned from markdown outright.
 */
describe("stripMarkdownNoise — structure markers", () => {
  it("removes block quotation markers", () => {
    expect(stripMarkdownNoise("> iqtibos shu yerda")).toBe("iqtibos shu yerda");
    expect(stripMarkdownNoise("Matn.\n> iqtibos")).toBe("Matn.\niqtibos");
  });

  it("removes thematic breaks on their own line", () => {
    expect(stripMarkdownNoise("Bir.\n\n---\n\nIkki.")).toBe("Bir.\n\nIkki.");
    expect(stripMarkdownNoise("Bir.\n\n***\n\nIkki.")).toBe("Bir.\n\nIkki.");
    expect(stripMarkdownNoise("Bir.\n\n___\n\nIkki.")).toBe("Bir.\n\nIkki.");
  });

  it("keeps bullet markers, which read as bullets on every platform", () => {
    // These are wanted output, not noise — the converter turns them into <ul>.
    expect(stripMarkdownNoise("- bir\n- ikki")).toBe("- bir\n- ikki");
    expect(stripMarkdownNoise("• bir\n• ikki")).toBe("• bir\n• ikki");
  });

  it("leaves no literal marker behind in a fully structured post", () => {
    const structured = [
      "## Muammo",
      "",
      "Hujjatlar ko'pligi xaridorlarni qiynaydi.",
      "",
      "## Yechim",
      "",
      "- Parse qilinadi",
      "- Indekslanadi",
      "",
      "---",
      "",
      "> Asosiy xulosa shu.",
      "",
      "Asosiy faktlar:",
      "• LlamaParse ishlatiladi.",
      "• 10–40 ta hujjat.",
    ].join("\n");

    const out = stripMarkdownNoise(structured);

    expect(out).not.toContain("#");
    expect(out).not.toContain(">");
    expect(out).not.toContain("---");
    // ...and the content the reader should see is intact.
    expect(out).toContain("Muammo");
    expect(out).toContain("Parse qilinadi");
    expect(out).toContain("Asosiy xulosa shu.");
    expect(out).toContain("• LlamaParse ishlatiladi.");
  });
});
