/**
 * Derive all platform posts from one Canonical Content document.
 * Does NOT call AI — only formatting (limits, footer, hashtags).
 * Facts stay identical to canonical.body on every platform.
 */
import type { Platform, FormattedPost } from "../agent/state.js";
import { brand, buildBrandFooter, platformLimits } from "../config/brand.js";
import { env } from "../config/env.js";
import { stripSourceIntros } from "../lib/contentClean.js";
import type { CanonicalContent } from "./types.js";

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3).trimEnd() + "...";
}

/**
 * Cut at sentence / paragraph boundary — never mid-word when possible.
 * For Threads/X so posts stay complete thoughts within hard limits.
 */
function smartTruncate(text: string, limit: number): string {
  const t = text.trim();
  if (t.length <= limit) return t;
  if (limit < 24) return truncate(t, limit);

  const window = t.slice(0, limit);
  // Prefer end of sentence in the last 70% of the window
  const minKeep = Math.floor(limit * 0.45);
  const sentenceEnds: number[] = [];
  for (let i = minKeep; i < window.length; i++) {
    const ch = window[i];
    if ((ch === "." || ch === "!" || ch === "?" || ch === "…") && (i + 1 >= window.length || /\s/.test(window[i + 1]))) {
      sentenceEnds.push(i + 1);
    }
  }
  if (sentenceEnds.length) {
    return window.slice(0, sentenceEnds[sentenceEnds.length - 1]).trim();
  }

  // Prefer paragraph break
  const para = window.lastIndexOf("\n\n");
  if (para >= minKeep) {
    return window.slice(0, para).trim();
  }

  // Prefer word boundary
  const space = window.lastIndexOf(" ");
  if (space >= minKeep) {
    return window.slice(0, space).trimEnd() + "…";
  }

  return truncate(t, limit);
}

/**
 * Short-form body for Threads/X from canonical master.
 * Uses first complete thoughts (hook), not a random mid-cut of a long essay.
 */
function shortFormBody(clean: string, maxChars: number): string {
  const paras = clean
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Build from leading sentences
  const sentences: string[] = [];
  for (const p of paras) {
    const parts = p.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [p];
    for (const s of parts) {
      const one = s.trim();
      if (one) sentences.push(one);
    }
    if (sentences.length >= 4) break;
  }

  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length <= maxChars) {
      out = next;
    } else if (!out) {
      return smartTruncate(s, maxChars);
    } else {
      break;
    }
  }

  if (!out) return smartTruncate(clean.replace(/\s+/g, " ").trim(), maxChars);
  return out;
}

function stripNoise(text: string): string {
  let t = stripSourceIntros(text);
  t = t
    .replace(/\n+\s*(Manba|Source|URL)\s*:\s*.+$/gim, "")
    .replace(/\n+\s*Author\s*:\s*.+$/gim, "")
    .replace(/\n+\s*Kuzatib boring:[\s\S]*$/gim, "")
    .replace(/\n+———[\s\S]*$/gim, "")
    .replace(/\n+────────[\s\S]*$/gim, "")
    .trim();
  return stripSourceIntros(t);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function brandFooter(platform: Platform): string {
  return buildBrandFooter(platform);
}

function buildContentHashtags(body: string, platform: Platform): string {
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
  if (picked.length < 5) push("#OzbekistonTech");
  if (picked.length < 6) push("#ProductionAI");

  let max = 5;
  if (platform === "x") max = 2;
  else if (platform === "threads") max = 3;
  else if (platform === "linkedin") max = 6;
  else if (platform === "telegram") max = 5;

  return picked.slice(0, max).join(" ");
}

function formatOne(
  platform: Platform,
  body: string,
  hasImage: boolean,
): FormattedPost {
  const limit = platformLimits[platform] || 1000;
  const clean = stripNoise(body);
  const footer = brandFooter(platform);
  // Short platforms: fewer hashtags so body keeps complete sentences
  const hashtags = buildContentHashtags(clean, platform);
  const suffix = `\n\n${footer}\n\n${hashtags}`;
  const bodyBudget = Math.max(limit - suffix.length - 2, platform === "x" ? 60 : 80);

  let core: string;
  if (platform === "threads" || platform === "x") {
    core = shortFormBody(clean, bodyBudget);
  } else if (platform === "telegram") {
    // Full canonical body → Telegra.ph; channel gets teaser in publish layer.
    // Keep generous body here (up to Telegram hard limit) for the Telegraph page.
    core = smartTruncate(clean, Math.min(bodyBudget, 12000));
  } else {
    core = smartTruncate(clean, bodyBudget);
  }

  if (platform === "telegram") {
    core = escapeHtml(core);
  }

  let text = `${core}${suffix}`;
  if (text.length > limit) {
    // Last-resort: shrink body further with smart cut
    const tighter = Math.max(40, bodyBudget - (text.length - limit) - 4);
    core =
      platform === "threads" || platform === "x"
        ? shortFormBody(clean, tighter)
        : smartTruncate(clean, tighter);
    if (platform === "telegram") core = escapeHtml(core);
    text = smartTruncate(`${core}${suffix}`, limit);
  }

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
 * Instagram requires image — returns null if no image.
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
