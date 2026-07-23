/**
 * Auto-repair draft posts before quality hard-fail.
 * Fixes the two most common "no publish" causes on VDS:
 *  - mid-sentence / mid-word truncation
 *  - invented percentages / stats not present in the source
 */

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
