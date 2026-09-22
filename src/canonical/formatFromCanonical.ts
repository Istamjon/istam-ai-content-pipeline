/**
 * Derive all platform posts from one Canonical Content document.
 * Does NOT call AI — only formatting (limits, footer, hashtags, thread parts).
 * Policy: src/config/platformTextLimits.ts
 */
import type { Platform, FormattedPost } from "../agent/state.js";
import { buildBrandFooter } from "../config/brand.js";
import {
  getPlatformTextPolicy,
  smartTruncate,
  splitIntoThreadParts,
  truncateHtmlPrefix,
  platformLimits,
} from "../config/platformTextLimits.js";
import { env } from "../config/env.js";
import { cleanPostBody, cleanPostBodyRich } from "../lib/contentClean.js";
import { markdownToRichHtml } from "./markdownToRichHtml.js";
import type { CanonicalContent } from "./types.js";

export { platformLimits, smartTruncate, splitIntoThreadParts };

/**
 * Shared noise removal. `clean` decides whether markdown survives:
 * `cleanPostBody` flattens it (plain-text platforms), `cleanPostBodyRich`
 * keeps it (Telegram rich messages render it).
 */
function stripNoiseWith(text: string, clean: (s: string) => string): string {
  let t = clean(text);
  t = t
    .replace(/\n+\s*(Manba|Source|URL)\s*:\s*.+$/gim, "")
    .replace(/\n+\s*Author\s*:\s*.+$/gim, "")
    .replace(/\n+\s*Kuzatib boring:[\s\S]*$/gim, "")
    .replace(/\n+———[\s\S]*$/gim, "")
    .replace(/\n+────────[\s\S]*$/gim, "")
    .trim();
  return clean(t);
}

function stripNoise(text: string): string {
  return stripNoiseWith(text, cleanPostBody);
}

