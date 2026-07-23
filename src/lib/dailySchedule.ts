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

function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
 */
export function generateRandomTimes(
  count: number,
  startHour: number,
  endHour: number,
  minGapMinutes: number,
): string[] {
  const start = startHour * 60;
  const end = Math.max(start + count * minGapMinutes, endHour * 60);
  const windowEnd = Math.min(24 * 60 - 1, end);
  const span = windowEnd - start;
  if (span <= 0 || count <= 0) return [];

  const maxAttempts = 500;
  let best: number[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const picks = new Set<number>();
    let guard = 0;
    while (picks.size < count && guard < 2000) {
      guard++;
      picks.add(start + Math.floor(Math.random() * span));
    }
    const sorted = [...picks].sort((a, b) => a - b);
    if (sorted.length < count) continue;
    let ok = true;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] < minGapMinutes) {
        ok = false;
        break;
      }
    }
    if (ok) {
      best = sorted.slice(0, count);
      break;
    }
    // fallback: keep densest attempt
    if (sorted.length > best.length) best = sorted.slice(0, count);
  }

  // If random packing failed, place evenly with small jitter
  if (best.length < count) {
    best = [];
    const gap = Math.max(minGapMinutes, Math.floor(span / count));
    for (let i = 0; i < count; i++) {
      const jitter = Math.floor(Math.random() * Math.min(15, Math.max(1, gap / 3)));
      const t = Math.min(windowEnd, start + i * gap + jitter);
      best.push(t);
    }
    best = [...new Set(best)].sort((a, b) => a - b);
    while (best.length < count) {
      best.push(Math.min(windowEnd, best[best.length - 1] + minGapMinutes));
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
