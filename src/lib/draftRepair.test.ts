import {
  capDraftLength,
  looksComplete,
  repairTruncation,
  stripUnsupportedNumbers,
  MAX_BODY_CHARS,
  MAX_DRAFT_CHARS,
} from "./draftRepair.js";

describe("draftRepair", () => {
  it("repairTruncation drops mid-word tail", () => {
    const raw =
      "Agentlar zanjiri productionda muhim. Asosiy faktlar:\n• LangGraph ishlatiladi\n• metada";
    const fixed = repairTruncation(raw);
    expect(fixed).toMatch(/LangGraph/);
    expect(fixed).not.toMatch(/metada/);
    expect(looksComplete(fixed)).toBe(true);
  });

  it("stripUnsupportedNumbers removes invented percentages", () => {
    const src = "Designers use AI tools in their workflow.";
    const draft =
      "Dizaynerlar AI ishlatadi. Tadqiqotlarga ko‘ra 92% vulnerabilities topildi.\n• 4x duplication\n• Asosiy fakt: AI yordam beradi.";
    const out = stripUnsupportedNumbers(draft, src);
    expect(out).not.toMatch(/92%/);
    expect(out).not.toMatch(/4x/i);
    expect(out.toLowerCase()).toMatch(/ai/);
  });

  it("keeps numbers present in source", () => {
    const src = "Latency dropped by 40% in production.";
    const draft = "Latency 40% ga tushdi productionda.";
    expect(stripUnsupportedNumbers(draft, src)).toMatch(/40%/);
  });

  describe("capDraftLength", () => {
    // Regression: the cap used to be 2000 while the writer prompt asked for up
    // to 2600, so every draft silently lost its tail before the quality gate ran.
    it("leaves a draft that fits completely untouched", () => {
      const draft = "A".repeat(4400) + ". Tugadi.";
      expect(capDraftLength(draft)).toBe(draft);
    });

    it("keeps a 4400-char draft — the writer prompt's own target", () => {
      const sentences = Array.from(
        { length: 120 },
        (_, i) => `Bu ${i + 1}-jumla va u yetarlicha mazmunga ega.`,
      );
      const draft = sentences.join(" ");
      expect(draft.length).toBeGreaterThan(4400);
      const out = capDraftLength(draft);
      // Nothing below the prompt's hard max may be dropped.
      expect(out.length).toBeGreaterThanOrEqual(4400);
      expect(out.length).toBeLessThanOrEqual(MAX_DRAFT_CHARS);
    });

    it("cuts a runaway draft at a sentence boundary, never mid-word", () => {
      const draft = "Kalimaning oxiri. ".repeat(600);
      const out = capDraftLength(draft);
      expect(out.length).toBeLessThanOrEqual(MAX_DRAFT_CHARS);
      expect(out).toMatch(/[.!?…]$/);
      expect(looksComplete(out)).toBe(true);
    });

    it("keeps the body ceiling far above the plain-text Telegram target", () => {
      expect(MAX_BODY_CHARS).toBeGreaterThanOrEqual(2 * MAX_DRAFT_CHARS);
      expect(MAX_BODY_CHARS).toBeGreaterThan(4000);
    });
  });
});
