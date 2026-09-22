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
  /**
   * HH:MM slots that actually produced at least one successful publish.
   *
   * Deliberately kept separate from `fired`. A slot becomes `fired` when it
   * published, when its retries are exhausted with NO publish, or when the day
   * cap skips it — only the first of those is a publish. The scheduler used to
   * seed its "publishes today" counter from `fired.length`, so after any restart
   * a broken day (3 slots fired, 0 published) looked complete: the day cap then
   * skipped every remaining slot and the daily guarantee no-opped because it
   * believed the day was already covered. Net effect — a silent zero-post day.
   */
  published: string[];
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
 * Pick N times spread EVENLY across the posting window, with bounded jitter.
 *
 * Even coverage is the point, not the jitter. The previous greedy version only
 * ever enforced a MINIMUM gap, so it could emit plans like 09:17 / 17:46 / 20:27
 * — an 8.5-hour dead zone followed by two posts 2.7 hours apart. To a reader
 * that reads as "nothing was posted today", which is exactly the complaint.
 *
 * Slots are laid out at even spacing and each one is nudged by at most
 * `jitterCap`, which is capped so that:
 *
 *   (a) order is preserved,
 *   (b) the minimum gap still holds —
 *       gap >= spacing - 2*jitterCap >= minGapMinutes,
 *   (c) no gap can blow out into a dead zone —
 *       max gap = spacing + 2*jitterCap <= 1.2 * spacing.
 *
 * The jitter fraction is 0.10 rather than a looser 0.15 on purpose. The real
 * bad plan this replaces (09:17 / 17:46 / 20:27) had a largest gap of only
 * 1.31x even spacing, so a 1.30 ceiling sat almost on top of it — the guarantee
 * would have been technically true and practically useless. 1.2x leaves clear
 * air between "evenly spread" and "a dead zone", while 10% of a multi-hour
 * spacing is still tens of minutes of variation, which is all the natural
 * cadence this needs.
 *
 * A small inward margin keeps no slot sitting exactly on the window edge.
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
  const span = windowEnd - start;
  if (span <= 0) return [];

  if (count === 1) {
    return [minutesToHhmm(start + Math.floor(Math.random() * (span + 1)))];
  }

  // Keep the first/last slot off the exact boundary.
  const margin = Math.min(30, Math.floor(span * 0.05));
  const innerStart = start + margin;
  const innerEnd = windowEnd - margin;
  const spacing = (innerEnd - innerStart) / (count - 1);

  // Room to move before neighbours could collide, and before a gap grows past
  // 1.2x even spacing. Never negative.
  const gapRoom = Math.max(0, (spacing - minGapMinutes) / 2 - 1);
  const jitterCap = Math.max(0, Math.min(spacing * 0.1, gapRoom));

  const picks: number[] = [];
  for (let i = 0; i < count; i++) {
    const jitter = jitterCap > 0 ? (Math.random() * 2 - 1) * jitterCap : 0;
    picks.push(Math.round(innerStart + i * spacing + jitter));
  }

  // Clamping only ever pulls a pick back toward the window interior: an early
  // pick can be raised to `start`, a late one lowered to `windowEnd`. Raising the
  // first pick shrinks the gap to its successor — the inward `margin` (30m) is
  // what keeps that gap above minGapMinutes; lowering the last pick shrinks the
  // final gap, which only helps the 1.2x bound. Both bounds are verified over
  // thousands of generated plans in dailySchedule.test.ts rather than argued
  // here. Sorting is belt-and-braces against rounding.
  return picks
    .map((m) => Math.max(start, Math.min(windowEnd, m)))
    .sort((a, b) => a - b)
    .map(minutesToHhmm);
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

/**
 * `published` as far as we can know it for a persisted schedule.
 *
 * The field is new, so a schedule written by an older build has no way to say
 * which of its `fired` slots actually published. For the single day that
 * straddles the upgrade we keep the old build's interpretation — assume a fired
 * slot published — instead of assuming every fired slot failed. Guessing "all
 * failed" would make `armDay` see 0 publishes, so it would fire catch-up runs
 * for slots that had in fact already posted, over-posting on upgrade day.
 * From the next local midnight the field is always written for real.
 *
 * Typed against the raw persisted shape on purpose: a file written by an older
 * build genuinely has no `published` key, whatever the current type says.
 */
export function publishedOrBackfill(s: {
  fired?: string[];
  published?: string[];
}): string[] {
  return Array.isArray(s.published) ? s.published : s.fired || [];
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
      const fired = existing.fired || [];
      const published = publishedOrBackfill(existing);
      const normalized: DailySchedule = {
        date: existing.date,
        times: existing.times,
        fired,
        published,
      };
      // Persist the backfill once so every later read — including the scheduler
      // in a different process after a restart — sees the migrated shape.
      if (!Array.isArray(existing.published)) {
        save(normalized);
        console.log(
          `[schedule] Migrated ${existing.date} to the \`published\` field — ` +
            `backfilled ${fired.length} fired slot(s) as published (the old format ` +
            `did not record which fired slots actually posted). One-time.`,
        );
      }
      return normalized;
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
  // Preserve already-fired/published times that still fall on the new plan day
  // (rare regen mid-day). Dropping `published` here would re-open the day cap and
  // let the guarantee double-post, so it is carried over alongside `fired`.
  const sameDay = existing?.date === today;
  const prevFired = sameDay
    ? (existing.fired || []).filter((t) => times.includes(t))
    : [];
  const prevPublished = sameDay
    ? publishedOrBackfill(existing).filter((t) => times.includes(t))
    : [];
  const schedule: DailySchedule = {
    date: today,
    times,
    fired: prevFired,
    published: prevPublished,
  };
  save(schedule);
  console.log(
    `[schedule] New random day plan ${today}: ${times.join(", ")} ` +
      `(${times.length} slots, range ${minS}–${maxS}, gap≥${gap}m)`,
  );
  return schedule;
}

/**
 * Pure state transition for a slot outcome — no disk access, so it is directly
 * unit-testable.
 *
 * `"published"` implies `"fired"` in the SAME transition on purpose: a published
 * slot that was not also marked fired would be re-armed and double-post.
 * `"fired"` (retries exhausted with no publish, or day-cap skip) must NOT touch
 * `published` — that is the distinction the scheduler's day counter depends on.
 */
export function applySlotOutcome(
  schedule: DailySchedule,
  hhmm: string,
  outcome: "published" | "fired",
): DailySchedule {
  const fired = schedule.fired.includes(hhmm)
    ? schedule.fired
    : [...schedule.fired, hhmm];
  const published =
    outcome === "published" && !schedule.published.includes(hhmm)
      ? [...schedule.published, hhmm]
      : schedule.published;
  return { ...schedule, fired, published };
}

/** Mark a slot as consumed WITHOUT recording a publish. */
export function markSlotFired(hhmm: string): void {
  const s = getOrCreateTodaySchedule();
  if (s.fired.includes(hhmm)) return;
  save(applySlotOutcome(s, hhmm, "fired"));
}

/** Record a slot that produced a successful publish (also marks it fired). */
export function markSlotPublished(hhmm: string): void {
  const s = getOrCreateTodaySchedule();
  if (s.fired.includes(hhmm) && s.published.includes(hhmm)) return;
  save(applySlotOutcome(s, hhmm, "published"));
}

/** Successful publishes recorded for today's local day (durable across restarts). */
export function getPublishedCount(): number {
  return (getOrCreateTodaySchedule().published || []).length;
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
