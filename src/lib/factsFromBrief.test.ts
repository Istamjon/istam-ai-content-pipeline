/**
 * Grounded-facts handling.
 *
 * The bug this locks down: `ensureFactsSection` used to rebuild the closing
 * "Asosiy faktlar:" block from the analyst brief UNCONDITIONALLY. The analyst
 * brief explicitly allows English technical terms in FACTS, so whole English
 * sentences reached the published post — an Uzbek post went out ending in an
 * English bullet list. The writer's own (in-language) block is the better
 * artefact and is now kept when it is adequate.
 */
import {
  extractFactsFromBrief,
  extractExistingFactsBlock,
  hasFactsSection,
  ensureFactsSection,
} from "./factsFromBrief.js";

const BRIEF = [
  "SUMMARY: Jev haqida qisqa xulosa.",
  "FACTS:",
  "- Jev is a System One model developed by the TypeSafe AI team.",
  "- Jev is up to ~450x cheaper and ~200x faster than comparable LLMs.",
  "- Jev averaged 0.44 seconds per call at $0.00035 per call.",
  "NOTES: some notes",
].join("\n");

const UZ_FACTS = [
  "Jev — TypeSafe AI jamoasi yaratgan System One modeli.",
  "Jev oddiy LLM'larga qaraganda ~450x arzon va ~200x tezroq ishlaydi.",
  "Bitta chaqiruv 0,44 soniya vaqt oladi va $0.00035 turadi.",
].join("\n• ");

describe("extractFactsFromBrief", () => {
  it("pulls the bullets under FACTS: and stops at NOTES:", () => {
    const facts = extractFactsFromBrief(BRIEF);
    expect(facts).toHaveLength(3);
    expect(facts[0]).toContain("System One");
    expect(facts.join(" ")).not.toContain("some notes");
  });

  it("returns nothing when there is no FACTS block", () => {
    expect(extractFactsFromBrief("SUMMARY: nothing here")).toEqual([]);
    expect(extractFactsFromBrief(undefined)).toEqual([]);
  });
});

describe("extractExistingFactsBlock", () => {
  it("reads the writer's own bullets", () => {
    const body = `Kirish.\n\nAsosiy faktlar:\n• ${UZ_FACTS}`;
    expect(extractExistingFactsBlock(body)).toHaveLength(3);
  });

  it("returns nothing when the writer wrote no block", () => {
    expect(extractExistingFactsBlock("Faqat matn.")).toEqual([]);
  });
});

describe("ensureFactsSection", () => {
  it("KEEPS the writer's own block and does not leak the brief's language", () => {
    // The regression: the body is Uzbek and already has 3 Uzbek bullets, while
    // the brief's FACTS are English. The English lines must NOT be pasted in.
    const body = `Jev LangSmith'da paydo bo'ldi.\n\nAsosiy faktlar:\n• ${UZ_FACTS}`;
    const out = ensureFactsSection(body, BRIEF);

    expect(out).toBe(body.trim());
    expect(out).toContain("TypeSafe AI jamoasi yaratgan");
    expect(out).not.toContain("is a System One model developed");
  });

  it("rebuilds from the brief when the post has no facts block", () => {
    const out = ensureFactsSection("Jev haqida qisqa post.", BRIEF);

    expect(hasFactsSection(out)).toBe(true);
    expect(out).toContain("Asosiy faktlar:");
    expect(out).toContain("System One");
    // The original body is preserved above the appended block.
    expect(out.startsWith("Jev haqida qisqa post.")).toBe(true);
  });

  it("rebuilds when the writer's block is too thin to be useful", () => {
    const body =
      "Post matni.\n\nAsosiy faktlar:\n• Faqat bitta fakt shu yerda.";
    const out = ensureFactsSection(body, BRIEF);

    // The thin block is replaced, not kept alongside the rebuilt one.
    expect(out.match(/Asosiy faktlar:/gi)).toHaveLength(1);
    expect(out).toContain("System One");
  });

  it("never invents bullets when the brief has no facts", () => {
    const body = "Post matni.";
    expect(ensureFactsSection(body, "SUMMARY: no facts block")).toBe(body);
    expect(ensureFactsSection(body, undefined)).toBe(body);
  });
});
