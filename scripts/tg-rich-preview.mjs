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
const fs = await import("node:fs");
const path = await import("node:path");

const list = listCanonical(1);
if (!list.length) {
  console.log("no canonical documents found — nothing to preview");
  process.exit(0);
}

const id = list[0].id;
const doc = loadCanonical(id);
if (!doc) {
  console.log(`canonical ${id} listed but could not be loaded`);
  process.exit(0);
}

console.log(`=== CANONICAL ===`);
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
console.log(`\n=== FORMATTED ===`);
console.log(`text=${tg.text.length} caption=${(tg.caption || "").length}`);
console.log(`richHtml=${rich.length} (${tg.richHtml ? "present" : "ABSENT"})`);

const checks = [
  ["richHtml has <hr/>", rich.includes("<hr/>")],
  [
    "richHtml has <footer>",
    rich.includes("<footer>") && rich.includes("</footer>"),
  ],
  ["richHtml dropped the ASCII rule", !rich.includes("────────")],
  ["text keeps the ASCII rule", tg.text.includes("────────")],
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

console.log(`\n=== richHtml HEAD (first 700 chars) ===`);
console.log(rich.slice(0, 700));
console.log(`\n=== richHtml TAIL (last 400 chars) ===`);
console.log(rich.slice(-400));

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
