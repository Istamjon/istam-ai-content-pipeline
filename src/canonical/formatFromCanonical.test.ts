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
