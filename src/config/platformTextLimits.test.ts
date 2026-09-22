import {
  splitIntoThreadParts,
  smartTruncate,
  truncateHtmlPrefix,
  getPlatformTextPolicy,
  platformLimits,
} from "./platformTextLimits.js";
import { formatAllFromCanonical } from "../canonical/formatFromCanonical.js";
import type { CanonicalContent } from "../canonical/types.js";

describe("platformTextLimits", () => {
  it("smartTruncate does not cut mid-word when possible", () => {
    const s =
      "Bu birinchi gap. Ikkinchi gap ancha uzunroq bo'lishi mumkin va chegara ichida qoladi.";
    const t = smartTruncate(s, 40);
    expect(t.length).toBeLessThanOrEqual(40);
    expect(t.endsWith(" ")).toBe(false);
  });

  it("splitIntoThreadParts respects maxLen and maxParts", () => {
    const long = Array.from(
      { length: 20 },
      (_, i) => `Bu ${i + 1}-chi to'liq gap AI agent haqida.`,
    ).join(" ");
    const parts = splitIntoThreadParts(long, 500, 6);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.length).toBeLessThanOrEqual(6);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(500);
      expect(p.trim().length).toBeGreaterThan(0);
    }
  });

  it("policies expose API hard limits", () => {
    expect(getPlatformTextPolicy("telegram").captionHardLimit).toBe(1024);
    expect(getPlatformTextPolicy("telegram").strategy).toBe("telegram_native");
    expect(getPlatformTextPolicy("threads").strategy).toBe("threads_chain");
    expect(platformLimits.threads).toBe(500);
    expect(platformLimits.x).toBe(280);
  });

  it("telegram advertises the rich-message limit separately from the fallback", () => {
    const tg = getPlatformTextPolicy("telegram");
    const rich = tg.richHardLimit ?? 0;
    const soft = tg.softBodyTarget ?? 0;
    // The rich ceiling is what makes a ONE-message post possible...
    expect(rich).toBe(32768);
    // ...while the legacy limits stay in place for the fallback layout, because
    // sendPhoto captions are still capped at 1024.
    expect(tg.apiHardLimit).toBe(4096);
    expect(tg.captionHardLimit).toBe(1024);
    expect(rich).toBeGreaterThan(tg.apiHardLimit);
    expect(rich).toBeGreaterThan(soft);
    expect(tg.formatFeatures).toContain("rich_message");
    expect(tg.formatFeatures).toContain("embedded_media");
  });

  it("only telegram declares a rich-message limit", () => {
    for (const platform of [
      "linkedin",
      "facebook",
      "instagram",
      "threads",
      "x",
    ] as const) {
      expect(getPlatformTextPolicy(platform).richHardLimit).toBeUndefined();
    }
  });
});

/** Names of elements left open in an HTML fragment (Telegram would reject it). */
function openTags(html: string): string[] {
  const open: string[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[0].startsWith("</")) {
      const at = open.lastIndexOf(m[1].toLowerCase());
      if (at >= 0) open.splice(at, 1);
    } else if (!m[0].endsWith("/>")) {
      open.push(m[1].toLowerCase());
    }
  }
  return open;
}

describe("truncateHtmlPrefix", () => {
  it("returns the input untouched when it already fits", () => {
    expect(truncateHtmlPrefix("qisqa matn", 100)).toBe("qisqa matn");
  });

  it("cuts at a sentence boundary, not mid-word", () => {
    const s =
      "Birinchi to'liq gap shu yerda tugaydi. Ikkinchi gap esa ancha uzunroq bo'lib chegara ichida qolmaydi.";
    const out = truncateHtmlPrefix(s, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith(".")).toBe(true);
  });

  it("never leaves a dangling HTML entity behind", () => {
    // escapeHtml turns "&" into "&amp;". Cutting inside it would make Telegram
    // render the raw "&am" literally in HTML mode.
    const s = `${"a".repeat(40)} &amp; boshqa matn ${"b".repeat(40)}`;
    const out = truncateHtmlPrefix(s, 45);
    expect(out.endsWith("&")).toBe(false);
    expect(/&[a-zA-Z]{0,5}$/.test(out)).toBe(false);
  });

  it("always returns a prefix of the input", () => {
    const s = "Gap bir. Gap ikki. Gap uch. ".repeat(20);
    for (const limit of [30, 80, 200, 400]) {
      expect(s.startsWith(truncateHtmlPrefix(s, limit))).toBe(true);
    }
  });

  it("never leaves an element unclosed (Telegram rejects unbalanced HTML)", () => {
    // No sentence/paragraph/word boundary inside the window, so the cut falls
    // back to the raw limit — which lands inside <b>. Telegram answers
    // "can't parse entities: Unclosed start tag" and the post is lost.
    const s = `${"a".repeat(600)}<b>${"b".repeat(600)}</b>`;
    const out = truncateHtmlPrefix(s, 700);

    expect(out.length).toBeLessThanOrEqual(700);
    expect(openTags(out)).toEqual([]);
    expect(s.startsWith(out)).toBe(true);
  });

  it("never cuts in the middle of a tag", () => {
    // The window ends one char into "<" of the closing </a>.
    const s = `${"a".repeat(650)}<a href="https://example.com/very/long/path">link</a> tail`;
    const out = truncateHtmlPrefix(s, 700);

    expect(out).not.toMatch(/<[^>]*$/); // no half-written tag
    expect(openTags(out)).toEqual([]);
    expect(s.startsWith(out)).toBe(true);
  });

  it("stays a valid HTML fragment when the footer lands inside the caption window", () => {
    // Mirrors the real Telegram footer (bold title + <a href> rows) sitting
    // inside the 1024-char caption, which is what happens on mid-length posts.
    const footer =
      "────────\n" +
      "<b>Istam Obidov</b>\n" +
      "AI Engineering | AI Agents | Product UX/UI\n" +
      '<a href="https://www.linkedin.com/in/istam/">LinkedIn</a> • ' +
      '<a href="https://t.me/Istam_Obidov">Telegram</a> • ' +
      '<a href="https://www.youtube.com/@IstamObidov">YouTube</a>';
    const s = `${"so'z ".repeat(200)}\n\n${footer}`;
    const out = truncateHtmlPrefix(s, 1024);

    expect(out.length).toBeLessThanOrEqual(1024);
    expect(openTags(out)).toEqual([]);
    expect(out).not.toMatch(/<[^>]*$/);
    expect(out).not.toMatch(/&[a-zA-Z]{0,5}$/);
    expect(s.startsWith(out)).toBe(true);
  });
});

