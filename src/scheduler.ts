import { graph, graphInvokeConfig } from "./agent/graph.js";
import cron from "node-cron";
import { env } from "./config/env.js";
import { createEmptyState } from "./agent/state.js";
import {
  getOrCreateTodaySchedule,
  markSlotFired,
  isSlotFired,
  nowLocalHhmm,
  msUntilLocalHhmm,
  msUntilNextLocalMidnight,
  type DailySchedule,
} from "./lib/dailySchedule.js";
import { checkAndAlertTokenExpiry } from "./oauth/tokenExpiryAlert.js";

/** Max delayed retries when a slot runs but nothing publishes (quality fail, etc.). */
const SLOT_MAX_RETRIES = 2;
/** Wait before re-trying a slot that produced no successful publish. */
const SLOT_RETRY_MS = 25 * 60 * 1000;

type RunOutcome = {
  /** Pipeline actually started and finished (not skipped due to busy). */
  attempted: boolean;
  /** At least one platform published successfully. */
  published: boolean;
};

/**
 * Parse "HH:MM" → cron "M H * * *" (server local time).
 */
function timeToCron(hhmm: string): string | null {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${min} ${h} * * *`;
}

function hasSuccessfulPublish(
  publishResults: Array<{ status?: string }> | undefined,
): boolean {
  return (publishResults ?? []).some((p) => p.status === "success");
}

export function startScheduler(): void {
  let running = false;

  /** Token expiry → Telegram (≤ TOKEN_ALERT_DAYS). Deduped per day. */
  const runTokenAlert = async (reason: string): Promise<void> => {
    try {
      const r = await checkAndAlertTokenExpiry();
      if (r.alerted > 0) {
        console.log(
          `[Scheduler] Token alert (${reason}): sent=${r.alerted} checked=${r.checked}`,
        );
      }
    } catch (e) {
      console.warn(`[Scheduler] Token alert failed (${reason}):`, e);
    }
  };

  /**
   * Run the content pipeline once.
   * - attempted=false → busy, do not consume the slot
   * - published=true  → mark slot fired
   * - attempted && !published → leave unfired / schedule retry (caller decides)
   */
  const runOnce = async (reason: string): Promise<RunOutcome> => {
    if (running) {
      console.log(`[Scheduler] Previous run still in progress, skipping (${reason})`);
      return { attempted: false, published: false };
    }
    running = true;
    console.log(
      `[Scheduler] Running content pipeline (${reason}) at ${new Date().toISOString()}`,
    );
    try {
      await runTokenAlert(reason);
      const result = await graph.invoke(createEmptyState(), graphInvokeConfig);
      const published = hasSuccessfulPublish(result.publishResults);
      console.log("[Scheduler] Pipeline completed");
      console.log(
        "[Scheduler] Summary:",
        JSON.stringify(
          {
            articles: result.newArticles?.length ?? 0,
            index: result.articleIndex,
            quality: result.quality,
            publish: result.publishResults,
            published,
            errors: result.errors,
            title: result.current?.title,
            hasImage: Boolean(result.current?.imagePath),
          },
          null,
          2,
        ),
      );
      return { attempted: true, published };
    } catch (error) {
      console.error("[Scheduler] Pipeline failed:", error);
      // Hard crash: treat as attempted but not published so slot can retry.
      return { attempted: true, published: false };
    } finally {
      running = false;
    }
  };

  if (env.CRON_RANDOM) {
    startRandomDailyScheduler(runOnce);
  } else {
    startFixedScheduler(runOnce);
  }

  // Daily token check at 09:00 local (even if no content slot fires)
  if (cron.validate("0 9 * * *")) {
    cron.schedule("0 9 * * *", () => {
      void runTokenAlert("daily-09:00");
    });
    console.log(
      `[Scheduler] Token expiry alert: ≤${env.TOKEN_ALERT_DAYS}d → Telegram (daily 09:00 + each pipeline)`,
    );
  }

  // Immediate check on process start (deduped if already sent today)
  void runTokenAlert("startup");

  if (env.CRON_RUN_ON_START) {
    console.log("[Scheduler] CRON_RUN_ON_START=true — firing first run now...");
    void runOnce("startup");
  } else {
    console.log(
      "[Scheduler] Waiting for scheduled slots (set CRON_RUN_ON_START=true for immediate run)",
    );
  }
}

/**
 * Random times every local day (different plan each day).
 * Uses setTimeout for today's remaining slots; rolls over at local midnight.
 *
 * Reliability rules:
 * - Missed (past) unfired slots → catch-up immediately (restart-safe)
 * - Slot marked fired only after at least one successful publish
 * - No-publish runs get up to SLOT_MAX_RETRIES delayed retries
 */
function startRandomDailyScheduler(
  runOnce: (reason: string) => Promise<RunOutcome>,
): void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** How many no-publish retries already scheduled/used for HH:MM today. */
  const slotRetries = new Map<string, number>();

  const clearTimers = () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };

  const armTimeout = (ms: number, fn: () => void): void => {
    const handle = setTimeout(() => {
      timers.delete(handle);
      fn();
    }, ms);
    timers.add(handle);
  };

  const fireSlot = (t: string, reason: string): void => {
    if (isSlotFired(t)) return;
    void (async () => {
      try {
        const outcome = await runOnce(reason);
        if (!outcome.attempted) {
          // Busy — try again soon so the slot is not lost.
          console.warn(
            `[Scheduler] slot ${t} busy — re-queue in 2 min (${reason})`,
          );
          armTimeout(2 * 60 * 1000, () => fireSlot(t, `${reason} requeue`));
          return;
        }
        if (outcome.published) {
          markSlotFired(t);
          console.log(`[Scheduler] slot ${t} published — marked fired`);
          return;
        }
        // Ran but nothing published (quality fail, empty sources, etc.)
        const n = (slotRetries.get(t) || 0) + 1;
        slotRetries.set(t, n);
        if (n <= SLOT_MAX_RETRIES) {
          const mins = Math.round(SLOT_RETRY_MS / 60000);
          console.warn(
            `[Scheduler] slot ${t} no publish — retry ${n}/${SLOT_MAX_RETRIES} in ~${mins} min`,
          );
          armTimeout(SLOT_RETRY_MS, () =>
            fireSlot(t, `random ${t} retry${n}`),
          );
        } else {
          // Avoid infinite loops for a bad content day.
          markSlotFired(t);
          console.warn(
            `[Scheduler] slot ${t} exhausted ${SLOT_MAX_RETRIES} retries with no publish — marked fired`,
          );
        }
      } catch (e) {
        console.warn(`[Scheduler] slot ${t} failed (not marked fired):`, e);
      }
    })();
  };

  const armDay = (schedule: DailySchedule) => {
    clearTimers();
    slotRetries.clear();
    const now = nowLocalHhmm();
    console.log(
      `[Scheduler] Random mode: ${schedule.date} → ${schedule.times.length} slots: ${schedule.times.join(", ")}`,
    );
    console.log(
      `[Scheduler] Window ${env.CRON_WINDOW_START_HOUR}:00–${env.CRON_WINDOW_END_HOUR}:00 local, min gap ${env.CRON_MIN_GAP_MINUTES}m`,
    );

    let armed = 0;
    let catchUpIndex = 0;

    for (const t of schedule.times) {
      if (isSlotFired(t)) {
        console.log(`[Scheduler] slot ${t} already fired today — skip`);
        continue;
      }
      const ms = msUntilLocalHhmm(t);
      if (ms < 0) {
        // Missed while process was down / deploying — catch up (stagger if several).
        const delay = catchUpIndex * 5000;
        catchUpIndex += 1;
        console.log(
          `[Scheduler] slot ${t} missed (${now}) — catch-up in ${Math.round(delay / 1000)}s`,
        );
        armTimeout(delay, () => fireSlot(t, `catch-up ${t}`));
        armed += 1;
        continue;
      }

      armTimeout(ms, () => fireSlot(t, `random ${t}`));
      const mins = Math.round(ms / 60000);
      console.log(`[Scheduler] Armed ${t} (in ~${mins} min)`);
      armed += 1;
    }
    console.log(
      `[Scheduler] ${armed} remaining slot(s) today. New random plan at local midnight.`,
    );

    armTimeout(msUntilNextLocalMidnight(), () => {
      console.log("[Scheduler] Local day rolled — generating new random schedule");
      armDay(getOrCreateTodaySchedule());
    });
  };

  armDay(getOrCreateTodaySchedule());
}

function startFixedScheduler(
  runOnce: (reason: string) => Promise<RunOutcome>,
): void {
  const times = env.CRON_TIMES?.length ? env.CRON_TIMES : [];
  if (times.length > 0) {
    let scheduled = 0;
    for (const t of times) {
      const expr = timeToCron(t);
      if (!expr || !cron.validate(expr)) {
        console.warn(`[Scheduler] Invalid CRON_TIMES entry: "${t}"`);
        continue;
      }
      cron.schedule(expr, () => {
        void runOnce(`slot ${t}`);
      });
      console.log(`[Scheduler] Daily slot: ${t} (local) → cron "${expr}"`);
      scheduled += 1;
    }
    if (scheduled === 0) {
      console.warn(
        "[Scheduler] No valid CRON_TIMES — falling back to interval mode",
      );
      scheduleInterval(runOnce);
    } else {
      console.log(
        `[Scheduler] Fixed mode: ${scheduled} time(s)/day. Run on start=${env.CRON_RUN_ON_START}`,
      );
    }
  } else {
    scheduleInterval(runOnce);
  }
}

function scheduleInterval(
  runOnce: (reason: string) => Promise<RunOutcome>,
): void {
  const interval = env.CRON_INTERVAL_MINUTES;
  const expression = `*/${interval} * * * *`;
  if (!cron.validate(expression)) {
    throw new Error(`Invalid cron expression for interval ${interval}: ${expression}`);
  }
  cron.schedule(expression, () => {
    void runOnce("cron");
  });
  console.log(`[Scheduler] Interval mode: every ${interval} minutes`);
}
