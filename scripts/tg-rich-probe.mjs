/**
 * Probe what THIS bot's Telegram API actually accepts for long / rich messages.
 *
 * Answers, empirically, the questions the docs leave open:
 *   1. Does `sendRichMessage` exist for this bot?
 *   2. Does it work in a CHANNEL (the docs only confirm drafts are private-only)?
 *   3. Does it accept the `html` form (so we can reuse our existing formatted text)?
 *   4. What is the real maximum length — 32768 or still 4096?
 *   5. Did `sendPhoto`'s caption limit rise above 1024?
 *   6. Is the payload nested (`rich_message: {...}`) or flat (`html: "..."`)?
 *   7. Can a photo be embedded inside a rich message?
 *
 * Safety:
 *   - NEVER prints the token (only method names and API responses).
 *   - Every test message is deleted right after its result is recorded, except
 *     one showcase message left in the admin chat so a human can see rendering.
 *   - Read-only with respect to the pipeline: it does not touch the DB or
 *     the scheduler.
 *
 * Usage (inside the container):  node scripts/tg-rich-probe.mjs
 */
import zlib from "node:zlib";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHANNEL = (process.env.TELEGRAM_CHANNEL || "").trim();
const ADMINS = (process.env.TELEGRAM_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!TOKEN) {
  console.log("TELEGRAM_BOT_TOKEN not set — nothing to probe");
  process.exit(0);
}
if (!CHANNEL && ADMINS.length === 0) {
  console.log("Neither TELEGRAM_CHANNEL nor TELEGRAM_ADMIN_IDS set — no target");
  process.exit(0);
}

const ADMIN = ADMINS[0] || CHANNEL;

// ── minimal PNG encoder (offline; no network, no deps) ──────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A real, valid PNG so sendPhoto cannot fail for image reasons. */
function makePng(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const PNG = makePng(640, 360, [24, 52, 110]);

// ── API helpers ────────────────────────────────────────────────────────────
const api = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;

async function parse(res) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return { http: res.status, ok: Boolean(j.ok), description: j.description, result: j.result };
  } catch {
    return { http: res.status, ok: false, description: `non-JSON: ${text.slice(0, 160)}` };
  }
}