describe("formatAllFromCanonical", () => {
  const body =
    "Birinchi gap AI agent haqida. " +
    "Ikkinchi gap production pipeline. ".repeat(40) +
    "Yakuniy xulosa: amaliy qadamlarni boshlang.";
  const doc: CanonicalContent = {
    id: "test",
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceUrl: "https://example.com/a",
    title: "LangGraph multi-agent test",
    body,
    language: "uz",
    imagePath: "/tmp/x.png",
    contentHash: "testhash",
  };

  it("keeps every platform under hard limit", () => {
    const f = formatAllFromCanonical(doc, [
      "telegram",
      "linkedin",
      "instagram",
      "threads",
      "x",
      "facebook",
    ]);
    expect(f.linkedin!.text.length).toBeLessThanOrEqual(3000);
    expect(f.instagram!.text.length).toBeLessThanOrEqual(2200);
    expect(f.x!.text.length).toBeLessThanOrEqual(280);
    expect(f.facebook!.text.length).toBeLessThanOrEqual(10000);
    if (f.telegram?.caption) {
      expect(f.telegram.caption.length).toBeLessThanOrEqual(1024);
    }
    expect(f.threads!.parts?.length).toBeGreaterThan(1);
    for (const p of f.threads!.parts || []) {
      expect(p.length).toBeLessThanOrEqual(500);
    }
  });

  it("telegram caption is a prefix of the full text, so the continuation is a clean slice", () => {
    // publishToTelegram() sends `caption` as the photo caption and
    // `text.slice(caption.length)` as the continuation message. If the caption
    // stops being a strict prefix of `text`, the opening of the article gets
    // duplicated in the channel — this is the guard for that contract.
    const f = formatAllFromCanonical(doc, ["telegram"]);
    const tg = f.telegram!;
    const caption = tg.caption!;

    expect(caption.length).toBeGreaterThan(0);
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(tg.text.startsWith(caption)).toBe(true);
    // The caption ships with parse_mode=HTML, so it must be a closed fragment.
    expect(openTags(caption)).toEqual([]);
    expect(caption).not.toMatch(/<[^>]*$/);

    const continuation = tg.text.slice(caption.length).trim();
    // Long body → there must be something left to continue with.
    expect(continuation.length).toBeGreaterThan(0);
  });

  it("telegram keeps the whole article inside the platform (no external page)", () => {
    const f = formatAllFromCanonical(doc, ["telegram"]);
    const tg = f.telegram!;
    const soft = getPlatformTextPolicy("telegram").softBodyTarget!;

    expect(tg.text.length).toBeLessThanOrEqual(soft);
    expect(tg.text).not.toContain("telegra.ph");
    expect(tg.text).not.toContain("Toʻliq maqola");
  });

  it("a short body becomes a single telegram post (caption only, nothing to continue)", () => {
    const shortDoc: CanonicalContent = {
      ...doc,
      body: "Qisqa maqola: AI agentlar production uchun muhim.",
    };
    const f = formatAllFromCanonical(shortDoc, ["telegram"]);
    const tg = f.telegram!;

    expect(tg.text.length).toBeLessThanOrEqual(1024);
    expect(tg.caption).toBe(tg.text);
    expect(tg.text.slice(tg.caption!.length).trim()).toBe("");
  });

  it("formats LinkedIn and Threads from bodyEn while others use Uzbek body", () => {
    const multiDoc: CanonicalContent = {
      ...doc,
      body: "O'zbekcha matn: sun'iy intellekt agentlari arxitekturasi va ish oqimlari.",
      bodyEn:
        "English text: autonomous AI agent architectures and production workflows.",
    };

    const f = formatAllFromCanonical(multiDoc, [
      "telegram",
      "linkedin",
      "threads",
      "facebook",
    ]);

    // LinkedIn & Threads must be in English
    expect(f.linkedin!.text).toContain(
      "English text: autonomous AI agent architectures",
    );
    expect(f.linkedin!.text).not.toContain("O'zbekcha matn");
    expect(f.threads!.text).toContain(
      "English text: autonomous AI agent architectures",
    );
    expect(f.threads!.text).not.toContain("O'zbekcha matn");
    expect(f.linkedin!.text).not.toContain("#OzbekistonTech");

    // Telegram & Facebook must be in Uzbek
    expect(f.facebook!.text).toContain("O'zbekcha matn");
    expect(f.facebook!.text).not.toContain("English text");
    expect(f.facebook!.text).toContain("#OzbekistonTech");
  });
});
