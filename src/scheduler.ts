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

export function startScheduler(): void {
  let running = false;

  /** @returns true if a pipeline attempt started (and finished), false if skipped busy */
  const runOnce = async (reason: string): Promise<boolean> => {
    if (running) {
      console.log(`[Scheduler] Previous run still in progress, skipping (${reason})`);
      return false;
    }
    running = true;
    console.log(
      `[Scheduler] Running content pipeline (${reason}) at ${new Date().toISOString()}`,
    );
    try {
      const result = await graph.invoke(createEmptyState(), graphInvokeConfig);
      console.log("[Scheduler] Pipeline completed");
      console.log(
        "[Scheduler] Summary:",
        JSON.stringify(
          {
            articles: result.newArticles?.length ?? 0,
            index: result.articleIndex,
            quality: result.quality,
            publish: result.publishResults,
            errors: result.errors,
            title: result.current?.title,
            hasImage: Boolean(result.current?.imagePath),
          },
          null,
          2,
        ),
      );
      return true;
    } catch (error) {
      console.error("[Scheduler] Pipeline failed:", error);
      // Count as attempted so we do not infinite-retry a hard crash every restart
      return true;
    } finally {
      running = false;
    }
  };

  if (env.CRON_RANDOM) {
    startRandomDailyScheduler(runOnce);
  } else {
    startFixedScheduler(runOnce);
  }

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
 */
function startRandomDailyScheduler(
  runOnce: (reason: string) => Promise<boolean>,
): void {
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const clearTimers = () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };

  const armDay = (schedule: DailySchedule) => {
    clearTimers();
    const now = nowLocalHhmm();
    console.log(
      `[Scheduler] Random mode: ${schedule.date} → ${schedule.times.length} slots: ${schedule.times.join(", ")}`,
    );
    console.log(
      `[Scheduler] Window ${env.CRON_WINDOW_START_HOUR}:00–${env.CRON_WINDOW_END_HOUR}:00 local, min gap ${env.CRON_MIN_GAP_MINUTES}m`,
    );

    let armed = 0;
    for (const t of schedule.times) {
      if (isSlotFired(t)) {
        console.log(`[Scheduler] slot ${t} already fired today — skip`);
        continue;
      }
      const ms = msUntilLocalHhmm(t);
      if (ms < 0) {
        console.log(`[Scheduler] slot ${t} already passed (${now}) — skip`);
        continue;
      }
      const handle = setTimeout(() => {
        timers.delete(handle);
        if (isSlotFired(t)) return;
        // Mark fired only after a real pipeline attempt finishes.
        // If skipped because another run is busy, leave slot unfired for later.
        // If process dies mid-run, slot stays unfired → re-arm after restart.
        void (async () => {
          try {
            const attempted = await runOnce(`random ${t}`);
            if (attempted) markSlotFired(t);
            else
              console.warn(
                `[Scheduler] slot ${t} not marked fired (pipeline busy)`,
              );
          } catch (e) {
            console.warn(`[Scheduler] slot ${t} failed (not marked fired):`, e);
          }
        })();
      }, ms);
      timers.add(handle);
      const mins = Math.round(ms / 60000);
      console.log(`[Scheduler] Armed ${t} (in ~${mins} min)`);
      armed += 1;
    }
    console.log(
      `[Scheduler] ${armed} remaining slot(s) today. New random plan at local midnight.`,
    );

    const mid = setTimeout(() => {
      timers.delete(mid);
      console.log("[Scheduler] Local day rolled — generating new random schedule");
      armDay(getOrCreateTodaySchedule());
    }, msUntilNextLocalMidnight());
    timers.add(mid);
  };

  armDay(getOrCreateTodaySchedule());
}

function startFixedScheduler(runOnce: (reason: string) => Promise<boolean>): void {
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
  runOnce: (reason: string) => Promise<boolean>,
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
