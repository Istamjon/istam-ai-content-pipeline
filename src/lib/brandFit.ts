/**
 * Brand-fit filter for Istam Obidov AI Engineering pipeline.
 * Rejects gaming / lifestyle / off-topic SEO bait early (before LLM spend).
 */

export type BrandFitResult = {
  ok: boolean;
  score: number;
  reason: string;
  positives: string[];
  negatives: string[];
};

/** Strong on-brand signals (title + body + url) */
const POSITIVE: Array<{ re: RegExp; w: number; label: string }> = [
  { re: /\b(ai\s*agent|agentic|multi[- ]?agent|autonomous\s+agent)\b/i, w: 4, label: "ai-agent" },
  { re: /\b(langgraph|langchain|llamaindex|semantic\s*kernel|crewai|autogen)\b/i, w: 4, label: "agent-framework" },
  { re: /\b(mcp|model\s+context\s+protocol)\b/i, w: 3, label: "mcp" },
  { re: /\b(llm|large\s+language\s+model|foundation\s+model)\b/i, w: 3, label: "llm" },
  { re: /\b(rag|retrieval[- ]augmented|vector\s+db|embedding)\b/i, w: 3, label: "rag" },
  { re: /\b(ai\s*engineering|ml\s*ops|mlops|llmops|prompt\s+engineering)\b/i, w: 3, label: "ai-eng" },
  { re: /\b(workflow|orchestration|automation|pipeline)\b/i, w: 2, label: "workflow" },
  { re: /\b(openai|anthropic|claude|gpt-?4|gpt-?5|gemini|llama|mistral)\b/i, w: 2, label: "model-vendor" },
  { re: /\b(transformer|neural|inference|fine[- ]?tun|tokeniz)\b/i, w: 2, label: "ml-core" },
  { re: /\b(developer|engineering|software\s+architect|production)\b/i, w: 1, label: "dev" },
  { re: /\b(api|sdk|open\s*source|github)\b/i, w: 1, label: "dev-tools" },
  { re: /\b(agent\s+skill|tool\s+use|function\s+call|tool[- ]calling)\b/i, w: 3, label: "agent-tools" },
];

/** Hard off-brand / SEO-bait / entertainment */
const NEGATIVE: Array<{ re: RegExp; w: number; label: string }> = [
  // Gaming
  { re: /\b(dead\s+by\s+daylight|dbd|fortnite|minecraft|roblox|valorant|cs:?go|call\s+of\s+duty|gta\s*[0-9]|league\s+of\s+legends|dota\s*2|genshin|steam\s+game)\b/i, w: 8, label: "gaming" },
  { re: /\b(skill\s+check|perk\s+build|loot\s+box|esports|speedrun|walkthrough|gameplay)\b/i, w: 5, label: "gaming-terms" },
  { re: /\b(xbox|playstation|nintendo|console\s+game)\b/i, w: 4, label: "console" },
  // Crypto / trading
  { re: /\b(bitcoin|btc|ethereum|crypto\s*currency|nft|airdrop|memecoin|defi|forex|binary\s+option)\b/i, w: 8, label: "crypto" },
  // Celebrity / gossip / lifestyle
  { re: /\b(celebrity|gossip|horoscope|dating\s+app|onlyfans)\b/i, w: 6, label: "lifestyle" },
  // Pure product spam without AI engineering depth
  { re: /\b(buy\s+now|limited\s+offer|coupon\s+code|weight\s+loss)\b/i, w: 5, label: "spam" },
  // Sports
  { re: /\b(nba|nfl|premier\s+league|world\s+cup|ufc)\b/i, w: 5, label: "sports" },
];

/** Title-only hard reject patterns (common SEO bait on AI blogs) */
const TITLE_HARD_REJECT: RegExp[] = [
  /\bdead\s+by\s+daylight\b/i,
  /\bfortnite\b/i,
  /\bminecraft\b/i,
  /\bhow\s+to\s+hack\b/i,
  /\bmake\s+money\s+fast\b/i,
  /\bcrypto\s+signal/i,
];

const MIN_SCORE = 3;

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
      // Title hits weight more
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

  // Gaming + weak AI mention (e.g. "agent" as game term) still reject
  if (negatives.includes("gaming") || negatives.includes("gaming-terms")) {
    const strongAi =
      positives.includes("ai-agent") ||
      positives.includes("agent-framework") ||
      positives.includes("llm") ||
      positives.includes("mcp");
    // "Agent Gates" gaming metaphor without real AI stack → fail
    if (!strongAi || score < MIN_SCORE + 2) {
      return {
        ok: false,
        score,
        reason: "gaming/off-topic bait (weak or no real AI-engineering signal)",
        positives,
        negatives,
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
    };
  }

  // Must have at least some AI/dev positive signal
  if (positives.length === 0) {
    return {
      ok: false,
      score,
      reason: "no AI Engineering / agents / LLM signals",
      positives,
      negatives,
    };
  }

  const ok = score >= MIN_SCORE && !negatives.includes("hard-title");
  return {
    ok,
    score,
    reason: ok
      ? `score=${score} positives=${positives.slice(0, 5).join(",")}`
      : `score=${score} below min ${MIN_SCORE} (${negatives.join(",") || "weak"})`,
    positives,
    negatives,
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
