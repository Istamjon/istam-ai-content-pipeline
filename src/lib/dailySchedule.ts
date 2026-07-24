/**
 * Random daily post schedule — new times every local calendar day.
 * Persisted to data/daily-schedule.json so restarts keep the same day plan.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEDULE_PATH = path.resolve(
  __dirname,
  "../../data/daily-schedule.json",
);

export type DailySchedule = {
  /** Local calendar date YYYY-MM-DD */
  date: string;
  times: string[];
  /** HH:MM already executed today */
  fired: string[];
};

/**
 * Local calendar day (respects process TZ, e.g. Asia/Tashkent).
 * MUST match daily publish limits — never use UTC ISO date for schedule/caps.
 */
export function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** @deprecated alias — same as localDateKey */
export function localCalendarDate(d = new Date()): string {
  return localDateKey(d);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function minutesToHhmm(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

function loadRaw(): DailySchedule | null {
  try {
    if (!fs.existsSync(SCHEDULE_PATH)) return null;
    return JSON.parse(fs.readFileSync(SCHEDULE_PATH, "utf8")) as DailySchedule;
  } catch {
    return null;
  }
}

function save(schedule: DailySchedule): void {
  fs.mkdirSync(path.dirname(SCHEDULE_PATH), { recursive: true });
  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(schedule, null, 2), "utf8");
}

/**
 * Pick N random minute-of-day values inside [startHour, endHour) with min gap.
 * Never schedules past endHour (previous code expanded window when gap×count was large).
 */
export function generateRandomTimes(
  count: number,
  startHour: number,
  endHour: number,
  minGapMinutes: number,
): string[] {
  if (count <= 0) return [];
  const start = Math.max(0, Math.min(23 * 60, startHour * 60));
  // endHour is exclusive upper bound of the posting window (e.g. 21 → last minute 20:59)
  const rawEnd = Math.max(start + 60, endHour * 60);
  const windowEnd = Math.min(24 * 60 - 1, rawEnd - 1);
  const span = windowEnd - start + 1;
  if (span <= 0) return [];

  // Fit gap so N slots always stay inside the window
  const maxGapForCount =
    count <= 1 ? minGapMinutes : Math.floor((windowEnd - start) / (count - 1));
  const gap = Math.max(30, Math.min(minGapMinutes, Math.max(30, maxGapForCount)));

  const maxAttempts = 1200;
  let best: number[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const picks: number[] = [];
    // Place first randomly, then place next with min gap (greedy)
    let cursor = start + Math.floor(Math.random() * Math.max(1, Math.floor(span / 4)));
    picks.push(cursor);
    let failed = false;
    for (let i = 1; i < count; i++) {
      const minNext = picks[i - 1] + gap;
      const remainingSlots = count - i;
      const maxNext = windowEnd - gap * (remainingSlots - 1);
      if (minNext > maxNext || minNext > windowEnd) {
        failed = true;
        break;
      }
      const room = Math.max(1, maxNext - minNext + 1);
      const next = minNext + Math.floor(Math.random() * room);
      picks.push(Math.min(windowEnd, next));
    }
    if (failed || picks.length < count) continue;
    let ok = true;
    for (let i = 1; i < picks.length; i++) {
      if (picks[i] - picks[i - 1] < gap) {
        ok = false;
        break;
      }
    }
    if (ok && picks[picks.length - 1] <= windowEnd && picks[0] >= start) {
      best = picks;
      break;
    }
  }

  // Even spacing fallback (guaranteed min gap + inside window)
  if (best.length !== count) {
    best = [];
    if (count === 1) {
      best = [start + Math.floor((windowEnd - start) / 2)];
    } else {
      const step = Math.max(gap, Math.floor((windowEnd - start) / (count - 1)));
      // If even step doesn't fit, use max fit spacing
      const fitStep = Math.floor((windowEnd - start) / (count - 1));
      const useStep = Math.max(1, Math.min(step, fitStep));
      for (let i = 0; i < count; i++) {
        best.push(Math.min(windowEnd, start + i * useStep));
      }
    }
  }

  return best.map(minutesToHhmm);
}

/**
 * Pick how many posts to schedule today — uniform random in [min, max].
 * Improves load balance vs always-4 (API free tiers + engagement cadence).
 */
export function pickDailySlotCount(
  min = env.CRON_SLOTS_MIN,
  max = env.CRON_SLOTS_MAX,
): number {
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  lo = Math.max(1, Math.min(48, lo));
  hi = Math.max(lo, Math.min(48, hi));
  if (lo === hi) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * Adaptive gap: keep preferred min gap when window allows; shrink so N slots fit.
 */
export function adaptiveMinGap(
  count: number,
  startHour: number,
  endHour: number,
  preferredGap: number,
): number {
  const start = startHour * 60;
  const windowEnd = Math.min(24 * 60 - 1, Math.max(start + 60, endHour * 60));
  const span = Math.max(60, windowEnd - start);
  if (count <= 1) return preferredGap;
  // Need (count-1) gaps inside the window
  const maxGap = Math.floor(span / (count - 1 + 0.5));
  const gap = Math.min(preferredGap, Math.max(40, maxGap));
  return gap;
}

/** Load today's schedule or create a new random one for the local day. */
export function getOrCreateTodaySchedule(): DailySchedule {
  const today = localDateKey();
  const existing = loadRaw();
  const minS = Math.min(env.CRON_SLOTS_MIN, env.CRON_SLOTS_MAX);
  const maxS = Math.max(env.CRON_SLOTS_MIN, env.CRON_SLOTS_MAX);

  if (existing && existing.date === today && existing.times?.length) {
    const n = existing.times.length;
    // Keep stable day plan unless policy range changed (e.g. 3–6 after old fixed 4)
    if (n >= minS && n <= maxS) {
      return {
        date: existing.date,
        times: existing.times,
        fired: existing.fired || [],
      };
    }
    console.log(
      `[schedule] Regenerating day plan — ${n} slots outside ${minS}–${maxS}`,
    );
  }

  const count = pickDailySlotCount(minS, maxS);
  const gap = adaptiveMinGap(
    count,
    env.CRON_WINDOW_START_HOUR,
    env.CRON_WINDOW_END_HOUR,
    env.CRON_MIN_GAP_MINUTES,
  );
  const times = generateRandomTimes(
    count,
    env.CRON_WINDOW_START_HOUR,
    env.CRON_WINDOW_END_HOUR,
    gap,
  );
  // Preserve already-fired times that still fall on the new plan day (rare regen mid-day)
  const prevFired =
    existing?.date === today
      ? (existing.fired || []).filter((t) => times.includes(t))
      : [];
  const schedule: DailySchedule = { date: today, times, fired: prevFired };
  save(schedule);
  console.log(
    `[schedule] New random day plan ${today}: ${times.join(", ")} ` +
      `(${times.length} slots, range ${minS}–${maxS}, gap≥${gap}m)`,
  );
  return schedule;
}

export function markSlotFired(hhmm: string): void {
  const s = getOrCreateTodaySchedule();
  if (!s.fired.includes(hhmm)) {
    s.fired.push(hhmm);
    save(s);
  }
}

export function isSlotFired(hhmm: string): boolean {
  const s = getOrCreateTodaySchedule();
  return s.fired.includes(hhmm);
}

export function nowLocalHhmm(d = new Date()): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function msUntilLocalHhmm(hhmm: string, from = new Date()): number {
  const targetMin = hhmmToMinutes(hhmm);
  const nowMin = from.getHours() * 60 + from.getMinutes();
  const nowSec = from.getSeconds();
  let deltaMin = targetMin - nowMin;
  if (deltaMin < 0 || (deltaMin === 0 && nowSec > 0)) {
    // already passed today
    return -1;
  }
  // fire at start of that minute
  return deltaMin * 60 * 1000 - nowSec * 1000 - from.getMilliseconds();
}

export function msUntilNextLocalMidnight(from = new Date()): number {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 5, 0); // 00:00:05 — roll schedule
  return Math.max(1000, next.getTime() - from.getTime());
}

export function getSchedulePath(): string {
  return SCHEDULE_PATH;
}
