import {
  adaptiveMinGap,
  applySlotOutcome,
  generateRandomTimes,
  localDateKey,
  pickDailySlotCount,
  publishedOrBackfill,
  type DailySchedule,
} from "./dailySchedule.js";

const WINDOW_START = 8;
const WINDOW_END = 21;
const PREFERRED_GAP = 150;

const START_MIN = WINDOW_START * 60;
/** Last minute inside the window (endHour is exclusive). */
const END_MIN = WINDOW_END * 60 - 1;

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

function gapsOf(times: string[]): number[] {
  const mins = times.map(toMin);
  return mins.slice(1).map((m, i) => m - mins[i]);
}

function schedule(over: Partial<DailySchedule> = {}): DailySchedule {
  return { date: "2026-09-21", times: [], fired: [], published: [], ...over };
}

/**
 * Returns a human-readable violation, or null when the plan is valid.
 * Collecting violations instead of asserting inside the loop keeps thousands of
 * iterations fast and prints concrete counterexamples on failure.
 */
function planViolation(
  times: string[],
  count: number,
  minGap: number,
  spacing: number,
): string | null {
  if (times.length !== count)
    return `expected ${count} slots, got ${times.length}`;

  const mins = times.map(toMin);
  for (const m of mins) {
    if (m < START_MIN || m > END_MIN) return `slot outside window: ${m}`;
  }
  for (let k = 1; k < mins.length; k++) {
    if (mins[k] <= mins[k - 1])
      return `not strictly increasing: ${times.join(", ")}`;
  }

  const g = gapsOf(times);
  const worstMin = Math.min(...g);
  if (worstMin < minGap) return `gap ${worstMin}m below minimum ${minGap}m`;

  const worstMax = Math.max(...g);
  // 1.25x is a hair above the 1.2x the implementation guarantees
  // (jitterCap = 0.10*spacing), leaving room for integer rounding and the
  // window clamp. It still rejects the real-world dead zone below (1.31x).
  if (worstMax > 1.25 * spacing) {
    return `dead zone: max gap ${worstMax}m > 1.25x even spacing (${Math.round(1.25 * spacing)}m)`;
  }
  return null;
}

