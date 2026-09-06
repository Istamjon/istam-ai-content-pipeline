import { generateCatchyCoverHeading } from "./coverHeading.js";

describe("generateCatchyCoverHeading", () => {
  it("should respect explicitly provided existingHeading", async () => {
    const res = await generateCatchyCoverHeading({
      title: "Test Title",
      existingHeading: "AI Yangi Davri",
    });
    expect(res).toBe("AI Yangi Davri");
  });

  it("should generate a short, clean cover heading from title and summary", async () => {
    const res = await generateCatchyCoverHeading({
      title: "Anthropic Claude 3.7 Sonnet modelini e'lon qildi",
      summary: "Yangi gibrid fikrlash qobiliyati dasturlash va hisoblashda katta yutuq keltirdi.",
    });
    expect(typeof res).toBe("string");
    expect(res.length).toBeGreaterThan(3);
    expect(res.length).toBeLessThanOrEqual(36);
    // Should not contain quotes or markdown symbols
    expect(res).not.toMatch(/[*"`«»]/);
  });
});
