/**
 * Telegram FALLBACK layout — the brand footer must survive the budget.
 *
 * The fallback layout ships `text` as a photo caption (first ≤1024 chars) plus
 * the remainder as continuation message(s) (`sendMessage` chunks at 4096), so
 * `text` itself is allowed to exceed 4096. `softBodyTarget` is documented as a
 * BODY target, and the `full` strategy honours that by reserving room for the
 * footer and hashtags before packing.
 *
 * Regression: the `telegram_native` branch used to hand `softBodyTarget` to
 * `packText` as a TOTAL budget. With a 241-char compact footer and ~59 chars of
 * hashtags, any body over `soft − 241 − 59 − 4 ≈ 3696` chars overflowed it, and
 * `packText`'s shedding order dropped the hashtags and then the footer — so the
 * post shipped with NO brand footer and NO divider.
 *
 * The live post that exposed this (canonical `8a5ec485806b5d05` v1,
 * "The Reliability Layer for Healthcare AI", 11:31:45Z) had `text` = 3816 chars
 * with no `────────`. The pre-existing unit test only passed because its `BODY`
 * fixture is ~528 chars — short enough that the footer never came under
 * pressure. These fixtures are deliberately long.
 */
import { formatAllFromCanonical } from "./formatFromCanonical.js";
import { getPlatformTextPolicy } from "../config/platformTextLimits.js";
import type { CanonicalContent } from "./types.js";

function doc(body: string): CanonicalContent {
  return {
    id: "test",
    sourceUrl: "https://example.com/a",
    title: "Test title",
    body,
    language: "uz",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    contentHash: "hash",
  };
}

/** One realistic Uzbek sentence, ~90 chars, ending on a sentence boundary. */
const SENTENCE =
  "Sun'iy intellekt agentlari ishlab chiqarish muhitida ishonchlilik qatlamini talab qiladi. ";

/**
 * A body long enough that body + footer + hashtags overflows `softBodyTarget`
 * (4000), which is exactly the condition the live post hit.
 */
function longBody(targetChars: number): string {
  let out = "";
  while (out.length < targetChars) out += SENTENCE;
  return out.trim();
}

function telegramOf(body: string) {
  const out = formatAllFromCanonical(doc(body), ["telegram"]);
  const tg = out.telegram;
  if (!tg) throw new Error("telegram post missing");
  return tg;
}

describe("telegram fallback layout — footer survives a long body", () => {
  const soft = getPlatformTextPolicy("telegram").softBodyTarget!;
  // Comfortably past the ~3696-char body capacity that used to trigger shedding.
  const BODY_LONG = longBody(4200);

  it("keeps the ASCII rule (brand footer) even when the body is long", () => {
    const tg = telegramOf(BODY_LONG);

    console.log(
      `[test] body=${BODY_LONG.length} text=${tg.text.length} soft=${soft} ` +
        `hasRule=${tg.text.includes("────────")} ` +
        `hasTags=${tg.text.includes("#IstamObidov")}`,
    );

    // The footer is a brand element, not filler: it must never be the thing
    // that gets dropped to make room for the body.
    expect(tg.text).toContain("────────");
    // ...and neither must the hashtags.
    expect(tg.text).toContain("#IstamObidov");
  });

  it("still respects the body budget (never overshoots the soft target)", () => {
    const tg = telegramOf(BODY_LONG);

    expect(tg.text.length).toBeLessThanOrEqual(soft);
    // The body is trimmed at a sentence boundary, so the tail is a real sentence
    // end rather than a mid-word cut.
    expect(tg.text.trimEnd()).toMatch(/[.!?…]$|\n#/);
  });

  it("drops the body, never the footer, when the body alone is oversized", () => {
    // Body far beyond the whole budget: trimming the body is the only sane
    // outcome, and the footer must still be there at the end.
    const tg = telegramOf(longBody(9000));

    expect(tg.text).toContain("────────");
    expect(tg.text.length).toBeLessThanOrEqual(soft);
  });

  it("keeps the caption a strict prefix of text and free of rich-only tags", () => {
    const tg = telegramOf(BODY_LONG);
    const caption = tg.caption || "";

    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(tg.text.startsWith(caption)).toBe(true);
    for (const legacy of [tg.text, caption]) {
      expect(legacy).not.toContain("<hr/>");
      expect(legacy).not.toContain("<footer>");
      expect(legacy).not.toContain("<p>");
    }
  });

  it("does not leave a dangling HTML entity in the trimmed body", () => {
    // `escapeHtml` produces `&amp;`/`&lt;`/`&gt;`; a naive cut could leave `&am`.
    const body = `${longBody(4200)} A & B & C.`;
    const tg = telegramOf(body);

    expect(tg.text).not.toMatch(/&[a-zA-Z]{0,5}$/);
    expect(tg.text).not.toMatch(/&[a-zA-Z]{0,5}\n/);
  });
});
