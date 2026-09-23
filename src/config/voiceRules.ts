/**
 * Voice rules — the single source of truth for "what Istam Obidov sounds like".
 *
 * Why this file exists. The rules used to live in three unrelated places:
 *   - as prose inside `agent/prompts.ts` (COPY_CRAFT section F),
 *   - as a hardcoded array inside `agent/nodes/qualityCheck.ts`,
 *   - as intent inside `config/brand.ts`.
 * Nothing kept them in sync and nothing tested them, so a post could ship using
 * a term the brand had already decided against and no check anywhere noticed.
 * The live example: `evaluator` was rendered as "hakam" — which in Uzbek means a
 * sports referee — while the brand's own promise is "explain complex AI simply".
 *
 * Two consumers read from here, so they cannot drift:
 *   - `agent/prompts.ts` renders these into the writer instructions
 *   - `lib/voiceLint.ts` checks the produced text against them
 */

/**
 * Uzbek apostrophe variants seen in real output.
 * The published posts mix U+2018, U+2019, U+02BB and U+02BC for the same sound,
 * so every pattern below has to tolerate all of them or it silently misses.
 */
const APO = "['\u2018\u2019\u02BB\u02BC`]";

/** A banned phrase: `phrase` for the prompt, `re` for the lint. */
export type BannedPhrase = {
  /** Literal wording, shown to the writer. */
  phrase: string;
  /** Short human label used in lint output. */
  label: string;
  re: RegExp;
};

