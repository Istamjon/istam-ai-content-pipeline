import { isUnorouterConfigured, canUseUnorouterToday } from "./unorouterImage.js";
import { providerSupportsFaceIdentity } from "./imagePipeline.js";

describe("unorouterImage", () => {
  it("isUnorouterConfigured returns true when UNOROUTER_API_KEY is present", () => {
    expect(isUnorouterConfigured()).toBe(true);
  });

  it("canUseUnorouterToday returns budget info", () => {
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
