/**
 * Auto-repair draft posts before quality hard-fail.
 * Fixes the two most common "no publish" causes on VDS:
 *  - mid-sentence / mid-word truncation
 *  - invented percentages / stats not present in the source
 */

/**
 * Ceiling for one writer draft, in characters.
 *
 * This is a RUNAWAY GUARD, not a content limit. Length is the writer prompt's
 * job (it asks for 2400–4400 chars ≈ 400–700 Uzbek words), and every platform
 * is truncated to its own API limit downstream in `formatOne` —
 * `smartTruncate` / `packText` / `splitIntoThreadParts`. A long draft is
 * therefore harmless: Telegram's rich message alone accepts 32768 characters.
 *
 * It used to be 2000 — BELOW the prompt's own 2600-char hard max — so ~600
 * characters of every draft were deleted before the quality gate ever saw them.
 * The cut lands on a sentence boundary, so the result still passed
 * `looksComplete()` and the loss stayed invisible: the only symptom was that the
 * rich message used 2903 of its 32768 characters.
 */
export const MAX_DRAFT_CHARS = 5000;

/**
 * Absolute ceiling for a publishable body — also a runaway guard.
 *
 * Deliberately far above both the draft target and Telegram's plain-text soft
 * target: a canonical body longer than any single surface is normal now, because
 * each surface takes what it can. This exists only to catch a model that ignores
 * the prompt entirely, not to cap useful content.
 */
export const MAX_BODY_CHARS = 12000;

/**
 * Trim a runaway draft to `maxChars` at a sentence / paragraph boundary.
 *
 * Returns the text unchanged when it already fits, so a compliant draft is never
 * touched. When it must cut, it prefers the last sentence end inside the budget
 * and only falls back to a hard cut when the nearest boundary would throw away
 * most of the allowance — `repairTruncation` tidies that tail.
 */
export function capDraftLength(
  text: string,
  maxChars: number = MAX_DRAFT_CHARS,
): string {
  const t = (text || "").trim();
  if (t.length <= maxChars) return t;

  // Leave room for the terminator a boundary cut may append.
  const window = t.slice(0, Math.max(1, maxChars - 100));
  const lastStop = Math.max(
    window.lastIndexOf("."),
    window.lastIndexOf("!"),
    window.lastIndexOf("?"),
    window.lastIndexOf("…"),
    window.lastIndexOf("\n"),
  );
  const keep =
    lastStop > window.length * 0.6 ? window.slice(0, lastStop + 1) : window;
  return keep.trim();
}

