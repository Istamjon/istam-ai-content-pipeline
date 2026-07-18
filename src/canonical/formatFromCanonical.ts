/**
 * Derive all platform posts from one Canonical Content document.
 * Does NOT call AI — only formatting (limits, footer, hashtags, thread parts).
 * Policy: src/config/platformTextLimits.ts
 */
import type { Platform, FormattedPost } from "../agent/state.js";
import { brand, buildBrandFooter } from "../config/brand.js";
import {
  getPlatformTextPolicy,
  smartTruncate,
  splitIntoThreadParts,
  platformLimits,
} from "../config/platformTextLimits.js";
import { env } from "../config/env.js";
import { cleanPostBody } from "../lib/contentClean.js";
import type { CanonicalContent } from "./types.js";

export { platformLimits, smartTruncate, splitIntoThreadParts };

function stripNoise(text: string): string {
  let t = cleanPostBody(text);
  t = t
    .replace(/\n+\s*(Manba|Source|URL)\s*:\s*.+$/gim, "")
    .replace(/\n+\s*Author\s*:\s*.+$/gim, "")
    .replace(/\n+\s*Kuzatib boring:[\s\S]*$/gim, "")
    .replace(/\n+———[\s\S]*$/gim, "")
    .replace(/\n+────────[\s\S]*$/gim, "")
    .trim();
  return cleanPostBody(t);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildContentHashtags(body: string, platform: Platform, max: number): string {
  if (max <= 0) return "";
  const lower = body.toLowerCase();
  const topicTags: Array<{ re: RegExp; tag: string }> = [
    { re: /\b(ai\s*agent|agentic|agentlar|agent)\b/i, tag: "#AIAgent" },
    { re: /\b(llm|large language|til modeli)\b/i, tag: "#LLM" },
    { re: /\b(mcp|model context protocol)\b/i, tag: "#MCP" },
    { re: /\b(langchain)\b/i, tag: "#LangChain" },
    { re: /\b(automation|avtomat|workflow|ish oqim)\b/i, tag: "#AIAutomation" },
    { re: /\b(rag|retrieval)\b/i, tag: "#RAG" },
    { re: /\b(prompt|prompting)\b/i, tag: "#PromptEngineering" },
    { re: /\b(production|ishlab chiqarish|deploy)\b/i, tag: "#ProductionAI" },
    { re: /\b(coding agent|kod agent|shell)\b/i, tag: "#CodingAgent" },
    { re: /\b(tool|vosita|asbob|skill|ko'?nikma)\b/i, tag: "#AITools" },
    { re: /\b(openai|gpt)\b/i, tag: "#OpenAI" },
    { re: /\b(open\s*source|ochiq manba)\b/i, tag: "#OpenSourceAI" },
    { re: /\b(architecture|arxitektur)\b/i, tag: "#AIArchitecture" },
    { re: /\b(tutorial|qo'?llanma|bosqich)\b/i, tag: "#AITutorial" },
  ];

  const picked: string[] = [];
  const push = (tag: string) => {
    if (tag.toLowerCase() === "#langgraph") return;
    if (!picked.some((t) => t.toLowerCase() === tag.toLowerCase())) picked.push(tag);
  };

  push("#IstamObidov");
  push("#AIEngineering");
  for (const { re, tag } of topicTags) {
    if (re.test(lower) || re.test(body)) push(tag);
  }
  if (picked.length < 4) push("#OzbekistonTech");
  if (picked.length < 5) push("#ProductionAI");

  return picked.slice(0, max).join(" ");
}

/**
 * Pack body + optional footer + hashtags under hard limit.
 * Priority: body > footer > hashtags (drop tags first, then shrink body).
 */
function packText(
  body: string,
  footer: string,
  hashtags: string,
  hardLimit: number,
  preferShortForm: boolean,
): string {
  const join = (b: string, f: string, h: string) => {
    let t = b.trim();
    if (f.trim()) t = `${t}\n\n${f.trim()}`;
    if (h.trim()) t = `${t}\n\n${h.trim()}`;
    return t;
  };

  let tags = hashtags;
  let foot = footer;
  let core = body.trim();

  let packed = join(core, foot, tags);
  if (packed.length <= hardLimit) return packed;

  // Drop hashtags first
  tags = "";
  packed = join(core, foot, tags);
  if (packed.length <= hardLimit) return packed;

  // Compact / drop footer
  foot = "";
  packed = join(core, foot, tags);
  if (packed.length <= hardLimit) return packed;

  // Shrink body
  const budget = Math.max(40, hardLimit - 4);
  core = preferShortForm
    ? shortFormBody(core, budget)
    : smartTruncate(core, budget);
  return smartTruncate(join(core, "", ""), hardLimit);
}

function shortFormBody(clean: string, maxChars: number): string {
  const paras = clean
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const sentences: string[] = [];
  for (const p of paras) {
    const parts = p.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [p];
    for (const s of parts) {
      const one = s.trim();
      if (one) sentences.push(one);
    }
    if (sentences.length >= 6) break;
  }

  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length <= maxChars) out = next;
    else if (!out) return smartTruncate(s, maxChars);
    else break;
  }
  if (!out) return smartTruncate(clean.replace(/\s+/g, " ").trim(), maxChars);
  // Fill remaining budget with more sentences if room
  return out;
}

/** Telegram media caption: complete thoughts, ≤ hard (HTML-safe plain then escape). */
export function buildMediaCaption(
  cleanBody: string,
  hardLimit: number,
  opts?: { telegraphUrl?: string; includeFooter?: boolean },
): string {
  const limit = Math.max(80, hardLimit - 8);
  const footer = opts?.includeFooter
    ? buildBrandFooter("telegram", "compact")
    : "";
  const linkBlock = opts?.telegraphUrl
    ? `\n\n📖 <b>Toʻliq maqola</b>\n<a href="${escapeHtml(opts.telegraphUrl)}">${escapeHtml(opts.telegraphUrl)}</a>`
    : "";

  const reserved = (footer ? footer.length + 2 : 0) + linkBlock.length;
  const hookBudget = Math.max(60, limit - reserved);

  const plain = cleanBody
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let hook = shortFormBody(plain, hookBudget);
  hook = smartTruncate(hook, hookBudget);

  let caption = `${escapeHtml(hook)}${linkBlock}`;
  if (footer) caption = `${caption}\n\n${footer}`;

  if (caption.length > hardLimit) {
    // Drop footer, keep link
    caption = `${escapeHtml(smartTruncate(plain, Math.max(40, hardLimit - linkBlock.length - 4)))}${linkBlock}`;
  }
  if (caption.length > hardLimit) {
    caption = smartTruncate(
      caption.replace(/<[^>]+>/g, ""),
      hardLimit,
    );
  }
  return caption.slice(0, hardLimit);
}

function formatOne(
  platform: Platform,
  body: string,
  hasImage: boolean,
): FormattedPost {
  const policy = getPlatformTextPolicy(platform);
  const clean = stripNoise(body);
  const footer = buildBrandFooter(platform, policy.footerMode);
  const hashtags = buildContentHashtags(clean, platform, policy.maxHashtags);
  const hard = policy.apiHardLimit;
  const soft = policy.softBodyTarget ?? hard;

  // Threads: multi-part chain
  if (policy.strategy === "threads_chain") {
    const maxParts = Math.max(
      1,
      Math.min(12, env.THREADS_MAX_PARTS || 6),
    );
    // Body only in parts; tiny brand line on last part only if room
    const parts = splitIntoThreadParts(clean, hard, maxParts);
    if (parts.length === 0) {
      return { text: smartTruncate(clean, hard), hasImage, parts: [smartTruncate(clean, hard)] };
    }
    // Optional last-part hashtag if space
    const tags = buildContentHashtags(clean, platform, policy.maxHashtags);
    if (tags) {
      const last = parts[parts.length - 1];
      const withTags = `${last}\n\n${tags}`;
      if (withTags.length <= hard) parts[parts.length - 1] = withTags;
    }
    console.log(
      `[format] ${platform} strategy=threads_chain parts=${parts.length} lens=[${parts.map((p) => p.length).join(",")}] hard=${hard}`,
    );
    return {
      text: parts[0],
      parts,
      hasImage:
        hasImage &&
        (platform === "instagram" ||
          platform === "telegram" ||
          platform === "facebook" ||
          platform === "linkedin" ||
          platform === "x" ||
          platform === "threads"),
    };
  }

  // Short single (X)
  if (policy.strategy === "short_single") {
    const tags = buildContentHashtags(clean, platform, policy.maxHashtags);
    const tagBudget = tags ? tags.length + 2 : 0;
    const core = shortFormBody(clean, Math.max(40, hard - tagBudget));
    const text = packText(core, "", tags, hard, true);
    console.log(
      `[format] ${platform} strategy=short total=${text.length}/${hard}`,
    );
    return {
      text,
      hasImage: hasImage && (platform === "x" || platform === "threads"),
    };
  }

  // Telegram: full text for Telegraph; caption prepared without URL (URL at publish)
  if (policy.strategy === "telegram_teaser") {
    const capHard = policy.captionHardLimit ?? 1024;
    // Full channel text for Telegra.ph source (HTML body)
    const fullCore = clean;
    const fullPacked = packText(
      escapeHtml(fullCore),
      footer,
      hashtags,
      Math.min(soft, 12000),
      false,
    );
    const caption = buildMediaCaption(clean, capHard, {
      includeFooter: true,
    });
    console.log(
      `[format] ${platform} strategy=teaser full=${fullPacked.length} caption=${caption.length}/${capHard}`,
    );
    return {
      text: fullPacked,
      caption,
      hasImage: hasImage,
    };
  }

  // full: LinkedIn, FB, IG, Blogger
  let core = clean;
  const target = Math.min(soft, hard);
  // Prefer using most of the limit
  if (core.length > target - footer.length - hashtags.length - 10) {
    const budget = Math.max(
      80,
      target - (footer ? footer.length + 2 : 0) - (hashtags ? hashtags.length + 2 : 0),
    );
    core = smartTruncate(core, budget);
  }
  let text = packText(core, footer, hashtags, hard, false);

  // If under-utilizing a lot on long platforms, keep as-is (canonical may be short)
  console.log(
    `[format] ${platform} strategy=full total=${text.length}/${hard} body≈${core.length}`,
  );

  return {
    text,
    hasImage:
      hasImage &&
      (platform === "instagram" ||
        platform === "telegram" ||
        platform === "facebook" ||
        platform === "linkedin" ||
        platform === "x" ||
        platform === "threads"),
  };
}

export function enabledPlatforms(): Platform[] {
  const all: Platform[] = [
    "telegram",
    "linkedin",
    "facebook",
    "instagram",
    "x",
    "threads",
    "blogger",
  ];
  const enabled = new Set(
    (env.ENABLED_PLATFORMS?.length
      ? env.ENABLED_PLATFORMS
      : ["telegram", "linkedin", "facebook", "instagram", "threads"]
    ).map((p) => p.toLowerCase()),
  );
  return all.filter((p) => enabled.has(p));
}

/**
 * Format every enabled platform from canonical master body.
 */
export function formatAllFromCanonical(
  doc: CanonicalContent,
  platforms?: Platform[],
): Record<Platform, FormattedPost | null> {
  const list = platforms ?? enabledPlatforms();
  const hasImage = Boolean(doc.imagePath);
  const body = doc.body;
  const out = {
    telegram: null,
    linkedin: null,
    facebook: null,
    instagram: null,
    x: null,
    threads: null,
    blogger: null,
  } as Record<Platform, FormattedPost | null>;

  for (const platform of list) {
    if (platform === "instagram" && !hasImage) {
      out[platform] = null;
      continue;
    }
    out[platform] = formatOne(platform, body, hasImage);
  }
  return out;
}
