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
 * Ensure post ends with 3–5 grounded fact bullets (Uzbek label).
 * Does not invent — only uses extracted facts from brief.
 */
export function ensureFactsSection(
  body: string,
  summary?: string,
  maxFacts = 5,
): string {
  const facts = extractFactsFromBrief(summary).slice(0, maxFacts);
  if (facts.length === 0) return body.trim();

  let text = body.trim();
  // Remove a weak/empty previous facts block so we can rebuild cleanly
  text = text
    .replace(/\n*Asosiy\s+faktlar\s*:\s*[\s\S]*$/i, "")
    .trim();

  const min = Math.min(3, facts.length);
  const use = facts.slice(0, Math.max(min, Math.min(maxFacts, facts.length)));
  const block =
    "\n\nAsosiy faktlar:\n" + use.map((f) => `• ${f}`).join("\n");

  return (text + block).trim();
}
