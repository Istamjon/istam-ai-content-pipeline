/**
 * Deterministic brand-voice lint.
 *
 * Philosophy: this MEASURES, it does not block. A voice gate in `qualityCheck`
 * would fail drafts outright, and a length gate there has already broken the
 * pipeline once (see the comment in `qualityCheck.ts` about the old 3500-char
 * "Too long" rule). So the rules that can be checked mechanically are checked
 * here and reported, and a human decides.
 *
 * The rules themselves live in `config/voiceRules.ts`, shared with the writer
 * prompts — so the instruction the model is given and the check it is measured
 * against can never drift apart.
 */
import {
  BANNED_OPENERS,
  BANNED_ATTRIBUTION_INTROS,
  BANNED_INTENSIFIERS_UZ,
  BANNED_INTENSIFIERS_EN,
  RHETORICAL_FILLERS,
  GLOSSARY,
  type BannedPhrase,
} from "../config/voiceRules.js";
import { longestParagraph, PARAGRAPH_SOFT_CAP } from "./draftRepair.js";

export type VoiceIssue = {
  /** Stable rule id. */
  rule: string;
  /** Human-readable detail, including the offending excerpt. */
  detail: string;
};

export type VoiceMetrics = {
  paragraphs: number;
  longestParagraph: number;
  sentences: number;
  words: number;
  hasHeadings: boolean;
  hasList: boolean;
  addressesReader: boolean;
  firstLineIsHeading: boolean;
  hookHasConcreteDetail: boolean;
};

export type VoiceLintResult = {
  issues: VoiceIssue[];
  metrics: VoiceMetrics;
};

/** Characters an "opener" can live in — anything later is not an opener. */
const OPENER_WINDOW = 240;