async function callJson(method, body) {
  try {
    const res = await fetch(api(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    return await parse(res);
  } catch (e) {
    return { http: 0, ok: false, description: `fetch error: ${e.message}` };
  }
}

async function callPhoto(chatId, caption) {
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", new File([PNG], "probe.png", { type: "image/png" }));
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    const res = await fetch(api("sendPhoto"), {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    return await parse(res);
  } catch (e) {
    return { http: 0, ok: false, description: `fetch error: ${e.message}` };
  }
}

async function del(chatId, messageId) {
  if (!messageId) return "no message_id";
  const r = await callJson("deleteMessage", { chat_id: chatId, message_id: messageId });
  return r.ok ? "deleted" : `delete FAILED: ${r.description}`;
}

const results = [];
function record(name, res, note = "") {
  results.push({
    name,
    ok: res.ok,
    http: res.http,
    description: (res.description || "").slice(0, 130),
    note,
  });
}

// ── probes ─────────────────────────────────────────────────────────────────
console.log("=== TARGETS ===");
console.log(`channel=${CHANNEL ? "set" : "(none)"} admin=${ADMINS.length ? "set" : "(none)"}`);

// 1. Does the method exist at all, and does it accept a CHANNEL?
if (CHANNEL) {
  const r = await callJson("sendRichMessage", {
    chat_id: CHANNEL,
    rich_message: { html: "<b>probe</b> — rich message support check" },
  });
  record("rich_nested_html_channel", r, r.ok ? await del(CHANNEL, r.result?.message_id) : "");

  // 6. If nested failed, is the shape flat instead?
  if (!r.ok) {
    const flat = await callJson("sendRichMessage", {
      chat_id: CHANNEL,
      html: "<b>probe</b> — flat shape check",
    });
    record("rich_flat_html_channel", flat, flat.ok ? await del(CHANNEL, flat.result?.message_id) : "");
  }

  // 4. Real maximum length. 20000 chars is well past the old 4096.
  const long20k = `<b>LONG20K</b>\n` + "a".repeat(19_990);
  const rl = await callJson("sendRichMessage", {
    chat_id: CHANNEL,
    rich_message: { html: long20k },
  });
  record("rich_html_20000_chars_channel", rl, rl.ok ? await del(CHANNEL, rl.result?.message_id) : "");

  // 40000 chars should exceed any plausible limit — confirms the ceiling exists.
  const long40k = "b".repeat(40_000);
  const rx = await callJson("sendRichMessage", {
    chat_id: CHANNEL,
    rich_message: { html: long40k },
  });
  record("rich_html_40000_chars_channel", rx, rx.ok ? await del(CHANNEL, rx.result?.message_id) : "");

  // 5. Did sendPhoto's caption limit rise above 1024?
  const cap2000 = await callPhoto(CHANNEL, "C".repeat(2000));
  record("sendPhoto_caption_2000", cap2000, cap2000.ok ? await del(CHANNEL, cap2000.result?.message_id) : "");

  const cap5000 = await callPhoto(CHANNEL, "D".repeat(5000));
  record("sendPhoto_caption_5000", cap5000, cap5000.ok ? await del(CHANNEL, cap5000.result?.message_id) : "");

  // 7. Can media be embedded? Guessed shape — the error text is the payload.
  const mediaTry = await callJson("sendRichMessage", {
    chat_id: CHANNEL,
    rich_message: {
      html: '<b>media probe</b><br/><img src="attach://probe.png"/>',
      media: [{ type: "photo", media: "attach://probe.png" }],
    },
  });
  record("rich_media_guess_channel", mediaTry, mediaTry.ok ? await del(CHANNEL, mediaTry.result?.message_id) : "");
}

// 3+8. Showcase in the admin chat, LEFT IN PLACE for human inspection.
const showcaseMarkdown = [
  "# Rich message probe",
  "",
  "Bu Telegram'ning yangi **rich message** formati. Agar shu xabar sarlavha,",
  "ro'yxat va iqtibos bilan chiroyli ko'rinsa — format ishlaydi.",
  "",
  "## Ro'yxat",
  "",
  "- Birinchi band",
  "- Ikkinchi band",
  "",
  "> Iqtibos shu yerda ko'rinadi.",
  "",
  "`inline code` va [havola](https://telegram.org) ham.",
].join("\n");

const showcase = await callJson("sendRichMessage", {
  chat_id: ADMIN,
  rich_message: { markdown: showcaseMarkdown },
});
record("rich_markdown_showcase_admin", showcase, showcase.ok ? "LEFT IN PLACE (review it)" : "");

if (!showcase.ok) {
  // Fall back to the html form so we still learn which one works.
  const alt = await callJson("sendRichMessage", {
    chat_id: ADMIN,
    rich_message: { html: "<h1>Rich probe</h1><p>html form</p><ul><li>one</li></ul>" },
  });
  record("rich_html_showcase_admin", alt, alt.ok ? "LEFT IN PLACE (review it)" : "");
}

// ── report ─────────────────────────────────────────────────────────────────
console.log("\n=== RESULTS ===");
for (const r of results) {
  console.log(
    `${r.ok ? "OK  " : "FAIL"} | ${r.name.padEnd(34)} | http=${String(r.http).padEnd(3)} | ${r.description}` +
      (r.note ? ` | ${r.note}` : ""),
  );
}
const worked = results.filter((r) => r.ok).map((r) => r.name);
console.log(`\n=== SUMMARY === passed: ${worked.length}/${results.length}`);
if (worked.length) console.log(`working: ${worked.join(", ")}`);
