import { isUnorouterConfigured, canUseUnorouterToday } from "./unorouterImage.js";
import { providerSupportsFaceIdentity } from "./imagePipeline.js";

describe("unorouterImage", () => {
  const originalKey = process.env.UNOROUTER_API_KEY;

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.UNOROUTER_API_KEY = originalKey;
    } else {
      delete process.env.UNOROUTER_API_KEY;
    }
  });

  it("isUnorouterConfigured returns true when UNOROUTER_API_KEY is set", () => {
    process.env.UNOROUTER_API_KEY = "sk-mock-key-for-testing";
    expect(isUnorouterConfigured()).toBe(true);
  });

  it("canUseUnorouterToday returns budget info when key is configured", () => {
    process.env.UNOROUTER_API_KEY = "sk-mock-key-for-testing";
    const budget = canUseUnorouterToday();
    expect(budget.ok).toBe(true);
    expect(typeof budget.remaining).toBe("number");
  });

  it("imagePipeline recognizes unorouter as supporting face identity", () => {
    expect(providerSupportsFaceIdentity("unorouter")).toBe(true);
    expect(providerSupportsFaceIdentity("nanobanana")).toBe(true);
    expect(providerSupportsFaceIdentity("skywork")).toBe(true);
    expect(providerSupportsFaceIdentity("xkiro")).toBe(false);
  });
});
