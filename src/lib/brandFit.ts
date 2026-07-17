/**
 * Brand-fit filter for Istam Obidov AI Engineering pipeline.
 * Prefers primary AI-engineering sources; rejects gaming / lifestyle / SEO bait.
 */

export type BrandFitResult = {
  ok: boolean;
  score: number;
  reason: string;
  positives: string[];
  negatives: string[];
  /** Host preference boost applied (primary sources) */
  sourceBoost?: number;
};

/** Strong on-brand signals (title + body + url) */
const POSITIVE: Array<{ re: RegExp; w: number; label: string }> = [
  // Core agentic / frameworks
  {
    re: /\b(ai\s*agents?|ai\s+[\w-]+\s+agents?|agentic|multi[- ]?agent|autonomous\s+agents?|agent\s+system|research\s+agents?)\b/i,
    w: 5,
    label: "ai-agent",
  },
  {
    re: /\b(langgraph|langchain|llamaindex|semantic\s*kernel|crewai|autogen|haystack)\b/i,
    w: 5,
    label: "agent-framework",
  },
  { re: /\b(mcp|model\s+context\s+protocol)\b/i, w: 4, label: "mcp" },
  {
    re: /\b(llm|large\s+language\s+model|foundation\s+model|small\s+language\s+model|slm)\b/i,
    w: 4,
    label: "llm",
  },
  {
    re: /\b(rag|retrieval[- ]augmented|vector\s+(db|database|store)|embedding|chunking)\b/i,
    w: 4,
    label: "rag",
  },
  {
    re: /\b(ai\s*engineering|ml\s*ops|mlops|llmops|prompt\s+engineering|context\s+engineering)\b/i,
    w: 4,
    label: "ai-eng",
  },
  {
    re: /\b(agent\s+skill|tool\s+use|function\s+call|tool[- ]calling|tool[- ]use|function[- ]calling)\b/i,
    w: 4,
    label: "agent-tools",
  },
  {
    re: /\b(orchestrat|workflow|automation|pipeline|state\s+machine|graph\s+workflow)\b/i,
    w: 3,
    label: "workflow",
  },
  {
    re: /\b(eval|evaluation|guardrail|observability|tracing|hallucinat|grounding)\b/i,
    w: 3,
    label: "prod-quality",
  },
  {
    re: /\b(openai|anthropic|claude|gpt-?[45]|gemini|llama|mistral|deepseek|qwen)\b/i,
    w: 2,
    label: "model-vendor",
  },
  {
    re: /\b(transformer|neural|inference|fine[- ]?tun|tokeniz|diffusion|multimodal)\b/i,
    w: 2,
    label: "ml-core",
  },
  {
    re: /\b(deepmind|alphafold|gemini\s+2|gemini\s+3|research\s+release)\b/i,
    w: 2,
    label: "research-lab",
  },
  {
    re: /\b(production|deploy|scalab|latency|cost\s+optim|architecture)\b/i,
    w: 2,
    label: "production",
  },
  // Modern full-stack (brand pillars: React, Next.js, Node, Python, Django, APIs, JS/TS)
  {
    re: /\b(next\.?js|nextjs)\b/i,
    w: 4,
    label: "nextjs",
  },
  {
    re: /\b(react\.?js|react\s*native|\breact\b)\b/i,
    w: 3,
    label: "react",
  },
  {
    re: /\b(node\.?js|nodejs|express\.?js|nestjs|fastify)\b/i,
    w: 3,
    label: "nodejs",
  },
  {
    re: /\b(type\s*script|typescript|\.tsx?\b)\b/i,
    w: 3,
    label: "typescript",
  },
  {
    re: /\b(java\s*script|javascript|\.jsx?\b|es6|es202[0-9])\b/i,
    w: 2,
    label: "javascript",
  },
  {
    re: /\b(python|django|flask|fastapi|uvicorn)\b/i,
    w: 3,
    label: "python-stack",
  },
  {
    re: /\b(rest\s*api|graphql|openapi|swagger|web\s*api|api\s*design|api\s*gateway|endpoint)\b/i,
    w: 3,
    label: "apis",
  },
  {
    re: /\b(developer|software\s+engineer|software\s+architect|fullstack|full[- ]stack)\b/i,
    w: 1,
    label: "dev",
  },
  { re: /\b(sdk|open\s*source|github)\b/i, w: 1, label: "dev-tools" },
];

/** Strong AI engineering (not generic lifestyle) */
const STRONG_AI_LABELS = new Set([
  "ai-agent",
  "agent-framework",
  "mcp",
  "llm",
  "rag",
  "ai-eng",
  "agent-tools",
  "workflow",
  "prod-quality",
  "model-vendor",
  "ml-core",
  "research-lab",
]);

