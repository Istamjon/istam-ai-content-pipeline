/**
 * Extract ALLOWED FACTS lines from analyst brief (SUMMARY / FACTS block).
 */

/** Pull bullets under FACTS: … until NOTES: or end */
export function extractFactsFromBrief(summary?: string): string[] {
  if (!summary?.trim()) return [];
  const m = summary.match(/FACTS:\s*([\s\S]*?)(?:\nNOTES:|$)/i);
  const block = (m?.[1] || "").trim();
  if (!block) return [];

  const lines = block
    .split(/\n+/)
    .map((l) =>
      l
        .replace(/^[\s]*[-*•–—]\s*/, "")
        .replace(/^\d+[.)]\s*/, "")
        .trim(),
    )
    .filter((l) => l.length >= 12 && l.length <= 280)
    .filter((l) => !/^(none|n\/a|yo'?q|-)$/i.test(l));

  // Dedupe (case-insensitive)
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= 5) break;
  }
  return out;
}

/** True if post already has a facts section */
export function hasFactsSection(text: string): boolean {
  return /asosiy\s+faktlar\s*:/i.test(text);
}

/**
 * The bullets the writer already put under "Asosiy faktlar:", if any.
 *
 * Used to decide whether the writer's own block is good enough to keep. The
 * label line itself is not a bullet, so it is filtered out by the length floor.
 */
export function extractExistingFactsBlock(text: string): string[] {
  const m = (text || "").match(/Asosiy\s+faktlar\s*:\s*([\s\S]*)$/i);
  if (!m) return [];
  return (m[1] || "")
    .split(/\n+/)
    .map((l) =>
      l
        .replace(/^\s*[-*•–—]\s*/, "")
        .replace(/^\d+[.)]\s*/, "")
        .trim(),
    )
    .filter((l) => l.length >= 12 && l.length <= 400);
}

/**
 * Ensure post ends with 3–5 grounded fact bullets (Uzbek label).
 * Does not invent — only uses extracted facts from brief.
 *
 * The writer's OWN block is kept when it already has >=3 bullets.
 *
 * Rebuilding unconditionally was a real bug: the analyst brief asks for English
 * technical terms in FACTS, so whole English sentences ended up in that list and
 * `ensureFactsSection` pasted them straight into the post — an Uzbek post
 * published with an English "Asosiy faktlar:" block. The writer writes in the
 * post's language and has already grounded its bullets, so its block is the
 * better artefact; the brief is only used to REPAIR a missing or thin block.
 * The quality gate still fact-checks whatever bullets survive.
 */
export function ensureFactsSection(
  body: string,
  summary?: string,
  maxFacts = 5,
): string {
  const text = body.trim();

  if (extractExistingFactsBlock(text).length >= 3) return text;

  const facts = extractFactsFromBrief(summary).slice(0, maxFacts);
  if (facts.length === 0) return text;

  // Remove a weak/empty previous facts block so we can rebuild cleanly
  const stripped = text
    .replace(/\n*Asosiy\s+faktlar\s*:\s*[\s\S]*$/i, "")
    .trim();

  const min = Math.min(3, facts.length);
  const use = facts.slice(0, Math.max(min, Math.min(maxFacts, facts.length)));
  const block = "\n\nAsosiy faktlar:\n" + use.map((f) => `• ${f}`).join("\n");

  return (stripped + block).trim();
}
