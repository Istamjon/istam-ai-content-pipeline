/**
 * Clean reader-facing post text: remove source-site intros, attribution spam, noise.
 */

/** Phrases like "Yangi Skywork AI maqolasi:", "According to TechCrunch", etc. */
const SOURCE_INTRO_RES: RegExp[] = [
  /^\s*Yangi\s+[\w\s./-]{1,40}\s+maqolasi\s*:\s*/gim,
  /^\s*Yangi\s+[\w\s./-]{1,40}\s+posti\s*:\s*/gim,
  /^\s*[\w.-]+\s+AI\s+maqolasi\s*:\s*/gim,
  /^\s*Skywork(\s+AI)?\s*(maqolasi|blogi|posti)?\s*:\s*/gim,
  /^\s*DeepMind\s*(maqolasi|blogi)?\s*:\s*/gim,
  /^\s*Actualize(\s+AI)?\s*(maqolasi|blogi)?\s*:\s*/gim,
  /^\s*(This|Yangi)\s+article\s+(from|on)\s+[\w\s.-]+\s*:\s*/gim,
  /^\s*According to\s+[\w\s.-]+\s*[:,]\s*/gim,
  /^\s*[\w.-]+\s+(blog|maqola)sida\s+(yozilishicha|aytilishicha)\s*[:,]?\s*/gim,
  /^\s*Manba\s*:\s*.+$/gim,
  /^\s*Source\s*:\s*.+$/gim,
];

export function stripSourceIntros(text: string): string {
  let t = text.trim();
  for (const re of SOURCE_INTRO_RES) {
    t = t.replace(re, "");
  }
  // Mid-text variants
  t = t.replace(
    /\bYangi\s+[\w\s./-]{0,30}(Skywork|DeepMind|Actualize|blog)[\w\s./-]{0,20}\s+maqolasi\s*:\s*/gi,
    "",
  );
  t = t.replace(/\b(Skywork\s*AI|DeepMind)\s+maqolasi(ga|da)?\s*[:,]?\s*/gi, "");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

export function stripHtmlToPlain(text: string): string {
  return text
    .replace(/<a\s+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

/** Remove Author/hashtag blocks for Telegraph body (footer re-added cleanly). */
export function stripFooterAndTags(text: string): string {
  let t = stripHtmlToPlain(text);
  t = t.replace(/\n*Author:\s*[\s\S]*$/i, "");
  t = t.replace(/\n*#[\w\u0400-\u04FF]+(\s+#[\w\u0400-\u04FF]+)*\s*$/g, "");
  t = t.replace(/\n*AI Engineering\s*\|\s*AI Agents[\s\S]*$/i, "");
  return t.trim();
}