/**
 * Strong engineering stack — counts for secondary sources (TDS / Plain English)
 * so React/Next/Node/Python/Django/API posts are not rejected as "weak AI".
 */
const STRONG_STACK_LABELS = new Set([
  "nextjs",
  "react",
  "nodejs",
  "typescript",
  "javascript",
  "python-stack",
  "apis",
  "production",
]);

/** Hard off-brand / SEO-bait / entertainment */
const NEGATIVE: Array<{ re: RegExp; w: number; label: string }> = [
  {
    re: /\b(dead\s+by\s+daylight|dbd|fortnite|minecraft|roblox|valorant|cs:?go|call\s+of\s+duty|gta\s*[0-9]|league\s+of\s+legends|dota\s*2|genshin|steam\s+game)\b/i,
    w: 8,
    label: "gaming",
  },
  {
    re: /\b(skill\s+check|perk\s+build|loot\s+box|esports|speedrun|walkthrough|gameplay)\b/i,
    w: 5,
    label: "gaming-terms",
  },
  { re: /\b(xbox|playstation|nintendo|console\s+game)\b/i, w: 4, label: "console" },
  {
    re: /\b(bitcoin|btc|ethereum|crypto\s*currency|nft|airdrop|memecoin|defi|forex|binary\s+option)\b/i,
    w: 8,
    label: "crypto",
  },
  { re: /\b(celebrity|gossip|horoscope|dating\s+app|onlyfans)\b/i, w: 6, label: "lifestyle" },
  {
    re: /\b(buy\s+now|limited\s+offer|coupon\s+code|weight\s+loss)\b/i,
    w: 5,
    label: "spam",
  },
  { re: /\b(nba|nfl|premier\s+league|world\s+cup|ufc)\b/i, w: 5, label: "sports" },
  // Soft noise on general blogs (not hard reject alone)
  {
    re: /\b(recipe|fashion|travel\s+guide|beauty\s+tips|relationship\s+advice)\b/i,
    w: 4,
    label: "offtopic-soft",
  },
];

const TITLE_HARD_REJECT: RegExp[] = [
  /\bdead\s+by\s+daylight\b/i,
  /\bfortnite\b/i,
  /\bminecraft\b/i,
  /\bhow\s+to\s+hack\b/i,
  /\bmake\s+money\s+fast\b/i,
  /\bcrypto\s+signal/i,
];

/** Default minimum content score (before source boost is enough alone). */
const MIN_SCORE = 4;

/**
 * Preferred crawl hosts — aligned with brand.sources primary list.
 * Higher boost = preferred when ranking batch.
 */
const PREFERRED_SOURCES: Array<{
  host: string;
  boost: number;
  label: string;
  /** Require strong AI signal (generic fullstack noise filter) */
  requireStrongAi?: boolean;
  /**
   * If true with requireStrongAi: only STRONG_AI labels count
   * (not React/Next stack alone — for mixed agent directories / news hubs).
   */
  aiOnly?: boolean;
  /** Higher bar after boost for noisy general blogs */
  minScore?: number;
}> = [
  { host: "actualize.co", boost: 6, label: "src-actualize" },
  { host: "the-agentic-engineer.com", boost: 6, label: "src-agentic-eng" },
  { host: "skywork.ai", boost: 5, label: "src-skywork" },
  // Agent directory news — mixed listicles; AI/agent only (not bare Next.js SEO)
  {
    host: "aiagentstore.ai",
    boost: 5,
    label: "src-aiagentstore",
    requireStrongAi: true,
    aiOnly: true,
    minScore: 5,
  },
  { host: "deepmind.google", boost: 4, label: "src-deepmind" },
  // TDS agentic category still hosts some off-topic; require real AI signal
  {
    host: "towardsdatascience.com",
    boost: 4,
    label: "src-tds",
    requireStrongAi: true,
    minScore: 5,
  },
  // Fullstack topic is noisy — only keep clear AI/agent/LLM posts
  {
    host: "plainenglish.io",
    boost: 2,
    label: "src-plainenglish",
    requireStrongAi: true,
    minScore: 6,
  },
];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export function matchPreferredSource(url: string): {
  boost: number;
  label: string;
  requireStrongAi: boolean;
  aiOnly: boolean;
  minScore: number;
} | null {
  const host = hostnameOf(url);
  if (!host) return null;
  for (const s of PREFERRED_SOURCES) {
    if (host === s.host || host.endsWith(`.${s.host}`)) {
      return {
        boost: s.boost,
        label: s.label,
        requireStrongAi: Boolean(s.requireStrongAi),
        aiOnly: Boolean(s.aiOnly),
        minScore: s.minScore ?? MIN_SCORE,
      };
    }
  }
  return null;
}

