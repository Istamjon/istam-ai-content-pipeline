/**
 * Clean reader-facing post text: remove source-site intros, attribution spam, noise.
 */

/**
 * Strip markdown markers so social posts stay plain (no literal **bold** on LinkedIn/X).
 * Also unwraps `inline code` markers (platforms show backticks literally).
 */
export function stripMarkdownNoise(text: string): string {
  let t = (text || "").replace(/\r\n/g, "\n");

  // Fenced code blocks → keep inner text only
  t = t.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code: string) =>
    String(code || "").trim(),
  );

  // Inline code: `param` → param (keep contents)
  t = t.replace(/`([^`\n]+)`/g, "$1");

  // **bold** / __bold__ (repeat for nested leftovers)
  for (let i = 0; i < 3; i++) {
    t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
    t = t.replace(/__([^_]+)__/g, "$1");
  }

  // *italic* / _italic_ (avoid matching underscores inside words like snake_case)
  t = t.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1");
  t = t.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1");

  // Stray leftover bold / star markers
  t = t.replace(/\*{1,}/g, "");
  t = t.replace(/_{2,}/g, "");

  // ATX headings at line start: ## Title → Title
  t = t.replace(/^#{1,6}\s+/gm, "");

  // Markdown links [label](url) → label
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Collapse spaces left by removed markers (keep newlines)
  t = t.replace(/[^\S\n]{2,}/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

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

/** Full reader-facing clean: source intros + markdown noise. */
export function cleanPostBody(text: string): string {
  return stripMarkdownNoise(stripSourceIntros((text || "").trim()));
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