describe("generateRandomTimes", () => {
  it("returns [] for a non-positive count", () => {
    expect(
      generateRandomTimes(0, WINDOW_START, WINDOW_END, PREFERRED_GAP),
    ).toEqual([]);
    expect(
      generateRandomTimes(-3, WINDOW_START, WINDOW_END, PREFERRED_GAP),
    ).toEqual([]);
  });

  it("returns a single in-window slot for count=1", () => {
    for (let i = 0; i < 200; i++) {
      const times = generateRandomTimes(
        1,
        WINDOW_START,
        WINDOW_END,
        PREFERRED_GAP,
      );
      expect(times).toHaveLength(1);
      expect(times[0]).toMatch(/^\d{2}:\d{2}$/);
      const m = toMin(times[0]);
      expect(m).toBeGreaterThanOrEqual(START_MIN);
      expect(m).toBeLessThanOrEqual(END_MIN);
    }
  });

  it("widens a degenerate window to at least one hour instead of giving up", () => {
    // `endHour <= startHour` cannot be honoured, so the function floors the
    // window at 60 minutes (rawEnd = max(start + 60, endHour*60)) and degrades
    // to plain even spacing. It must still emit usable, ordered, in-window slots
    // rather than an empty plan — an empty plan would silently drop the day.
    const times = generateRandomTimes(3, 10, 10, PREFERRED_GAP);
    expect(times).toHaveLength(3);
    const mins = times.map(toMin);
    expect(Math.min(...mins)).toBeGreaterThanOrEqual(10 * 60);
    expect(Math.max(...mins)).toBeLessThanOrEqual(10 * 60 + 59);
    expect(mins[0]).toBeLessThan(mins[1]);
    expect(mins[1]).toBeLessThan(mins[2]);
    // The min gap is infeasible here (3 slots x 150m > 1h) and is knowingly
    // dropped — even spacing is the graceful degradation.
    expect(gapsOf(times).every((g) => g > 0)).toBe(true);
  });

  // The regression this file exists for: the old greedy generator only enforced
  // a MINIMUM gap, so it happily emitted 09:17 / 17:46 / 20:27 — an 8.5-hour
  // dead zone followed by two posts 2.7h apart, which reads to a reader as
  // "nothing was posted today".
  describe("even coverage across the whole window", () => {
    const ITERATIONS = 2000;

    for (const count of [2, 3, 4, 5, 6]) {
      it(`count=${count}: ordered, in-window, min gap held, no dead zone`, () => {
        // Mirror production: the gap is shrunk so `count` slots actually fit.
        const minGap = adaptiveMinGap(
          count,
          WINDOW_START,
          WINDOW_END,
          PREFERRED_GAP,
        );
        const spacing = (END_MIN - START_MIN) / (count - 1);
        const violations: string[] = [];

        for (let i = 0; i < ITERATIONS; i++) {
          const times = generateRandomTimes(
            count,
            WINDOW_START,
            WINDOW_END,
            minGap,
          );
          const bad = planViolation(times, count, minGap, spacing);
          if (bad) {
            violations.push(`#${i} [${times.join(", ")}] ${bad}`);
            if (violations.length >= 5) break;
          }
        }

        expect(violations).toEqual([]);
      });
    }

    it("rejects the 2026-09-21 dead-zone shape the old generator produced", () => {
      const bad = ["09:17", "17:46", "20:27"];
      const spacing = (END_MIN - START_MIN) / (bad.length - 1);
      const worstBad = Math.max(...gapsOf(bad));
      // Sanity-check the fixture itself: this shape IS a dead zone (1.31x)...
      expect(worstBad / spacing).toBeGreaterThan(1.25);

      // ...and the new generator never produces anything like it.
      for (let i = 0; i < 500; i++) {
        const times = generateRandomTimes(
          3,
          WINDOW_START,
          WINDOW_END,
          PREFERRED_GAP,
        );
        const worst = Math.max(...gapsOf(times));
        expect(worst / spacing).toBeLessThanOrEqual(1.25);
      }
    });

    it("keeps plans spread out rather than clustered, over many days", () => {
      // Averaged across days, slot i should land near its even-spacing position.
      const count = 4;
      const spacing = (END_MIN - START_MIN) / (count - 1);
      const sums = new Array(count).fill(0);
      const runs = 500;
      for (let i = 0; i < runs; i++) {
        const mins = generateRandomTimes(
          count,
          WINDOW_START,
          WINDOW_END,
          150,
        ).map(toMin);
        for (let k = 0; k < count; k++) sums[k] += mins[k];
      }
      for (let k = 0; k < count; k++) {
        const avg = sums[k] / runs;
        const ideal = START_MIN + k * spacing;
        // Jitter is bounded at 0.15*spacing, so the mean must sit well inside it.
        expect(Math.abs(avg - ideal)).toBeLessThan(spacing * 0.3);
      }
    });
  });
});

describe("adaptiveMinGap", () => {
  it("returns the preferred gap when only one slot is planned", () => {
    expect(adaptiveMinGap(1, WINDOW_START, WINDOW_END, PREFERRED_GAP)).toBe(
      PREFERRED_GAP,
    );
  });

  it("keeps the preferred gap while the window can afford it", () => {
    for (const count of [2, 3, 4, 5]) {
      expect(
        adaptiveMinGap(count, WINDOW_START, WINDOW_END, PREFERRED_GAP),
      ).toBe(PREFERRED_GAP);
    }
  });

  it("shrinks the gap so 6 slots fit the 08:00-21:00 window", () => {
    // span 780 / (6-1+0.5) = 141 — smaller than the preferred 150, so it wins.
    expect(adaptiveMinGap(6, WINDOW_START, WINDOW_END, PREFERRED_GAP)).toBe(
      141,
    );
  });

  it("never drops below the 40m floor and never exceeds the preferred gap", () => {
    for (let count = 1; count <= 24; count++) {
      const gap = adaptiveMinGap(
        count,
        WINDOW_START,
        WINDOW_END,
        PREFERRED_GAP,
      );
      expect(gap).toBeGreaterThanOrEqual(40);
      expect(gap).toBeLessThanOrEqual(PREFERRED_GAP);
    }
  });
});