function hasStrongAi(positives: string[]): boolean {
  return positives.some((p) => STRONG_AI_LABELS.has(p));
}

function hasStrongStack(positives: string[]): boolean {
  return positives.some((p) => STRONG_STACK_LABELS.has(p));
}

/** Topic is on-brand for secondary sources: AI *or* modern full-stack. */
function hasStrongTopic(positives: string[]): boolean {
  const content = positives.filter((p) => !p.startsWith("src-"));
  return hasStrongAi(content) || hasStrongStack(content);
}

/**
 * Score title+snippet+url for brand fit.
 * ok=false → skip before/during pipeline.
 */
export function scoreBrandFit(input: {
  title: string;
  text?: string;
  url?: string;
}): BrandFitResult {
  const title = input.title || "";
  const text = (input.text || "").slice(0, 4000);
  const url = input.url || "";
  const blob = `${title}\n${url}\n${text}`;

  for (const re of TITLE_HARD_REJECT) {
    if (re.test(title) || re.test(url)) {
      return {
        ok: false,
        score: -20,
        reason: `hard-reject title/url: ${re.source.slice(0, 40)}`,
        positives: [],
        negatives: ["hard-title"],
      };
    }
  }

  let score = 0;
  const positives: string[] = [];
  const negatives: string[] = [];

  for (const { re, w, label } of POSITIVE) {
    if (re.test(blob)) {
      score += w;
      if (re.test(title)) score += 1;
      positives.push(label);
    }
  }

  for (const { re, w, label } of NEGATIVE) {
    if (re.test(blob)) {
      score -= w;
      if (re.test(title)) score -= 2;
      negatives.push(label);
    }
  }

  const src = matchPreferredSource(url);
  let sourceBoost = 0;
  if (src) {
    sourceBoost = src.boost;
    score += sourceBoost;
    positives.push(src.label);
  }

  // Gaming + weak tech mention still reject
  if (negatives.includes("gaming") || negatives.includes("gaming-terms")) {
    const strong = hasStrongTopic(positives);
    if (!strong || score < MIN_SCORE + 3) {
      return {
        ok: false,
        score,
        reason: "gaming/off-topic bait (weak or no real engineering signal)",
        positives,
        negatives,
        sourceBoost,
      };
    }
  }

  if (negatives.includes("crypto") || negatives.includes("spam")) {
    return {
      ok: false,
      score,
      reason: "never-publish topic (crypto/spam)",
      positives,
      negatives,
      sourceBoost,
    };
  }

  if (positives.length === 0 || (positives.length === 1 && positives[0]?.startsWith("src-"))) {
    return {
      ok: false,
      score,
      reason: "no AI Engineering / full-stack (React/Next/Node/Python/API) signals",
      positives,
      negatives,
      sourceBoost,
    };
  }

  // Noisy hubs: require AI *or* modern stack; aiOnly hosts need real AI/agent signal
  if (src?.requireStrongAi) {
    const contentPos = positives.filter((p) => !p.startsWith("src-"));
    const topicOk = src.aiOnly
      ? hasStrongAi(contentPos)
      : hasStrongTopic(positives);
    if (!topicOk) {
      return {
        ok: false,
        score,
        reason: src.aiOnly
          ? `weak AI signal for ${src.label} (need agents/LLM/RAG/automation — not bare stack SEO)`
          : `weak topic for ${src.label} (need AI agents/LLM/RAG or React/Next/Node/Python/Django/API)`,
        positives,
        negatives,
        sourceBoost,
      };
    }
  }

  const minNeeded = src?.minScore ?? MIN_SCORE;
  const ok = score >= minNeeded && !negatives.includes("hard-title");

  return {
    ok,
    score,
    reason: ok
      ? `score=${score} (+src ${sourceBoost}) ${positives.filter((p) => !p.startsWith("src-")).slice(0, 5).join(",") || "ok"}`
      : `score=${score} below min ${minNeeded} (${negatives.join(",") || "weak"})`,
    positives,
    negatives,
    sourceBoost,
  };
}

export function isBrandFitTitleUrl(title: string, url: string): BrandFitResult {
  return scoreBrandFit({ title, url, text: "" });
}

/** Parse analyst FIT line */
export function parseAnalystFit(summary: string): "ha" | "yoq" | "qisman" | "unknown" {
  const m = summary.match(/FIT:\s*(ha|yo'?q|qisman)/i);
  if (!m) return "unknown";
  const v = m[1].toLowerCase().replace("'", "");
  if (v === "ha") return "ha";
  if (v.startsWith("yo")) return "yoq";
  if (v.startsWith("qis")) return "qisman";
  return "unknown";
}
