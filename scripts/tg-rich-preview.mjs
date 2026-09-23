/**
 * Preview the REAL newest post through the deployed rich-message formatter.
 *
 * Why: a scheduled slot is a bad place to discover the layout is wrong. This
 * renders the newest canonical document with the same code the publisher uses
 * and sends the result to the ADMIN chat (never the channel), so the new
 * one-message layout — cover, `<hr/>` divider, `<footer>` block — can be looked
 * at before it goes out for real.
 *
 * It also asserts the invariant that matters: the rich-only tags must appear in
 * `richHtml` and must NOT appear in `text`/`caption`, because the fallback
 * layout feeds those to `parse_mode=HTML`, which rejects them.
 *
 * Safety: read-only with respect to state (no DB writes, no channel posts).
 *
 * Usage (inside the container):  node scripts/tg-rich-preview.mjs
 */
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ADMINS = (process.env.TELEGRAM_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ADMIN = ADMINS[0] || "";

const api = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;

async function parse(res) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return { http: res.status, ok: Boolean(j.ok), description: j.description };
  } catch {
    return { http: res.status, ok: false, description: text.slice(0, 160) };
  }
}

if (!TOKEN) {
  console.log("TELEGRAM_BOT_TOKEN not set — nothing to preview");
  process.exit(0);
}

const { listCanonical, loadCanonical } =
  await import("../dist/canonical/store.js");
const { formatAllFromCanonical } =
  await import("../dist/canonical/formatFromCanonical.js");
const { getPlatformTextPolicy } =
  await import("../dist/config/platformTextLimits.js");
const fs = await import("node:fs");
const path = await import("node:path");

const list = listCanonical(20);
if (!list.length) {
  console.log("no canonical documents found — nothing to preview");
  process.exit(0);
}

// PREVIEW_INDEX picks which post to inspect (0 = newest) so several posts can be
// reviewed without redeploying.
const idx = Math.max(
  0,
  Math.min(list.length - 1, Number(process.env.PREVIEW_INDEX || 0) || 0),
);
const id = list[idx].id;
const doc = loadCanonical(id);
if (!doc) {
  console.log(`canonical ${id} listed but could not be loaded`);
  process.exit(0);
}

console.log(`=== CANONICAL ===`);
console.log(`index=${idx} of ${list.length} available (0 = newest)`);
console.log(`id=${doc.id} v${doc.version}`);
console.log(`title=${doc.title}`);
console.log(
  `body=${doc.body.length} chars imagePath=${doc.imagePath || "(none)"}`,
);

const formatted = formatAllFromCanonical(doc, ["telegram"]);
const tg = formatted.telegram;
if (!tg) {
  console.log("telegram formatting produced nothing");
  process.exit(0);
}

const rich = tg.richHtml || "";
// `softBodyTarget` is a BODY budget: the format layer reserves room for the
// compact footer and the hashtags before packing, so `text` must land under it
// WITH the footer present. Before that fix, a body over ~3696 chars made
// `packText` shed the hashtags and then the whole 241-char footer, and the post
// shipped with no brand footer and no divider (canonical 8a5ec485806b5d05 v1).
const tgPolicy = getPlatformTextPolicy("telegram");
const soft = tgPolicy.softBodyTarget ?? tgPolicy.apiHardLimit;

console.log(`\n=== FORMATTED ===`);
console.log(`text=${tg.text.length} caption=${(tg.caption || "").length}`);
console.log(
  `text budget: soft=${soft} apiHard=${tgPolicy.apiHardLimit} richHard=${tgPolicy.richHardLimit ?? "(none)"}`,
);
console.log(`richHtml=${rich.length} (${tg.richHtml ? "present" : "ABSENT"})`);