/** Markdown/HTML noise removed before analysis. */
function toPlain(text: string): string {
  return (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links keep their label
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

/**
 * First prose sentence, skipping leading headings and list items.
 *
 * Works from the RAW text, not the stripped copy: once `toPlain` removes the
 * `## ` marker a heading looks exactly like a sentence, and the hook check would
 * then measure the section label ("Muammo va Ishonchlilik Qatlami") instead of
 * the opening sentence — reporting a false problem for the wrong reason.
 */
function firstProseSentence(raw: string): string {
  const buf: string[] = [];
  for (const line of (raw || "").replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    const isStructural =
      !t ||
      /^#{1,6}\s/.test(t) ||
      /^[-•*+]\s/.test(t) ||
      /^\d+[.)]\s/.test(t) ||
      /^>/.test(t) ||
      /^\|/.test(t);
    if (isStructural) {
      if (buf.length) break; // end of the opening paragraph
      continue; // still skipping the heading block above it
    }
    buf.push(t);
  }
  const block = toPlain(buf.join(" "));
  return (block.split(/(?<=[.!?…])\s+/)[0] || "").trim();
}

function findHits(text: string, list: readonly BannedPhrase[]): BannedPhrase[] {
  return list.filter((b) => b.re.test(text));
}

export function voiceLint(
  text: string,
  opts: { maxParagraph?: number } = {},
): VoiceLintResult {
  const maxParagraph = opts.maxParagraph ?? PARAGRAPH_SOFT_CAP;
  const plain = toPlain(text);
  const issues: VoiceIssue[] = [];

  if (!plain) {
    return {
      issues: [{ rule: "empty", detail: "no text to lint" }],
      metrics: {
        paragraphs: 0,
        longestParagraph: 0,
        sentences: 0,
        words: 0,
        hasHeadings: false,
        hasList: false,
        addressesReader: false,
        firstLineIsHeading: false,
        hookHasConcreteDetail: false,
      },
    };
  }

  const firstLine = plain.split("\n").find((l) => l.trim()) || "";
  const firstWindow = plain.slice(0, OPENER_WINDOW);

  // ── 1. Generic openers (opening window only) ──
  for (const hit of findHits(firstWindow, BANNED_OPENERS)) {
    issues.push({
      rule: "banned-opener",
      detail: `${hit.label} — starts with "${hit.phrase}"`,
    });
  }

  // ── 2. Site-name / attribution intros ──
  for (const hit of findHits(plain, BANNED_ATTRIBUTION_INTROS)) {
    issues.push({
      rule: "attribution-intro",
      detail: `${hit.label} — "${hit.phrase}"`,
    });
  }

  // ── 3. Empty intensifiers and rhetorical filler ──
  const intensifiers = [
    ...findHits(plain, BANNED_INTENSIFIERS_UZ),
    ...findHits(plain, BANNED_INTENSIFIERS_EN),
  ];
  if (intensifiers.length) {
    issues.push({
      rule: "empty-intensifier",
      detail: `${intensifiers.length}x — ${intensifiers
        .map((b) => `"${b.phrase}"`)
        .join(", ")} (replace with the source's number, or drop)`,
    });
  }
  for (const hit of findHits(plain, RHETORICAL_FILLERS)) {
    issues.push({ rule: "filler", detail: `${hit.label} — "${hit.phrase}"` });
  }

  // ── 4. Forbidden glossary renderings ──
  for (const b of GLOSSARY.bannedUz) {
    // `b.re` is a STEM match — Uzbek suffixes ("hakamlar", "hakamning") must
    // count as the same violation.
    if (b.re.test(plain)) {
      issues.push({
        rule: "glossary-violation",
        detail: `"${b.uz}" must be "${b.useInstead}" (${b.why})`,
      });
    }
  }

  // ── 5. Rhythm ──
  const longest = longestParagraph(plain);
  if (longest > maxParagraph) {
    issues.push({
      rule: "paragraph-too-long",
      detail: `longest paragraph ${longest} chars > ${maxParagraph}`,
    });
  }

  // ── 6. Structure ──
  const firstLineIsHeading = /^#{1,6}\s/.test(
    (text || "").split("\n").find((l) => l.trim()) || "",
  );
  const hook = firstProseSentence(text);
  const hookHasConcreteDetail =
    /\d/.test(hook) ||
    GLOSSARY.keepEnglish.some((t) =>
      new RegExp(`(^|[^\\p{L}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "i").test(
        hook,
      ),
    );
  if (!hookHasConcreteDetail) {
    issues.push({
      rule: "abstract-hook",
      detail: `first sentence carries no number and no named technology: "${hook.slice(0, 120)}"`,
    });
  }

  // ── 7. Reader address ──
  const addressesReader = /(^|[^\p{L}])siz([^\p{L}]|$)/iu.test(plain);
  if (!addressesReader) {
    issues.push({
      rule: "no-reader-address",
      detail: 'the post never addresses the reader as "siz"',
    });
  }

  const sentences = plain.split(/(?<=[.!?…])\s+/).filter((s) => s.trim()).length;
  const words = plain.split(/\s+/).filter(Boolean).length;

  return {
    issues,
    metrics: {
      paragraphs: plain.split(/\n{2,}/).filter((b) => b.trim()).length,
      longestParagraph: longest,
      sentences,
      words,
      hasHeadings: /^#{1,6}\s/m.test(text || ""),
      hasList: /^\s*[-•*+]\s/m.test(text || ""),
      addressesReader,
      firstLineIsHeading,
      hookHasConcreteDetail,
    },
  };
}

/** One-line summary for logs and ops probes. */
export function formatVoiceLint(result: VoiceLintResult): string {
  const m = result.metrics;
  return [
    `voice issues=${result.issues.length} paragraphs=${m.paragraphs} longestParagraph=${m.longestParagraph} words=${m.words} sentences=${m.sentences}`,
    `headings=${m.hasHeadings} list=${m.hasList} siz=${m.addressesReader} headingFirst=${m.firstLineIsHeading} concreteHook=${m.hookHasConcreteDetail}`,
    ...result.issues.map((i) => `  ! ${i.rule}: ${i.detail}`),
  ].join("\n");
}
