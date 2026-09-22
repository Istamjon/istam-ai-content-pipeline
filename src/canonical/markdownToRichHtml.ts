/**
 * Markdown → Telegram rich-message HTML.
 *
 * Rich messages render real structure — headings, lists, block quotations — but
 * the post body is markdown, and `cleanPostBody` deliberately FLATTENS that
 * structure for the plain-text platforms (LinkedIn/X show `##` and `[x](url)`
 * literally). So the rich path needs its own converter rather than a flattened
 * string.
 *
 * Safety: every text run is HTML-escaped BEFORE any tag is inserted, so a
 * literal `<` in the source can never open a tag. Only the tags produced here
 * are real markup.
 *
 * Scope: deliberately small. It handles the constructs the writer actually
 * emits, and leaves anything it does not recognise as escaped plain text. It is
 * not a general-purpose markdown parser.
 */

export type RichBlock =
  | { kind: "para"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "quote"; text: string }
  | { kind: "hr" }
  | { kind: "list"; ordered: boolean; items: string[] };

/**
 * A line that opens a bullet item.
 *
 * `•` matters: the writer emits real bullet characters, not only `- `. Missing
 * it would leave those lines as bare paragraphs.
 */
const BULLET_RE = /^[-*+•·]\s+(.+)$/;

/**
 * A line that opens an ordered item: `1.` or `1)`.
 *
 * Capped at two digits on purpose — `2026. Bu yil …` is a sentence that starts
 * with a number, not the 2026th list item.
 */
const ORDERED_RE = /^\d{1,2}[.)]\s+(.+)$/;

/** ATX heading: `## Title`. */
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/** Block quotation: `> text`. */
const QUOTE_RE = /^>\s?(.*)$/;

/** Thematic break: `---`, `***`, `___`. */
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;

/** Any line that opens a structured block (never merged into a paragraph). */
const STRUCTURED_RE = /^(#{1,6}\s|[-*+•·]\s|\d{1,2}[.)]\s|>)/;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** True when a line reads as a finished sentence (so it is not a wrap point). */
function endsSentence(line: string): boolean {
  return /[.!?…:;»"]$/.test(line.trim());
}

/**
 * Inline markdown applied to an already-escaped run.
 *
 * Order matters: links first (their brackets are not escaped), then bold before
 * italic so `**x**` is not eaten by the italic rule.
 */
function inline(escaped: string): string {
  let t = escaped;
  // [label](url) — only http(s), so a stray bracket pair cannot inject a link.
  t = t.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label: string, url: string) =>
      `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`,
  );
  // **bold** / __bold__
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  t = t.replace(/__([^_]+)__/g, "<b>$1</b>");
  // *italic* / _italic_ (not inside words, so snake_case survives)
  t = t.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<i>$1</i>");
  t = t.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<i>$1</i>");
  // `code`
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  return t;
}

type RawLine = {
  text: string;
  /** A blank line preceded this one. */
  blankBefore: boolean;
};

/**
 * A run of ≥3 unmarked lines directly after a `:` lead-in is treated as a list.
 *
 * The writer sometimes lays steps out one per line WITHOUT markers, which
 * renders as a single merged paragraph. Requiring a `:` lead-in keeps this
 * conservative: ordinary paragraphs (which also end in periods) are never
 * converted, because they are not introduced by a colon.
 */
function isListLeadIn(line: string): boolean {
  return /:$/.test(line.trim());
}

function toBlocks(md: string): RichBlock[] {
  const raw: RawLine[] = [];
  let blank = true;
  for (const line of (md || "").replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      blank = true;
      continue;
    }
    raw.push({ text: trimmed, blankBefore: blank });
    blank = false;
  }

  const blocks: RichBlock[] = [];

  for (let i = 0; i < raw.length; i++) {
    const text = raw[i].text;

    // Thematic break
    if (HR_RE.test(text)) {
      blocks.push({ kind: "hr" });
      continue;
    }

    // ATX heading
    const h = text.match(HEADING_RE);
    if (h) {
      blocks.push({ kind: "heading", level: h[1].length, text: h[2] });
      continue;
    }

    // Block quotation
    const q = text.match(QUOTE_RE);
    if (q) {
      blocks.push({ kind: "quote", text: q[1] });
      continue;
    }

    // Bullet
    const b = text.match(BULLET_RE);
    if (b) {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "list" && !last.ordered) last.items.push(b[1]);
      else blocks.push({ kind: "list", ordered: false, items: [b[1]] });
      continue;
    }

    // Ordered
    const o = text.match(ORDERED_RE);
    if (o) {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "list" && last.ordered) last.items.push(o[1]);
      else blocks.push({ kind: "list", ordered: true, items: [o[1]] });
      continue;
    }

    // Plain text: rejoin hard-wrapped continuation lines, then look for the
    // unmarked-list pattern.
    let merged = text;
    while (
      !endsSentence(merged) &&
      i + 1 < raw.length &&
      !raw[i + 1].blankBefore &&
      !STRUCTURED_RE.test(raw[i + 1].text) &&
      !HR_RE.test(raw[i + 1].text)
    ) {
      merged = `${merged} ${raw[i + 1].text}`;
      i++;
    }

    if (isListLeadIn(merged)) {
      const run: string[] = [];
      let j = i + 1;
      while (
        j < raw.length &&
        !raw[j].blankBefore &&
        !STRUCTURED_RE.test(raw[j].text) &&
        endsSentence(raw[j].text) &&
        raw[j].text.length <= 240
      ) {
        run.push(raw[j].text);
        j++;
      }
      if (run.length >= 3) {
        blocks.push({ kind: "para", text: merged });
        blocks.push({ kind: "list", ordered: false, items: run });
        i = j - 1;
        continue;
      }
    }

    blocks.push({ kind: "para", text: merged });
  }

  return blocks;
}

/**
 * Convert markdown to rich-message HTML.
 *
 * Plain text lines are wrapped in `<p>`. Wrapping is what stops two adjacent
 * lines from being merged into one visual paragraph by the renderer.
 */
export function markdownToRichHtml(md: string): string {
  const out: string[] = [];
  for (const block of toBlocks(md)) {
    switch (block.kind) {
      case "hr":
        out.push("<hr/>");
        break;
      case "heading":
        out.push(
          `<h${block.level}>${inline(escapeHtml(block.text))}</h${block.level}>`,
        );
        break;
      case "quote":
        out.push(`<blockquote>${inline(escapeHtml(block.text))}</blockquote>`);
        break;
      case "para":
        out.push(`<p>${inline(escapeHtml(block.text))}</p>`);
        break;
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const items = block.items
          .map((it) => `<li>${inline(escapeHtml(it))}</li>`)
          .join("");
        out.push(`<${tag}>${items}</${tag}>`);
        break;
      }
    }
  }
  return out.join("\n");
}
