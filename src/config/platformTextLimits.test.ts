import {
  splitIntoThreadParts,
  smartTruncate,
  getPlatformTextPolicy,
  platformLimits,
} from "./platformTextLimits.js";
import { formatAllFromCanonical } from "../canonical/formatFromCanonical.js";
import type { CanonicalContent } from "../canonical/types.js";

describe("platformTextLimits", () => {
  it("smartTruncate does not cut mid-word when possible", () => {
    const s =
      "Bu birinchi gap. Ikkinchi gap ancha uzunroq bo'lishi mumkin va chegara ichida qoladi.";
    const t = smartTruncate(s, 40);
    expect(t.length).toBeLessThanOrEqual(40);
    expect(t.endsWith(" ")).toBe(false);
  });

  it("splitIntoThreadParts respects maxLen and maxParts", () => {
    const long = Array.from({ length: 20 }, (_, i) =>
      `Bu ${i + 1}-chi to'liq gap AI agent haqida.`,
    ).join(" ");
    const parts = splitIntoThreadParts(long, 500, 6);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.length).toBeLessThanOrEqual(6);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(500);
      expect(p.trim().length).toBeGreaterThan(0);
    }
  });

  it("policies expose API hard limits", () => {
    expect(getPlatformTextPolicy("telegram").captionHardLimit).toBe(1024);
    expect(getPlatformTextPolicy("threads").strategy).toBe("threads_chain");
    expect(platformLimits.threads).toBe(500);
    expect(platformLimits.x).toBe(280);
  });
});

describe("formatAllFromCanonical", () => {
  const body =
    "Birinchi gap AI agent haqida. " +
    "Ikkinchi gap production pipeline. ".repeat(40) +
    "Yakuniy xulosa: amaliy qadamlarni boshlang.";
  const doc: CanonicalContent = {
    id: "test",
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceUrl: "https://example.com/a",
    title: "LangGraph multi-agent test",
    body,
    language: "uz",
    imagePath: "/tmp/x.png",
    contentHash: "testhash",
  };

  it("keeps every platform under hard limit", () => {
    const f = formatAllFromCanonical(doc, [
      "telegram",
      "linkedin",
      "instagram",
      "threads",
      "x",
      "facebook",
    ]);
    expect(f.linkedin!.text.length).toBeLessThanOrEqual(3000);
    expect(f.instagram!.text.length).toBeLessThanOrEqual(2200);
    expect(f.x!.text.length).toBeLessThanOrEqual(280);
    expect(f.facebook!.text.length).toBeLessThanOrEqual(10000);
    if (f.telegram?.caption) {
      expect(f.telegram.caption.length).toBeLessThanOrEqual(1024);
    }
    expect(f.threads!.parts?.length).toBeGreaterThan(1);
    for (const p of f.threads!.parts || []) {
      expect(p.length).toBeLessThanOrEqual(500);
    }
  });
});