/** Drop incomplete last sentence / mid-word tail. */
export function repairTruncation(text: string): string {
  let t = (text || "").trim();
  if (!t) return t;

  // Incomplete last bullet (e.g. "• metada" / "• agentlar va")
  t = t.replace(/\n[•\-\*]\s*[^\n]{0,40}$/u, "").trim();

  // Mid-word tail without terminal punctuation
  if (!/[.!?…)"»\]]\s*$/.test(t) && /[\w'ʻʼ`]$/u.test(t)) {
    const lastStop = Math.max(
      t.lastIndexOf("."),
      t.lastIndexOf("!"),
      t.lastIndexOf("?"),
      t.lastIndexOf("…"),
      t.lastIndexOf("\n"),
    );
    if (lastStop > 200) {
      t = t.slice(0, lastStop + 1).trim();
    }
  }

  // Trailing incomplete clause after comma / dash
  if (/[,;:—–-]\s*[\w'ʻʼ`]{1,24}$/u.test(t)) {
    const cut = t.replace(/[,;:—–-]\s*[\w'ʻʼ`]{1,24}$/u, "").trim();
    if (cut.length > 200) t = cut;
  }

  // If still ends without terminal punct, close last line/sentence
  if (t.length > 40 && !/[.!?…)"»\]]\s*$/.test(t) && /[\w'ʻʼ`)]$/u.test(t)) {
    t = t + ".";
  }

  return t.trim();
}

/**
 * Remove numeric claims (%, x multipliers, "N foiz") that do not appear in source.
 * Keeps the rest of the sentence structure when possible by dropping whole bullets/sentences.
 */
export function stripUnsupportedNumbers(
  text: string,
  sourcePool: string,
): string {
  const src = sourcePool || "";
  const lines = text.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const nums = line.match(
      /\b\d{1,3}(?:[.,]\d+)?\s*%|\b\d+[xX]\b|\b\d{1,3}(?:[.,]\d+)?\s*(foiz|%|marta)\b/gi,
    );
    if (!nums?.length) {
      kept.push(line);
      continue;
    }
    const allGrounded = nums.every((n) => {
      const core = n.replace(/\s+/g, "").replace(/foiz/i, "%");
      const bare = n.replace(/[^\d.,]/g, "");
      if (!bare) return true;
      // Accept if same number (or %) appears in source
      if (src.includes(bare)) return true;
      if (/%/.test(core) && new RegExp(`${bare}\\s*%`).test(src)) return true;
      return false;
    });
    if (allGrounded) {
      kept.push(line);
      continue;
    }
    // Drop bullet entirely if it is only a stat claim
    if (/^\s*[•\-\*]\s+/.test(line)) continue;
    // Drop whole sentence pieces that carry the ungrounded number
    let cleaned = line;
    for (const n of nums) {
      const bare = n.replace(/[^\d.,]/g, "");
      if (!bare || src.includes(bare)) continue;
      cleaned = cleaned
        .replace(
          new RegExp(
            `[^.\\n]*${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^.\\n]*[.!?]?`,
            "gi",
          ),
          " ",
        )
        .replace(/\s{2,}/g, " ")
        .trim();
    }
    if (cleaned.length >= 20) kept.push(cleaned);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** True if text ends like a complete social post (not mid-word). */
export function looksComplete(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 50) return false;
  if (/manba\s*:/i.test(t.slice(-120))) return true;
  if (/https?:\/\/\S+$/i.test(t)) return true;
  if (/[.!?…)"»\]]\s*$/.test(t)) return true;
  // Ends on full bullet line with some terminal punct nearby
  if (/\n[•\-\*]\s+.+\S\s*$/.test(t) && /[.!?…]/.test(t.slice(-120))) {
    return true;
  }
  return false;
}

/**
 * Rhythm cap for one paragraph, in characters.
 *
 * The writer prompt already asks for "Paragraphs of 1–3 sentences, never over
 * ~350 characters" (prompts.ts) — but nothing enforced it, so the model ignored
 * it on long articles and shipped walls of text. Live measurement of canonical
 * `8a5ec485806b5d05` v1 ("The Reliability Layer for Healthcare AI"): the longest
 * paragraph was 913 chars, i.e. ~2.6x the cap, and worse than the 714-char
 * baseline it was supposed to improve on.
 *
 * Deliberately a SOFT cap enforced by `normalizeParagraphs` at sentence
 * boundaries — NOT a `qualityCheck` gate. A length gate in the quality step
 * blocks publishing outright, which is how the old 3500-char "Too long" gate
 * made the rich-message feature unusable on exactly the long articles it was
 * built for (see MAX_BODY_CHARS above).
 */
export const PARAGRAPH_SOFT_CAP = 350;

/** Sentence-ish splitter, matching the one used by splitIntoThreadParts. */
const SENTENCE_RE = /[^.!?…]+[.!?…]+(?:\s+|$)|[^.!?…]+$/g;
const URL_RE = /https?:\/\/[^\s)»\]]+/g;
const ABBREV_RE = /\b(?:e\.g|i\.e|va h\.k|h\.k|vs|Dr|Mr|Mrs|Ms)\./gi;

/** Collapse every whitespace run to one space, for word-sequence comparison. */
function collapse(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

/**
 * True when the block carries markdown structure that must not be re-flowed.
 *
 * Exported because the *metric* has to agree with the *repair*: if
 * `normalizeParagraphs` refuses to touch a block, then `longestParagraph` must
 * not report that same block as an over-long paragraph. When the two disagreed,
 * a 832-char bullet list was reported as a 861-char paragraph — on a post whose
 * longest real prose paragraph was 290 chars.
 */
export function isStructuralBlock(block: string): boolean {
  return block.split("\n").some((line) => {
    const t = line.trim();
    if (!t) return false;
    return (
      /^#{1,6}\s/.test(t) || // heading
      /^[•\-*+]\s/.test(t) || // bullet
      /^\d+[.)]\s/.test(t) || // numbered list
      /^>/.test(t) || // quote
      /^\|/.test(t) || // table
      /^(manba|source|asosiy faktlar)\s*:?/i.test(t) // attribution / facts
    );
  });
}

/**
 * Re-flow one prose block into paragraphs of ≤ `maxChars`, cutting ONLY at
 * sentence boundaries.
 *
 * Returns `null` — meaning "leave this block exactly as written" — whenever the
 * split cannot be proven safe: fewer than two sentences, or a round-trip check
 * showing the whitespace-normalised word sequence changed. That check is what
 * makes this safe to run on every draft: a link (`https://…`) or an
 * abbreviation (`e.g.`) that the splitter would otherwise cut through makes the
 * comparison fail and the block is left untouched.
 */
function splitProseBlock(block: string, maxChars: number): string | null {
  const tokens: string[] = [];
  const mask = (s: string) =>
    s
      .replace(URL_RE, (m) => {
        tokens.push(m);
        return `\uE000${tokens.length - 1}\uE001`;
      })
      .replace(ABBREV_RE, (m) => {
        tokens.push(m);
        return `\uE000${tokens.length - 1}\uE001`;
      });
  const restore = (s: string) =>
    s.replace(/\uE000(\d+)\uE001/g, (_, d) => tokens[Number(d)] ?? "");

  const sentences = (mask(block).match(SENTENCE_RE) || [])
    .map((s) => restore(s.trim()))
    .filter(Boolean);
  if (sentences.length < 2) return null;

  // Safety net: the split must not add, drop or reorder a single word.
  if (collapse(sentences.join(" ")) !== collapse(block)) return null;

  const paras: string[] = [];
  let cur = "";
  for (const s of sentences) {
    const next = cur ? `${cur} ${s}` : s;
    if (cur && next.length > maxChars) {
      paras.push(cur);
      cur = s;
    } else {
      cur = next;
    }
  }
  if (cur) paras.push(cur);

  // A single sentence longer than the cap cannot be split without rewriting it,
  // so it is left intact rather than mangled.
  if (paras.length < 2) return null;
  return paras.join("\n\n");
}

/**
 * Break over-long prose paragraphs at sentence boundaries.
 *
 * Word-preserving and idempotent: it only ever inserts paragraph breaks at
 * boundaries that already exist, never touches headings / lists / tables /
 * attribution, and returns the input unchanged when nothing is over the cap.
 */
export function normalizeParagraphs(
  text: string,
  maxChars: number = PARAGRAPH_SOFT_CAP,
): string {
  const t = (text || "").replace(/\r\n/g, "\n").trim();
  if (!t || maxChars < 80) return t;

  const out: string[] = [];
  for (const block of t.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (trimmed.length <= maxChars || isStructuralBlock(trimmed)) {
      out.push(trimmed);
      continue;
    }
    out.push(splitProseBlock(trimmed, maxChars) ?? trimmed);
  }
  return out.join("\n\n");
}

/**
 * Longest PROSE paragraph length, in characters. Used for logging and ops probes.
 *
 * Structural blocks (headings, bullet lists, tables, quotes) are skipped, for
 * the same reason `normalizeParagraphs` skips them: the ~350-char cap is a
 * readability rule about prose. A bullet list is not a paragraph, and it cannot
 * be split anyway. Counting it produced a false "paragraph too long" report on
 * a post whose longest real paragraph was 290 chars — the 861 chars were a
 * four-item `<ul>`.
 */
export function longestParagraph(text: string): number {
  return (text || "")
    .split(/\n{2,}/)
    .filter((block) => !isStructuralBlock(block.trim()))
    .reduce((max, block) => Math.max(max, block.trim().length), 0);
}
