import {
  dailyRotationOffset,
  formatRotationOrder,
  orderSlotsForDailyRotation,
} from "./keyRotation.js";

describe("keyRotation", () => {
  it("dailyRotationOffset is stable for same day and in range", () => {
    const a = dailyRotationOffset(5, "nanobanana");
    const b = dailyRotationOffset(5, "nanobanana");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(5);
  });

  it("orderSlotsForDailyRotation prefers higher remaining", () => {
    const slots = [
      { label: "a", providerKey: "a", apiKey: "ka" },
      { label: "b", providerKey: "b", apiKey: "kb" },
      { label: "c", providerKey: "c", apiKey: "kc" },
    ];
    const rem: Record<string, number> = { a: 0, b: 3, c: 1 };
    const ordered = orderSlotsForDailyRotation(
      slots,
      (s) => rem[s.label] ?? 0,
      "test-salt",
    );
    expect(ordered[0].label).toBe("b");
    expect(ordered.map((s) => s.label)).toContain("a");
    expect(formatRotationOrder(ordered, (l) => rem[l] ?? 0)).toMatch(/b\(r3\)/);
  });
});