const checks = [
  ["richHtml has <hr/>", rich.includes("<hr/>")],
  [
    "richHtml has <footer>",
    rich.includes("<footer>") && rich.includes("</footer>"),
  ],
  ["richHtml dropped the ASCII rule", !rich.includes("────────")],
  ["text keeps the ASCII rule", tg.text.includes("────────")],
  ["text keeps the hashtags", /(^|\s)#\w/.test(tg.text)],
  ["text <= softBodyTarget", tg.text.length <= soft],
  ["text has NO <hr/>", !tg.text.includes("<hr/>")],
  ["text has NO <footer>", !tg.text.includes("<footer>")],
  ["caption has NO <hr/>", !(tg.caption || "").includes("<hr/>")],
  ["caption is a prefix of text", tg.text.startsWith(tg.caption || "")],
  ["caption <= 1024", (tg.caption || "").length <= 1024],
  ["richHtml < 32768", rich.length < 32768],
];
console.log(`\n=== INVARIANT CHECKS ===`);
let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} | ${name}`);
}
console.log(`failed=${failed}`);

console.log(`\n=== richHtml (FULL) ===`);
console.log(rich);

// ── content diagnostics ─────────────────────────────────────────────────────
// Readability/structure signals for the editor, computed on the text as the
// reader sees it (markup stripped). Deliberately crude and local — this is a
// prompt for a human, not a quality gate.
//
// Block ends must become BLANK LINES before the tags go away. Simply deleting
// every tag glued the output together: `</p>\n<p>` collapsed to one newline, so
// every paragraph counted as a single paragraph, and `</li><li>` collapsed to
// nothing, so a list's items ran into one another and produced a bogus
// 78-word "sentence". Both numbers were pure artifacts of the extraction.
const plain = rich
  .replace(/<img[^>]*>/g, " ")
  .replace(/<hr\s*\/?>/g, "\n\n")
  .replace(/<\/(p|h[1-6]|blockquote|aside|footer|ul|ol|details)>/g, "\n\n")
  .replace(/<\/li>/g, "\n")
  .replace(/<li>/g, "• ")
  .replace(/<br\s*\/?>/g, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const paras = plain
  .split(/\n{2,}/)
  .map((p) => p.trim())
  .filter(Boolean);
const sentences = plain
  .split(/(?<=[.!?…])\s+/)
  .map((s) => s.trim())
  .filter((s) => s.length > 1);
const words = plain.split(/\s+/).filter(Boolean);
const wordsPerSentence = sentences.map(
  (s) => s.split(/\s+/).filter(Boolean).length,
);
const sorted = [...wordsPerSentence].sort((a, b) => a - b);
const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
const avg = wordsPerSentence.length
  ? Math.round(
      wordsPerSentence.reduce((a, b) => a + b, 0) / wordsPerSentence.length,
    )
  : 0;

const openers = sentences.map((s) => s.split(/\s+/)[0].toLowerCase());
const openerCounts = {};
for (const o of openers) openerCounts[o] = (openerCounts[o] || 0) + 1;
const repeatedOpeners = Object.entries(openerCounts)
  .filter(([, n]) => n > 1)
  .sort((a, b) => b[1] - a[1]);

const structure = {
  "has headings (h1-h6)": /<h[1-6][\s>]/.test(rich),
  "has bullet/numbered list": /<(ul|ol)[\s>]/.test(rich),
  "has blockquote/pull quote": /<(blockquote|aside)[\s>]/.test(rich),
  "has table": /<table[\s>]/.test(rich),
  "has collapsible <details>": /<details[\s>]/.test(rich),
  "has spoiler": /<tg-spoiler[\s>]/.test(rich),
  "has inline link": /<a href/.test(rich),
};

console.log(`\n=== CONTENT DIAGNOSTICS ===`);
console.log(
  `paragraphs=${paras.length} sentences=${sentences.length} words=${words.length}`,
);
console.log(
  `words/sentence: avg=${avg} median=${median} max=${Math.max(0, ...wordsPerSentence)}`,
);
console.log(
  `longest paragraph=${Math.max(0, ...paras.map((p) => p.length))} chars`,
);
console.log(`reading time ~${Math.max(1, Math.round(words.length / 200))} min`);
console.log(
  `contains digits=${/\d/.test(plain)} questions=${(plain.match(/\?/g) || []).length} links=${(rich.match(/<a href/g) || []).length}`,
);
console.log(
  `repeated sentence openers: ${repeatedOpeners.length ? repeatedOpeners.map(([w, n]) => `${w}×${n}`).join(", ") : "none"}`,
);
console.log(`-- structure --`);
for (const [k, v] of Object.entries(structure)) {
  console.log(`${v ? "YES" : "no "} | ${k}`);
}

// ── send to the ADMIN chat only (never the channel) ─────────────────────────
if (!ADMIN) {
  console.log("\nTELEGRAM_ADMIN_IDS not set — skipping the visual preview");
  process.exit(failed ? 1 : 0);
}

const imagePath = doc.imagePath;
const hasImage = Boolean(imagePath && fs.existsSync(imagePath));
const html = hasImage ? `<img src="tg://photo?id=cover"/>\n\n${rich}` : rich;

const form = new FormData();
form.append("chat_id", String(ADMIN));
form.append(
  "rich_message",
  JSON.stringify(
    hasImage
      ? {
          html,
          media: [
            {
              id: "cover",
              media: { type: "photo", media: "attach://cover.png" },
            },
          ],
        }
      : { html },
  ),
);
if (hasImage) {
  const ext = path.extname(imagePath).toLowerCase();
  const part = ext === ".jpg" || ext === ".jpeg" ? "cover.jpg" : "cover.png";
  // Re-key the media entry to the actual part name.
  form.set(
    "rich_message",
    JSON.stringify({
      html,
      media: [
        { id: "cover", media: { type: "photo", media: `attach://${part}` } },
      ],
    }),
  );
  form.append(
    part,
    new File([fs.readFileSync(imagePath)], part, {
      type: ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png",
    }),
  );
}

const res = await fetch(api("sendRichMessage"), {
  method: "POST",
  body: form,
  signal: AbortSignal.timeout(120_000),
});
const out = await parse(res);
console.log(
  `\n=== PREVIEW SEND (admin chat) ===\n${out.ok ? "OK" : "FAIL"} http=${out.http} ${out.description || ""}`,
);
console.log(
  out.ok
    ? "Left in the admin chat on purpose — this is the layout a real post will use."
    : "Preview not delivered; see the error above.",
);

process.exit(failed ? 1 : 0);
