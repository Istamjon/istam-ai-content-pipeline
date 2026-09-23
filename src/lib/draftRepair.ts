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
