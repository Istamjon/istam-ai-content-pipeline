import {
  PLATFORM_RETRY_DELAYS_MS,
  platformRetryDelays,
  totalRetryBudgetMs,
} from "./retryBackoff.js";

describe("retryBackoff", () => {
  it("waits long enough for a transient blip to clear", () => {
    // The incident: a sub-2-minute Meta-only connection failure. The old single
    // 4s retry could not survive it.
    expect(totalRetryBudgetMs()).toBeGreaterThan(60_000);
  });

  it("is a strictly increasing backoff", () => {
    const delays = platformRetryDelays();
    expect(delays.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it("stays well inside the gap between scheduler slots", () => {
    // CRON_MIN_GAP_MINUTES defaults to 150 (9,000,000 ms); the retry pass must
    // never eat into the next slot.
    expect(totalRetryBudgetMs()).toBeLessThan(5 * 60_000);
  });

  it("hands out a copy, so callers cannot mutate the schedule", () => {
    const first = platformRetryDelays();
    first.push(999);
    expect(platformRetryDelays()).toEqual([...PLATFORM_RETRY_DELAYS_MS]);
  });
});
