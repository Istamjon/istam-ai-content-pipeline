/**
 * Retry schedule for the post-publish pass.
 *
 * WHY
 * ---
 * The retry pass used to be a single attempt, 4 seconds after the first
 * failure. On 2026-09-23 a transient, Meta-only connection failure took out
 * facebook, instagram and threads for the 16:29 slot. The one retry 4s later
 * landed inside the same blip, after which the slot was marked fired and the
 * three posts were lost for good. Telegram and LinkedIn published fine in that
 * very run, so nothing was wrong with the pipeline or its credentials — it just
 * gave up ~4 seconds too early, and reported only "TypeError: fetch failed".
 *
 * These delays give a blip ~85 seconds to clear. That is affordable: the next
 * scheduler slot is CRON_MIN_GAP_MINUTES (150) away, and the article is only
 * marked seen once, after publishing.
 */
export const PLATFORM_RETRY_DELAYS_MS = [5_000, 20_000, 60_000] as const;

/**
 * A copy of the schedule, so a caller cannot mutate the shared constant.
 */
export function platformRetryDelays(): number[] {
  return [...PLATFORM_RETRY_DELAYS_MS];
}

/**
 * Total wall-clock time the retry pass is willing to spend waiting.
 * Request time is not included.
 */
export function totalRetryBudgetMs(): number {
  return PLATFORM_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
}
