/**
 * Telegram rich-message formatting.
 *
 * The rich path may carry structural tags (`<hr/>`, `<footer>`) that the classic
 * `parse_mode=HTML` parser REJECTS — live probe against the channel:
 *   `can't parse entities: Unsupported start tag "p"`.
 *
 * So the one invariant that must never break: those tags live in `richHtml`
 * only, and `text`/`caption` (which the caption + continuation fallback
 * consumes) stay exactly as they were. If a rich-only tag leaks into `text`,
 * the fallback stops working and a post can be lost.
 */
import { formatAllFromCanonical } from "./formatFromCanonical.js";
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

const BODY =
  "Sun'iy intellekt agentlari ishlab chiqarishda tobora muhim ahamiyat kasb etmoqda. " +
  "Bu maqolada AI agentlar arxitekturasi va avtomatlashtirish haqida gaplashamiz. ".repeat(
    6,
  );

function telegramOf(body: string) {
  const out = formatAllFromCanonical(doc(body), ["telegram"]);
  const tg = out.telegram;
  if (!tg) throw new Error("telegram post missing");
  return tg;
}

describe("telegram rich formatting", () => {
  it("emits a richHtml variant alongside the legacy text", () => {
    const tg = telegramOf(BODY);

    expect(typeof tg.richHtml).toBe("string");
    expect((tg.richHtml || "").length).toBeGreaterThan(0);
    expect(tg.text.length).toBeGreaterThan(0);
  });

  it("uses a real <hr/> and <footer> in richHtml", () => {
    const tg = telegramOf(BODY);
    const rich = tg.richHtml || "";

    // Telegram renders these as `divider` and `footer` blocks.
    expect(rich).toContain("<hr/>");
    expect(rich).toContain("<footer>");
    expect(rich).toContain("</footer>");
    // The ASCII rule it replaces should be gone from the rich variant.
    expect(rich).not.toContain("────────");
  });

  it("keeps rich-only tags OUT of text and caption", () => {
    const tg = telegramOf(BODY);

    // These strings feed parse_mode=HTML, which rejects them outright.
    for (const legacy of [tg.text, tg.caption || ""]) {
      expect(legacy).not.toContain("<hr/>");
      expect(legacy).not.toContain("<footer>");
      expect(legacy).not.toContain("<p>");
    }
  });

  it("keeps the ASCII rule in the legacy text", () => {
    const tg = telegramOf(BODY);

    // The fallback layout is unchanged — it still opens the footer with the
    // box-drawing rule, exactly as before this change.
    expect(tg.text).toContain("────────");
  });

  it("keeps the caption a strict prefix of text (continuation invariant)", () => {
    const tg = telegramOf(BODY);
    const caption = tg.caption || "";

    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(tg.text.startsWith(caption)).toBe(true);
  });

  it("stays inside the 32768-char rich ceiling", () => {
    const tg = telegramOf(BODY);

    expect((tg.richHtml || "").length).toBeLessThan(32768);
    expect(tg.text.length).toBeLessThan(32768);
  });

  it("carries the same body text in both variants", () => {
    const tg = telegramOf(BODY);
    const rich = tg.richHtml || "";

    // Only the footer/divider rendering differs — no content is added or lost.
    const probe = "Sun'iy intellekt agentlari ishlab chiqarishda";
    expect(tg.text).toContain(probe);
    expect(rich).toContain(probe);
  });
});

describe("telegram rich formatting — structure is kept for Telegram only", () => {
  const MARKDOWN_BODY = [
    "## Muammo",
    "",
    "Hujjatlar ko'pligi xaridorlarga katta xavf tug'diradi.",
    "",
    "## Bosqichlar",
    "",
    "- Parse qilinadi",
    "- Indekslanadi",
    "- Tekshiriladi",
  ].join("\n");

  it("renders markdown headings and lists in richHtml", () => {
    const tg = telegramOf(MARKDOWN_BODY);
    const rich = tg.richHtml || "";

    expect(rich).toContain("<h2>Muammo</h2>");
    expect(rich).toContain("<h2>Bosqichlar</h2>");
    expect(rich).toContain("<ul><li>Parse qilinadi</li>");
  });

  it("flattens the same markdown away from the fallback text", () => {
    const tg = telegramOf(MARKDOWN_BODY);

    // LinkedIn/X/Threads show markers literally, so `text` must stay plain.
    expect(tg.text).not.toContain("##");
    expect(tg.text).not.toContain("<h2>");
    expect(tg.text).not.toContain("<ul>");
    expect(tg.text).not.toContain("<p>");
    expect(tg.text).toContain("Muammo");
  });

  it("adds the source link to richHtml from the canonical URL", () => {
    const tg = telegramOf(BODY);
    const rich = tg.richHtml || "";

    expect(rich).toContain('href="https://example.com/a"');
    expect(rich).toContain("Manba:");
    // The plain-text platforms never carried a source link; keep it that way.
    expect(tg.text).not.toContain("Manba:");
  });

  it("omits the source line when there is no usable URL", () => {
    const out = formatAllFromCanonical({ ...doc(BODY), sourceUrl: "" }, [
      "telegram",
    ]);
    const rich = out.telegram?.richHtml || "";

    expect(rich).not.toContain("Manba:");
    // ...but the brand footer still renders.
    expect(rich).toContain("<footer>");
  });
});

describe("telegram rich formatting — bounded by the rich ceiling, not the text target", () => {
  /**
   * Longer than telegram's `softBodyTarget` (3500), so the plain-text variant
   * gets truncated. The rich variant must still carry the whole article — it is
   * the variant actually sent, and it has 32768 chars to work with.
   *
   * Regression guard: packing the rich HTML against the TEXT target made
   * `packText` shed the hashtags, then the source link and footer, and finally
   * cut the HTML mid-tag, which Telegram rejects — so the rich send failed and
   * the post silently fell back to the caption layout on exactly the long
   * articles that benefit most.
   */
  const LONG = `${"AI agentlar ishlab chiqarishda muhim rol o'ynaydi. ".repeat(120)}YAKUNIY_XULOSA_MARKER.`;

  it("keeps the full article, footer and source link in richHtml", () => {
    const tg = telegramOf(LONG);
    const rich = tg.richHtml || "";

    // The plain-text variant is genuinely truncated...
    expect(tg.text.length).toBeLessThan(LONG.length);
    // ...while the rich variant still reaches the end of the article.
    expect(rich).toContain("YAKUNIY_XULOSA_MARKER");
    expect(rich).toContain("<footer>");
    expect(rich).toContain("Manba:");
    expect(rich.length).toBeGreaterThan(tg.text.length);
  });

  it("never leaves an unterminated tag in the rich HTML", () => {
    const rich = telegramOf(LONG).richHtml || "";

    // `smartTruncate` would happily cut `<foo` in half, and Telegram rejects the
    // whole payload when that happens. Every text run is escaped, so a trailing
    // `<…` with no `>` after it can only come from a bad cut.
    expect(rich).not.toMatch(/<[^>]*$/);
    // The payload is complete: body tail, footer and hashtags all survive.
    expect(rich).toContain("YAKUNIY_XULOSA_MARKER");
    expect(rich).toContain("</footer>");
    expect(rich).toContain("#IstamObidov");
  });
});
