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
const SLOT_MAX_RETRIES = 3;
/** Wait before re-trying a slot that produced no successful publish. */
const SLOT_RETRY_MS = 18 * 60 * 1000;
/** How many successful multi-platform publishes we aim for per local day. */
const DAILY_MIN_PUBLISHES = 1;

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
  /** Hard cap so a hung scrape/image provider cannot block all day slots. */
  const PIPELINE_TIMEOUT_MS = 18 * 60 * 1000;

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
      const invokePromise = graph.invoke(createEmptyState(), graphInvokeConfig);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Pipeline timeout after ${Math.round(PIPELINE_TIMEOUT_MS / 60000)}m (${reason})`,
            ),
          );
        }, PIPELINE_TIMEOUT_MS);
      });
      const result = await Promise.race([invokePromise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
      });
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
      return { attempted: true, published: false };
    } finally {
      running = false;
    }
  };

  if (env.CRON_RANDOM) {
    startGuaranteedDailyScheduler(runOnce);
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
 * Guaranteed daily algorithm (best for free-tier + multi-platform):
 *
 * 1) Random times inside the day window (natural cadence)
 * 2) SERIAL processing — never pile catch-up slots on top of a running pipeline
 * 3) Missed slots after restart → process earliest first, then next (queue)
 * 4) No-publish → retry slot (up to SLOT_MAX_RETRIES) with backoff
 * 5) Daily guarantee: if zero publishes by late afternoon, force one extra run
 * 6) Slot marked fired only after successful publish (or retries exhausted)
 */
function startGuaranteedDailyScheduler(
  runOnce: (reason: string) => Promise<RunOutcome>,
): void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const slotRetries = new Map<string, number>();
  /** FIFO of slots waiting while pipeline is busy or for serial catch-up */
  const pendingQueue: string[] = [];
  let processingQueue = false;
  let publishesToday = 0;
  let guaranteeArmed = false;

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

  const enqueueSlot = (t: string): void => {
    if (isSlotFired(t)) return;
    if (pendingQueue.includes(t)) return;
    pendingQueue.push(t);
    void drainQueue();
  };

  const maxSlotsToday = (): number => {
    const s = getOrCreateTodaySchedule();
    return Math.max(1, s.times?.length || env.CRON_SLOTS_MAX);
  };

  const fireSlotDirect = async (t: string, reason: string): Promise<void> => {
    if (isSlotFired(t)) return;
    // Hard day cap: never run more successful pipelines than planned slots
    if (publishesToday >= maxSlotsToday()) {
      markSlotFired(t);
      console.log(
        `[Scheduler] slot ${t} skipped — day post cap reached (${publishesToday}/${maxSlotsToday()})`,
      );
      return;
    }
    try {
      const outcome = await runOnce(reason);
      if (!outcome.attempted) {
        // Busy — re-queue without burning retries
        console.warn(
          `[Scheduler] slot ${t} busy — queue again in 3 min (${reason})`,
        );
        armTimeout(3 * 60 * 1000, () => enqueueSlot(t));
        return;
      }
      if (outcome.published) {
        markSlotFired(t);
        publishesToday += 1;
        console.log(
          `[Scheduler] slot ${t} published — marked fired (dayOk=${publishesToday}/${maxSlotsToday()})`,
        );
        // Drop remaining catch-up if we already filled today's plan
        if (publishesToday >= maxSlotsToday()) {
          pendingQueue.length = 0;
          console.log(
            `[Scheduler] Day plan complete (${publishesToday} publishes) — cleared catch-up queue`,
          );
        }
        return;
      }
      const n = (slotRetries.get(t) || 0) + 1;
      slotRetries.set(t, n);
      if (n <= SLOT_MAX_RETRIES) {
        const mins = Math.round(SLOT_RETRY_MS / 60000);
        console.warn(
          `[Scheduler] slot ${t} no publish — retry ${n}/${SLOT_MAX_RETRIES} in ~${mins} min`,
        );
        armTimeout(SLOT_RETRY_MS, () => enqueueSlot(t));
      } else {
        markSlotFired(t);
        console.warn(
          `[Scheduler] slot ${t} exhausted ${SLOT_MAX_RETRIES} retries with no publish — marked fired`,
        );
      }
    } catch (e) {
      console.warn(`[Scheduler] slot ${t} failed (not marked fired):`, e);
    }
  };

  const drainQueue = async (): Promise<void> => {
    if (processingQueue) return;
    processingQueue = true;
    try {
      while (pendingQueue.length > 0) {
        const t = pendingQueue.shift()!;
        if (isSlotFired(t)) continue;
        await fireSlotDirect(t, `queue ${t}`);
      }
    } finally {
      processingQueue = false;
    }
  };

  const armDailyGuarantee = (schedule: DailySchedule): void => {
    if (guaranteeArmed) return;
    guaranteeArmed = true;
    // Force at least one publish attempt late in the window if day is empty
    const endH = env.CRON_WINDOW_END_HOUR;
    const guaranteeHhmm = `${String(Math.max(env.CRON_WINDOW_START_HOUR, endH - 2)).padStart(2, "0")}:15`;
    const ms = msUntilLocalHhmm(guaranteeHhmm);
    if (ms < 0) {
      // Already past guarantee time — if nothing published yet, enqueue soon
      armTimeout(5 * 60 * 1000, () => {
        if (publishesToday < DAILY_MIN_PUBLISHES) {
          console.warn(
            `[Scheduler] DAILY GUARANTEE (late): 0 publishes today — force run`,
          );
          void runOnce("daily-guarantee").then((o) => {
            if (o.published) publishesToday += 1;
          });
        }
      });
      return;
    }
    armTimeout(ms, () => {
      if (publishesToday >= DAILY_MIN_PUBLISHES) {
        console.log(
          `[Scheduler] Daily guarantee skip — already published ${publishesToday} today`,
        );
        return;
      }
      console.warn(
        `[Scheduler] DAILY GUARANTEE ${guaranteeHhmm}: 0 publishes — force pipeline`,
      );
      void runOnce("daily-guarantee").then((o) => {
        if (o.published) {
          publishesToday += 1;
        } else if (!o.published && o.attempted) {
          // One more shot after backoff
          armTimeout(SLOT_RETRY_MS, () => {
            if (publishesToday < DAILY_MIN_PUBLISHES) {
              void runOnce("daily-guarantee-retry").then((r) => {
                if (r.published) publishesToday += 1;
              });
            }
          });
        }
      });
    });
    console.log(
      `[Scheduler] Daily guarantee armed at ${guaranteeHhmm} (if 0 publishes)`,
    );
  };

  const armDay = (schedule: DailySchedule) => {
    clearTimers();
    slotRetries.clear();
    pendingQueue.length = 0;
    // Fired slots ≈ completed attempts (publish or exhausted retries)
    publishesToday = (schedule.fired || []).length;
    guaranteeArmed = false;

    const lo = Math.min(env.CRON_SLOTS_MIN, env.CRON_SLOTS_MAX);
    const hi = Math.max(env.CRON_SLOTS_MIN, env.CRON_SLOTS_MAX);
    console.log(
      `[Scheduler] Guaranteed-daily mode: ${schedule.date} → ${schedule.times.length} slots ` +
        `(policy ${lo}–${hi}/day): ${schedule.times.join(", ")}`,
    );
    console.log(
      `[Scheduler] Window ${env.CRON_WINDOW_START_HOUR}:00–${env.CRON_WINDOW_END_HOUR}:00 local, ` +
        `gap≥${env.CRON_MIN_GAP_MINUTES}m (adaptive), min publishes/day=${DAILY_MIN_PUBLISHES}, ` +
        `alreadyFired=${publishesToday}`,
    );

    let futureArmed = 0;
    const missed: string[] = [];

    for (const t of schedule.times) {
      if (isSlotFired(t)) {
        console.log(`[Scheduler] slot ${t} already fired today — skip`);
        continue;
      }
      const ms = msUntilLocalHhmm(t);
      if (ms < 0) {
        missed.push(t);
        continue;
      }
      armTimeout(ms, () => enqueueSlot(t));
      const mins = Math.round(ms / 60000);
      console.log(`[Scheduler] Armed ${t} (in ~${mins} min)`);
      futureArmed += 1;
    }

    // Catch-up: at most 1 missed slot on restart (avoids burning all daily limits at once)
    if (missed.length > 0 && publishesToday < schedule.times.length) {
      const catchUp = missed.slice(0, 1);
      console.log(
        `[Scheduler] ${missed.length} missed slot(s) → catch-up only earliest: ${catchUp.join(", ")}` +
          (missed.length > 1
            ? ` (deferred: ${missed.slice(1).join(", ")})`
            : ""),
      );
      for (const t of catchUp) {
        pendingQueue.push(t);
      }
      // Stagger start so container is fully up
      armTimeout(8_000, () => {
        void drainQueue();
      });
      // Space remaining missed slots (not all at once)
      let delay = 45 * 60 * 1000;
      for (const t of missed.slice(1)) {
        if (isSlotFired(t)) continue;
        armTimeout(delay, () => enqueueSlot(t));
        console.log(
          `[Scheduler] Deferred catch-up ${t} in ~${Math.round(delay / 60000)} min`,
        );
        delay += 45 * 60 * 1000;
      }
    } else if (missed.length > 0) {
      console.log(
        `[Scheduler] ${missed.length} missed slot(s) skipped — day already filled (${publishesToday})`,
      );
      for (const t of missed) markSlotFired(t);
    }

    console.log(
      `[Scheduler] ${futureArmed} future + catch-up planned. New plan at local midnight.`,
    );

    armDailyGuarantee(schedule);

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
