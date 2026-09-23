/**
 * Single source of truth for platform text limits + format strategy.
 * API hard limits must never be exceeded at publish time.
 */
import type { Platform } from "../agent/state.js";

export type TextStrategy =
  "full" | "telegram_native" | "threads_chain" | "short_single";

export type FooterMode = "full" | "compact" | "none";

export type PlatformTextPolicy = {
  platform: Platform;
  /** Max chars for the primary text surface sent to the API */
  apiHardLimit: number;
  /**
   * Max chars for a single RICH message, when the platform supports one.
   *
   * Telegram only: `sendRichMessage` (Bot API 10.1+, June 2026) raises the
   * per-message ceiling for bots from 4096 to 32768 and allows a photo to be a
   * block inside the message. Verified live against the channel — 20 000 chars
   * accepted, 40 000 rejected with RICH_MESSAGE_TEXT_TOO_LONG.
   */
  richHardLimit?: number;
  /** Media caption hard limit (Telegram photo/video) */
  captionHardLimit?: number;
  strategy: TextStrategy;
  maxHashtags: number;
  footerMode: FooterMode;
  /** Soft target for body when full strategy (use most of hard limit) */
  softBodyTarget?: number;
  audienceNotes: string;
  styleNotes: string;
  formatFeatures: string[];
};

export const PLATFORM_TEXT_POLICIES: Record<Platform, PlatformTextPolicy> = {
  telegram: {
    platform: "telegram",
    // Fallback layout only: photo caption (1024) + continuation messages (4096).
    apiHardLimit: 4096,
    captionHardLimit: 1024,
    // Preferred layout: ONE rich message, cover image embedded as a block.
    richHardLimit: 32768,
    strategy: "telegram_native",
    maxHashtags: 5,
    footerMode: "compact",
    // Budget for the FALLBACK layout only: `text` is a caption prefix plus
    // continuation message(s), all ≤ `apiHardLimit` (4096). The rich path
    // ignores this value entirely and packs against `richHardLimit` instead, so
    // this number never limits the rich post. Held just under the hard limit,
    // leaving room for the footer and hashtags that `packText` appends.
    softBodyTarget: 4000,
    audienceNotes: "Uzbek tech learners — full article read inside Telegram",
    styleNotes: "Clear practical Uzbek; HTML bold/links OK",
    formatFeatures: [
      "html",
      "rich_message",
      "embedded_media",
      "photo_caption",
      "multi_message",
      "linebreaks",
    ],
  },
  linkedin: {
    platform: "linkedin",
    apiHardLimit: 3000,
    strategy: "full",
    maxHashtags: 6,
    footerMode: "compact",
    softBodyTarget: 2800,
    audienceNotes: "Junior–middle engineers, founders",
    styleNotes: "Professional structure: hook → insight → steps → close",
    formatFeatures: ["linebreaks", "hashtags", "links"],
  },
  facebook: {
    platform: "facebook",
    apiHardLimit: 10000,
    strategy: "full",
    maxHashtags: 5,
    footerMode: "compact",
    softBodyTarget: 8000,
    audienceNotes: "Broader audience — scannable full posts",
    styleNotes: "Clear paragraphs, less jargon density",
    formatFeatures: ["linebreaks", "hashtags", "photo"],
  },
  instagram: {
    platform: "instagram",
    apiHardLimit: 2200,
    strategy: "full",
    maxHashtags: 8,
    footerMode: "compact",
    softBodyTarget: 2000,
    audienceNotes: "Visual scroll — short paras + CTA",
    styleNotes: "Caption-first; minimal emoji",
    formatFeatures: ["linebreaks", "hashtags", "caption"],
  },
  threads: {
    platform: "threads",
    apiHardLimit: 500,
    strategy: "threads_chain",
    maxHashtags: 2,
    footerMode: "none",
    audienceNotes: "Conversational short-form; multi-post thread",
    styleNotes: "1–2 complete thoughts per part",
    formatFeatures: ["thread_replies", "linebreaks"],
  },
  x: {
    platform: "x",
    apiHardLimit: 280,
    strategy: "short_single",
    maxHashtags: 2,
    footerMode: "none",
    audienceNotes: "Fast signal",
    styleNotes: "One strong takeaway",
    formatFeatures: ["hashtags"],
  },
  blogger: {
    platform: "blogger",
    apiHardLimit: 50000,
    strategy: "full",
    maxHashtags: 0,
    footerMode: "full",
    softBodyTarget: 50000,
    audienceNotes: "Archive / SEO long-form",
    styleNotes: "Full article body",
    formatFeatures: ["html", "full_body"],
  },
};

/** Legacy map used across codebase */
export const platformLimits: Record<string, number> = Object.fromEntries(
  Object.values(PLATFORM_TEXT_POLICIES).map((p) => [
    p.platform,
    p.apiHardLimit,
  ]),
);

export function getPlatformTextPolicy(platform: Platform): PlatformTextPolicy {
  return PLATFORM_TEXT_POLICIES[platform];
}

/**
 * Split long text into thread parts ≤ maxLen each.
 * Cuts only at sentence/paragraph/word boundaries. Never mid-word.
 */
