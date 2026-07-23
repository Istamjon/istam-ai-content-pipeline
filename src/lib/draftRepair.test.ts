import {
  looksComplete,
  repairTruncation,
  stripUnsupportedNumbers,
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
});