/** Same noise removal, but markdown structure survives for the rich path. */
function stripNoiseRich(text: string): string {
  return stripNoiseWith(text, cleanPostBodyRich);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Brand footer → rich-message footer.
 *
 * `buildBrandFooter` opens the Telegram footer with an ASCII rule
 * (`────────`). Rich messages have a real structural element for that, and
 * Telegram renders it as a `divider` block, so swap the text rule for `<hr/>`
 * and wrap the rest in `<footer>` (rendered as a `footer` block). Verified
 * live: this payload produced the block sequence
 * `photo → paragraph → divider → footer`.
 *
 * Returns "" when there is no footer, so `packText` drops it as usual.
 */
function richFooterBlock(footer: string): string {
  const lines = footer.split("\n");
  const first = (lines[0] || "").trim();
  const isAsciiRule = /^[─—–\-_=]{3,}$/.test(first);
  const rest = (isAsciiRule ? lines.slice(1) : lines).join("\n").trim();
  if (!rest) return isAsciiRule ? "<hr/>" : "";
  return `<hr/>\n<footer>${rest}</footer>`;
}

/**
 * Source attribution for the rich post.
 *
 * `cleanPostBody` strips `Manba:`/`Source:` lines, so the plain-text platforms
 * never carry a source link. A rich message CAN carry a real one, and for a
 * case study the source is the most useful link in the post — so re-add it from
 * the canonical URL rather than trusting a body line to survive.
 */
function richSourceLine(sourceUrl?: string): string {
  const url = (sourceUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  const host = url
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .replace(/^www\./i, "");
  const href = escapeHtml(url).replace(/"/g, "&quot;");
  return `<p>Manba: <a href="${href}">${escapeHtml(host)}</a></p>`;
}

/**
 * Telegram rich-message HTML — same content as `text`, richer rendering.
 *
 * Only Telegram uses this, and only on the rich path. The tags introduced here
 * (`<p>`, `<hr/>`, `<footer>`, headings, lists) are rejected by the classic
 * `parse_mode=HTML` parser (live probe: `Unsupported start tag "p"`), so this
 * must never be substituted into `text`/`caption`, which the fallback layout
 * also consumes.
 *
 * Unlike `text`, this keeps the body's markdown structure: headings become real
 * headings, `- ` runs become real lists, and `[label](url)` becomes a real link.
 *
 * `richLimit` is the RICH ceiling (32768), NOT the plain-text `softBodyTarget`.
 * Rich HTML is longer than the text it came from — every `<p>`, `<b>` and
 * `href` adds characters — so packing it against the text target would make
 * `packText` shed the hashtags, then the source link and footer, and finally
 * `smartTruncate` the HTML mid-tag. Telegram rejects a half-written tag, so the
 * rich send would fail and the post would silently degrade to the caption
 * layout: the feature would disappear exactly on the long posts that need it.
 */
function buildTelegramRichHtml(
  markdownBody: string,
  footer: string,
  hashtags: string,
  richLimit: number,
  sourceUrl?: string,
): string {
  const body = markdownToRichHtml(markdownBody);
  const attribution = [richSourceLine(sourceUrl), richFooterBlock(footer)]
    .filter(Boolean)
    .join("\n\n");
  return packText(body, attribution, hashtags, richLimit, false);
}

function buildContentHashtags(
  body: string,
  platform: Platform,
  max: number,
): string {
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
    if (!picked.some((t) => t.toLowerCase() === tag.toLowerCase()))
      picked.push(tag);
  };

  push("#IstamObidov");
  push("#AIEngineering");
  for (const { re, tag } of topicTags) {
    if (re.test(lower) || re.test(body)) push(tag);
  }
  const isEnglish = platform === "linkedin" || platform === "threads";
  if (!isEnglish && picked.length < 4) push("#OzbekistonTech");
  if (isEnglish && picked.length < 4) push("#Tech");
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

function formatOne(
  platform: Platform,
  body: string,
  hasImage: boolean,
  sourceUrl?: string,
): FormattedPost {
  const policy = getPlatformTextPolicy(platform);
  const clean = stripNoise(body);
  const footer = buildBrandFooter(platform, policy.footerMode);
  const hashtags = buildContentHashtags(clean, platform, policy.maxHashtags);
  const hard = policy.apiHardLimit;
  const soft = policy.softBodyTarget ?? hard;

  // Threads: multi-part chain
  if (policy.strategy === "threads_chain") {
    const maxParts = Math.max(1, Math.min(12, env.THREADS_MAX_PARTS || 6));
    // Body only in parts; tiny brand line on last part only if room
    const parts = splitIntoThreadParts(clean, hard, maxParts);
    if (parts.length === 0) {
      return {
        text: smartTruncate(clean, hard),
        hasImage,
        parts: [smartTruncate(clean, hard)],
      };
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

  // Telegram: the whole article ships inside Telegram itself — no external
  // long-form page. `text` is the complete channel post; `caption` is a strict
  // PREFIX of it, so the publisher sends the caption under the photo and
  // derives the continuation with a plain slice() (no duplicated opening).
  if (policy.strategy === "telegram_native") {
    const capHard = policy.captionHardLimit ?? 1024;
    const fullPacked = packText(
      escapeHtml(clean),
      footer,
      hashtags,
      soft,
      false,
    );
    const caption = truncateHtmlPrefix(fullPacked, capHard);
    // Rich variant of the SAME post. `text` above stays exactly as it was — the
    // caption/continuation fallback cannot parse rich-only tags — while the rich
    // variant keeps the body's markdown structure, re-adds the source link, and
    // is bounded by the rich ceiling rather than the plain-text soft target.
    const richHtml = buildTelegramRichHtml(
      stripNoiseRich(body),
      footer,
      hashtags,
      policy.richHardLimit ?? hard,
      sourceUrl,
    );
    console.log(
      `[format] ${platform} strategy=native full=${fullPacked.length} caption=${caption.length}/${capHard} rich=${richHtml.length}`,
    );
    return {
      text: fullPacked,
      caption,
      richHtml,
      hasImage,
    };
  }

  // full: LinkedIn, FB, IG, Blogger
  let core = clean;
  const target = Math.min(soft, hard);
  // Prefer using most of the limit
  if (core.length > target - footer.length - hashtags.length - 10) {
    const budget = Math.max(
      80,
      target -
        (footer ? footer.length + 2 : 0) -
        (hashtags ? hashtags.length + 2 : 0),
    );
    core = smartTruncate(core, budget);
  }
  const text = packText(core, footer, hashtags, hard, false);

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
    // THREADS and LINKEDIN posts are in English; all others are in Uzbek
    const isEnglishPlatform = platform === "linkedin" || platform === "threads";
    const platformBody = isEnglishPlatform ? doc.bodyEn || doc.body : doc.body;
    out[platform] = formatOne(platform, platformBody, hasImage, doc.sourceUrl);
  }
  return out;
}