export function splitIntoThreadParts(
  text: string,
  maxLen: number,
  maxParts = 6,
): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const sentences: string[] = [];
  const paras = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of paras) {
    const bits = p.match(/[^.!?…]+[.!?…]+(?:\s+|$)|[^.!?…]+$/g) || [p];
    for (const b of bits) {
      const s = b.trim();
      if (s) sentences.push(s);
    }
    // Preserve paragraph feel with blank line between para groups when packing
    if (sentences.length) {
      const last = sentences[sentences.length - 1];
      if (!last.endsWith("\n")) {
        /* keep as sentence list; join with space or \n\n later */
      }
    }
  }

  if (sentences.length === 0) {
    return hardChunk(clean, maxLen, maxParts);
  }

  const parts: string[] = [];
  let cur = "";

  const pushCur = () => {
    if (cur.trim()) parts.push(cur.trim());
    cur = "";
  };

  for (const s of sentences) {
    if (s.length > maxLen) {
      pushCur();
      for (const piece of hardChunk(s, maxLen, maxParts - parts.length)) {
        parts.push(piece);
        if (parts.length >= maxParts) return parts;
      }
      continue;
    }
    const next = cur ? `${cur} ${s}` : s;
    if (next.length <= maxLen) {
      cur = next;
    } else {
      pushCur();
      cur = s;
      if (parts.length >= maxParts) break;
    }
  }
  pushCur();

  if (parts.length > maxParts) {
    // Merge overflow into last allowed part with smart end
    const head = parts.slice(0, maxParts - 1);
    const tail = parts.slice(maxParts - 1).join(" ");
    head.push(smartTruncate(tail, maxLen));
    return head;
  }
  return parts.length ? parts : [smartTruncate(clean, maxLen)];
}

function hardChunk(text: string, maxLen: number, maxParts: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length && out.length < maxParts) {
    if (rest.length <= maxLen) {
      out.push(rest.trim());
      break;
    }
    const window = rest.slice(0, maxLen);
    const sp = window.lastIndexOf(" ");
    const cut = sp > maxLen * 0.4 ? sp : maxLen;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return out;
}

/** Smart truncate at sentence / word boundary (no mid-word). */
export function smartTruncate(text: string, limit: number): string {
  const t = text.trim();
  if (t.length <= limit) return t;
  if (limit < 24) return t.slice(0, Math.max(0, limit - 1)) + "…";

  const window = t.slice(0, limit);
  const minKeep = Math.floor(limit * 0.45);
  let best = -1;
  for (let i = minKeep; i < window.length; i++) {
    const ch = window[i];
    if (
      (ch === "." || ch === "!" || ch === "?" || ch === "…") &&
      (i + 1 >= window.length || /\s/.test(window[i + 1]))
    ) {
      best = i + 1;
    }
  }
  if (best > 0) return window.slice(0, best).trim();

  const para = window.lastIndexOf("\n\n");
  if (para >= minKeep) return window.slice(0, para).trim();

  const space = window.lastIndexOf(" ");
  if (space >= minKeep) return window.slice(0, space).trimEnd() + "…";

  return window.slice(0, limit - 1).trimEnd() + "…";
}

/** Matches an opening/closing/self-closing HTML tag. */
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;

/**
 * Largest position ≤ `cut` at which `html` is a *valid* fragment: not inside a
 * half-written tag, not inside an unclosed element, and not ending on a
 * dangling entity. The returned value is always a plain string index into
 * `html`, so `html.slice(0, result)` stays a true prefix of the source.
 */
function balancedHtmlCut(html: string, cut: number): number {
  let end = cut;

  // 1. Not mid-tag: a "<" with no ">" after it means the cut split a tag
  //    (e.g. `<a href="https://www.linked`). Telegram would reject it.
  const lastLt = html.lastIndexOf("<", end - 1);
  const lastGt = html.lastIndexOf(">", end - 1);
  if (lastLt > lastGt) end = lastLt;

  // 2. Not inside an element: rewind to the outermost still-open tag so the
  //    fragment has no unclosed <b>/<a>. Rewinding (rather than appending
  //    synthetic closers) keeps the result a true prefix of `text`.
  const prefix = html.slice(0, end);
  const open: Array<{ name: string; start: number }> = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(prefix)) !== null) {
    const raw = m[0];
    const name = m[1].toLowerCase();
    if (raw.startsWith("</")) {
      const at = open.map((o) => o.name).lastIndexOf(name);
      if (at >= 0) open.splice(at, 1);
    } else if (!raw.endsWith("/>")) {
      open.push({ name, start: m.index });
    }
  }
  if (open.length) end = Math.min(end, ...open.map((o) => o.start));

  // 3. No dangling entity: `&amp;` cut to `&am` renders literally in HTML mode.
  return html.slice(0, end).replace(/&[a-zA-Z]{0,5}$/, "").length;
}

/**
 * Cut `text` to at most `limit` chars at a sentence (then paragraph, then word)
 * boundary, never leaving a dangling HTML entity or an unclosed tag behind.
 *
 * Why this exists: Telegram delivers a long post as a photo caption plus
 * continuation message(s). The caption MUST be an exact prefix of the full
 * text, so the continuation can be derived with a plain `slice()` — otherwise
 * the reader sees the opening twice. Cutting at a boundary keeps the caption
 * from ending mid-thought; the entity and tag guards keep the fragment valid
 * for `parse_mode=HTML`, which Telegram otherwise rejects outright. Because
 * both guards only ever rewind, the result is still a strict prefix.
 */
export function truncateHtmlPrefix(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const window = text.slice(0, limit);
  const minKeep = Math.floor(limit * 0.5);

  let cut = -1;
  for (let i = window.length - 1; i >= minKeep; i--) {
    const ch = window[i];
    if (
      (ch === "." || ch === "!" || ch === "?" || ch === "…") &&
      (i + 1 >= window.length || /\s/.test(window[i + 1]))
    ) {
      cut = i + 1;
      break;
    }
  }
  if (cut < 0) {
    const para = window.lastIndexOf("\n\n");
    if (para >= minKeep) cut = para;
  }
  if (cut < 0) {
    const sp = window.lastIndexOf(" ");
    cut = sp > Math.floor(limit * 0.4) ? sp : limit;
  }

  return text.slice(0, balancedHtmlCut(text, cut)).trimEnd();
}
