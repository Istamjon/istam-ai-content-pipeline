/**
 * Single source of truth for platform text limits + format strategy.
 * API hard limits must never be exceeded at publish time.
 */
import type { Platform } from "../agent/state.js";

export type TextStrategy =
  | "full"
  | "telegram_teaser"
  | "threads_chain"
  | "short_single";

export type FooterMode = "full" | "compact" | "none";

export type PlatformTextPolicy = {
  platform: Platform;
  /** Max chars for the primary text surface sent to the API */
  apiHardLimit: number;
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
    apiHardLimit: 4096,
    captionHardLimit: 1024,
    strategy: "telegram_teaser",
    maxHashtags: 5,
    footerMode: "compact",
    audienceNotes: "Uzbek tech learners — hook in channel, depth on Telegra.ph",
    styleNotes: "Clear practical Uzbek; HTML bold/links OK",
    formatFeatures: ["html", "photo_caption", "telegraph", "linebreaks"],
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
  const paras = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
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