describe("pickDailySlotCount", () => {
  it("returns the exact value when min === max", () => {
    expect(pickDailySlotCount(4, 4)).toBe(4);
  });

  it("stays within the requested range", () => {
    for (let i = 0; i < 500; i++) {
      const n = pickDailySlotCount(3, 6);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("tolerates reversed bounds and clamps out-of-range values", () => {
    expect(pickDailySlotCount(6, 3)).toBeGreaterThanOrEqual(3);
    expect(pickDailySlotCount(6, 3)).toBeLessThanOrEqual(6);
    expect(pickDailySlotCount(0, 0)).toBe(1);
    expect(pickDailySlotCount(999, 999)).toBe(48);
  });
});

describe("localDateKey", () => {
  it("formats as YYYY-MM-DD using LOCAL time, never UTC", () => {
    // 23:30 local on the 21st must not roll over to the 22nd.
    const d = new Date(2026, 8, 21, 23, 30, 0);
    expect(localDateKey(d)).toBe("2026-09-21");
  });

  it("zero-pads month and day", () => {
    expect(localDateKey(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });
});

describe("applySlotOutcome", () => {
  it("marks a slot fired WITHOUT counting it as a publish", () => {
    // This is the bug that let a day of failures look complete: retries
    // exhausted → fired, and the scheduler then read `fired.length` as
    // "publishes today" and skipped every remaining slot.
    const next = applySlotOutcome(schedule(), "09:17", "fired");
    expect(next.fired).toEqual(["09:17"]);
    expect(next.published).toEqual([]);
  });

  it("counts a published slot as both fired and published", () => {
    const next = applySlotOutcome(schedule(), "09:17", "published");
    expect(next.fired).toEqual(["09:17"]);
    expect(next.published).toEqual(["09:17"]);
  });

  it("is idempotent for repeated outcomes", () => {
    const once = applySlotOutcome(schedule(), "09:17", "published");
    const twice = applySlotOutcome(once, "09:17", "published");
    expect(twice.fired).toEqual(["09:17"]);
    expect(twice.published).toEqual(["09:17"]);
  });

  it("does not mutate the schedule it is given", () => {
    const before = schedule();
    const next = applySlotOutcome(before, "09:17", "published");
    expect(before.fired).toEqual([]);
    expect(before.published).toEqual([]);
    expect(next).not.toBe(before);
  });

  it("accumulates a realistic mixed day: 3 fired, only 1 published", () => {
    let s = schedule({ times: ["09:17", "14:50", "20:06"] });
    s = applySlotOutcome(s, "09:17", "fired"); // retries exhausted
    s = applySlotOutcome(s, "14:50", "published"); // success
    s = applySlotOutcome(s, "20:06", "fired"); // day-cap skip
    expect(s.fired).toHaveLength(3);
    expect(s.published).toEqual(["14:50"]);
    // The day counter must report 1, not 3.
    expect(s.published.length).toBe(1);
  });
});

describe("publishedOrBackfill (schema migration)", () => {
  it("uses the real `published` list when the field is present", () => {
    expect(
      publishedOrBackfill({ fired: ["09:17", "14:50"], published: ["14:50"] }),
    ).toEqual(["14:50"]);
  });

  it("honours a present-but-empty `published` list without backfilling", () => {
    // A day where nothing has published yet is NOT a pre-upgrade file.
    expect(publishedOrBackfill({ fired: ["09:17"], published: [] })).toEqual(
      [],
    );
  });

  it("backfills from `fired` when the field is absent (pre-upgrade file)", () => {
    expect(publishedOrBackfill({ fired: ["09:17", "14:50"] })).toEqual([
      "09:17",
      "14:50",
    ]);
  });

  it("treats a missing `fired` list as empty rather than throwing", () => {
    expect(publishedOrBackfill({})).toEqual([]);
  });

  it("does not resurrect the bug: an absent field backfills once, then the real list governs", () => {
    // Simulate the upgrade day: 3 fired, only 1 actually posted.
    const preUpgrade = { fired: ["09:17", "14:50", "20:06"] };
    const backfilled = publishedOrBackfill(preUpgrade);
    expect(backfilled).toHaveLength(3); // conservative on upgrade day only

    // After the migration is persisted, a failing slot no longer inflates it.
    const migrated = {
      fired: ["09:17", "14:50", "20:06"],
      published: ["09:17"],
    };
    expect(publishedOrBackfill(migrated)).toEqual(["09:17"]);
  });
});