/** Generic openers — the post must start with the idea, not a warm-up. */
export const BANNED_OPENERS: readonly BannedPhrase[] = [
  {
    phrase: "Bugungi tez o'zgarayotgan dunyoda",
    label: "generic world-changed opener",
    re: new RegExp(`bugungi\\s+tez\\s+o${APO}?zgarayotgan\\s+dunyoda`, "i"),
  },
  {
    phrase: "Sun'iy intellekt hayotimizni o'zgartirmoqda",
    label: '"AI is changing our lives" opener',
    re: new RegExp(
      `sun${APO}?iy\\s+intellekt\\s+hayotimizni\\s+o${APO}?zgartirmoqda`,
      "i",
    ),
  },
  {
    phrase: "In today's fast-paced world",
    label: "fast-paced-world opener",
    re: /in\s+today['\u2018\u2019]?s\s+fast-?paced\s+world/i,
  },
  {
    phrase: "AI is changing everything",
    label: '"AI is changing everything" opener',
    re: /ai\s+is\s+changing\s+everything/i,
  },
];

/** Site-name / attribution intros — start with the idea, not the publisher. */
export const BANNED_ATTRIBUTION_INTROS: readonly BannedPhrase[] = [
  {
    phrase: 'Yangi … maqolasi:',
    label: '"Yangi … maqolasi:" intro',
    re: /yangi\s+[\w\s.'\u2018\u2019-]*maqolasi\s*:/i,
  },
  {
    phrase: "Skywork AI maqolasi / DeepMind maqolasi",
    label: "source-name intro",
    re: /(skywork(\s+ai)?|deepmind)\s+maqolasi/i,
  },
];

/** Rhetorical filler that reads as padding. */
export const RHETORICAL_FILLERS: readonly BannedPhrase[] = [
  {
    phrase: "Tasavvur qiling…",
    label: "imagine-filler",
    re: /tasavvur\s+qiling/i,
  },
  { phrase: "Bilasizmi…", label: "did-you-know filler", re: /bilasizmi/i },
  { phrase: "Imagine…", label: "imagine-filler (EN)", re: /\bimagine\b/i },
];

/**
 * Empty intensifiers — replace with the actual number from the source, or drop.
 * Uzbek and English are listed separately because they appear in different
 * surfaces (the Uzbek master body vs the English LinkedIn/Threads post).
 */
export const BANNED_INTENSIFIERS_UZ: readonly BannedPhrase[] = [
  "juda",
  "nihoyatda",
  "hayratlanarli",
  "kuchli",
  "inqilobiy",
  "shubhasiz",
  "albatta",
  "ma'lumki",
].map((w) => ({
  phrase: w,
  label: `intensifier "${w}"`,
  re: new RegExp(`(^|[^\\p{L}])${w.replace("'", APO)}([^\\p{L}]|$)`, "iu"),
}));

export const BANNED_INTENSIFIERS_EN: readonly BannedPhrase[] = [
  "powerful",
  "revolutionary",
  "game-changing",
  "groundbreaking",
  "seamless",
].map((w) => ({
  phrase: w,
  label: `intensifier "${w}"`,
  re: new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "iu"),
}));

/**
 * Term glossary.
 *
 * The brand promise is that a reader finishes the post understanding the
 * technology. That only holds if the same concept is named the same way every
 * time — the live post rendered `evaluator` as "hakam" (a sports referee), which
 * a junior reader cannot map back to the LangSmith concept.
 */
export const GLOSSARY = {
  /** Industry's own names — keep them in English, never translate. */
  keepEnglish: [
    "LangGraph",
    "LangChain",
    "LangSmith",
    "Deep Agents",
    "Align Evaluator",
    "LLM",
    "MCP",
    "API",
    "agent",
    "prompt",
    "token",
    "embedding",
    "fine-tuning",
    "inference",
    "latency",
    "pipeline",
    "workflow",
  ],
  /** Preferred Uzbek rendering — write it this way, every post. */
  preferredUz: [
    { en: "evaluator / judge", uz: "baholovchi" },
    { en: "dataset", uz: "ma'lumotlar to'plami" },
    { en: "observability", uz: "kuzatuvchanlik" },
    { en: "tool call", uz: "asbob chaqiruvi" },
    { en: "retrieval", uz: "qidirib olish" },
    { en: "release cycle", uz: "reliz sikli" },
    { en: "trace", uz: "iz" },
  ],
  /** Renderings that must NOT appear — they mislead the reader. */
  bannedUz: [
    {
      uz: "hakam",
      useInstead: "baholovchi",
      why: "Uzbek \"hakam\" means a sports referee, not an LLM evaluator",
      /**
       * STEM match, not a whole-word match. Uzbek is agglutinative, so the real
       * text says "hakamlar", "hakamning", "hakamlar va" — a `[^\p{L}]` boundary
       * after the stem matches none of them and the violation sails through.
       * Verified against the live post, which reads "eng malakali hakamlar".
       */
      re: new RegExp(`(^|[^\\p{L}])hakam\\p{L}*`, "iu"),
    },
  ],
} as const;

/** Render the glossary as prompt instructions. */
export function glossaryBlock(): string {
  const keep = GLOSSARY.keepEnglish.join(", ");
  const prefer = GLOSSARY.preferredUz.map((p) => `"${p.en}" → "${p.uz}"`).join(
    "; ",
  );
  const banned = GLOSSARY.bannedUz
    .map((b) => `never write "${b.uz}" — write "${b.useInstead}" (${b.why})`)
    .join("; ");
  return [
    "TERM GLOSSARY (use it consistently — the reader must meet the same concept under the same name):",
    `- Keep these in English, never translate: ${keep}`,
    `- Use these Uzbek renderings: ${prefer}`,
    `- Forbidden renderings: ${banned}`,
  ].join("\n");
}

/** Render the banned-phrase list as prompt instructions. */
export function bannedPhraseBlock(): string {
  const line = (list: readonly BannedPhrase[]) =>
    list.map((b) => `"${b.phrase}"`).join(", ");
  return [
    `- Generic openers: ${line(BANNED_OPENERS)}.`,
    `- Site-name / attribution intros: ${line(BANNED_ATTRIBUTION_INTROS)}.`,
    `- Empty intensifiers (replace with the source's number, or drop): ${line(
      BANNED_INTENSIFIERS_UZ,
    )} / ${line(BANNED_INTENSIFIERS_EN)}.`,
    `- Rhetorical filler: ${line(RHETORICAL_FILLERS)}.`,
  ].join("\n");
}

/**
 * Never-publish checks — one per rule declared in `brand.neverPublish`.
 *
 * These used to be a hardcoded 2-entry array in `qualityCheck.ts` plus a no-op
 * `for (const topic of brand.neverPublish) { void topic; }` loop, so two of the
 * four declared rules were enforced only by accident.
 *
 * Labels: the crypto and rumor strings are byte-identical to the ones
 * `qualityCheck` already emitted, because the ops logs are grepped by eye and
 * continuity there is worth more than tidier wording. The off-topic rule is the
 * one exception — it previously surfaced as "Off-brand: not clearly AI /
 * engineering related" and now reads as a never-publish rule like its siblings.
 * Only the label changed; the predicate is identical, and both spellings were
 * already classified as hard. Verified safe: no workflow, script or DB column
 * reads these strings — `posts` has no issues column at all.
 *
 * `hit` is a predicate rather than a bare regex because the advertising rule
 * needs two independent signals to fire — a single promotional word must never
 * be enough to block a day's post.
 */
export type NeverPublishCheck = {
  /** The `brand.neverPublish` rule this enforces. */
  rule: string;
  /** Issue label. Kept matching /never-publish/i so qualityCheck treats it as hard. */
  label: string;
  hit: (text: string) => boolean;
};

/** Explicit promotional wording. */
const PROMO_PHRASE =
  /(promo\s*kod|chegirma|sotib\s+oling|bepul\s+sinab\s+ko['\u2018\u2019]?ring|obuna\s+bo['\u2018\u2019]?ling\s+va|limited\s+offer|discount\s+code|buy\s+now)/i;
/** A price tag. */
const PRICE_RE =
  /(\d[\d\s.,]*\s*(so['\u2018\u2019]?m|usd|\$|eur)|[$€]\s*\d)/i;
/** A call to action that only makes sense in an ad. */
const PROMO_CTA =
  /(hoziroq\s+ro['\u2018\u2019]?yxatdan|sign\s+up\s+today|link\s+in\s+bio)/i;

/** The brand's own subject matter, used by the off-topic rule. */
const AI_TERM_RE =
  /\b(AI|LLM|agent|LangGraph|LangChain|MCP|model|API|kod|dastur|engineering|automation|pipeline)\b/i;

export const NEVER_PUBLISH_CHECKS: readonly NeverPublishCheck[] = [
  {
    rule: "Cryptocurrency",
    label: "Never-publish topic: cryptocurrency",
    // Byte-identical to the regex qualityCheck used before this was centralised,
    // so no draft that passed yesterday starts failing today.
    hit: (t) => /\b(kripto|crypto|bitcoin|btc|nft|token\s*sot|airdrop)\b/i.test(t),
  },
  {
    rule: "Unverified rumors",
    label: "Never-publish: unverified rumor / clickbait",
    hit: (t) => /\b(mish-mish|rumou?r|tasdiqlanmagan|clickbait)\b/i.test(t),
  },
  {
    rule: "Pure advertising content",
    label: "Never-publish: pure advertising / promo content",
    // Two independent signals required: promotional wording AND a price or an
    // ad-only CTA. One promotional word is not enough to block a post.
    hit: (t) => PROMO_PHRASE.test(t) && (PRICE_RE.test(t) || PROMO_CTA.test(t)),
  },
  {
    rule: "Topics unrelated to programming / AI",
    label: "Never-publish: off-topic (not programming / AI)",
    hit: (t) => !AI_TERM_RE.test(t),
  },
];

/**
 * Issues that must never be softened into a publish, however many retries are
 * left. Everything else (invented statistics, truncation, a flaky quality LLM)
 * may be repaired and soft-passed on the final attempt, because blocking a
 * whole day's post on recoverable noise is worse than shipping a slightly
 * imperfect one.
 *
 * Lives here rather than inline in `qualityCheck` so the classification can be
 * tested against the labels it is supposed to cover — the two drifted once
 * already, and a label that silently stops matching is a hard rule that quietly
 * becomes a soft one.
 */
const HARD_ISSUE_RE =
  /never-publish|off-brand|unsupported tools|crypto|copyright|too short|forbidden phrase/i;

/** True if `issue` must hard-fail the draft rather than be soft-passed. */
export function isHardIssue(issue: string): boolean {
  return HARD_ISSUE_RE.test(issue);
}
