/**
 * Probe what THIS bot's Telegram API actually accepts for long / rich messages.
 *
 * Round 1 (answered):
 *   - `sendRichMessage` with the NESTED shape `rich_message: {html}` works in a
 *     CHANNEL (drafts are private-only; the final message is not).
 *   - 20 000 chars in one message is accepted; 40 000 is rejected with
 *     RICH_MESSAGE_TEXT_TOO_LONG. The ceiling is 32768.
 *   - `sendPhoto` captions did NOT rise — 2000 is still rejected. So the caption
 *     route cannot deliver a one-message post; sendRichMessage is the way.
 *   - Media needs `InputRichMessageMedia { id, media }` — the first attempt was
 *     rejected with: can't parse InputRichMessageMedia: Can't find field "id".
 *
 * Round 2 (this run): pin down the media shape so the cover image can live
 * INSIDE the rich message instead of being a separate photo.
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

/** sendRichMessage with a file part (multipart) — needed for attach:// uploads. */
async function callRichMultipart(chatId, richMessage, file) {
  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("rich_message", JSON.stringify(richMessage));
    if (file) {
      form.append(file.partName, new File([file.buf], file.partName, { type: file.type }));
    }
    const res = await fetch(api("sendRichMessage"), {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    return await parse(res);
  } catch (e) {
    return { http: 0, ok: false, description: `fetch error: ${e.message}` };
  }
}

const PNG_FILE = { buf: PNG, partName: "cover.png", type: "image/png" };

// ── probes ─────────────────────────────────────────────────────────────────
console.log("=== TARGETS ===");
console.log(`channel=${CHANNEL ? "set" : "(none)"} admin=${ADMINS.length ? "set" : "(none)"}`);

// ── round 1: regression check that the basics still hold ────────────────────
if (CHANNEL) {
  const r = await callJson("sendRichMessage", {
    chat_id: CHANNEL,
    rich_message: { html: "<b>probe</b> — rich message support check" },
  });
  record("r1_rich_html_channel", r, r.ok ? await del(CHANNEL, r.result?.message_id) : "");

  const long20k = `<b>LONG20K</b>\n` + "a".repeat(19_990);
  const rl = await callJson("sendRichMessage", {
    chat_id: CHANNEL,
    rich_message: { html: long20k },
  });
  record("r1_rich_20000_chars_channel", rl, rl.ok ? await del(CHANNEL, rl.result?.message_id) : "");
}

// ── round 2: the media shape ────────────────────────────────────────────────
// InputRichMessageMedia = { id, media } where `media` is an InputMediaPhoto and
// `id` is referenced from markup as tg://photo?id=<id>.
if (CHANNEL) {
  // V1: attach:// upload + tg://photo reference — the shape the publisher wants.
  const v1 = await callRichMultipart(
    CHANNEL,
    {
      html: '<p>Media probe</p><img src="tg://photo?id=cover"/>',
      media: [{ id: "cover", media: { type: "photo", media: "attach://cover.png" } }],
    },
    PNG_FILE,
  );
  record("r2_media_attach_tgref_channel", v1, v1.ok ? await del(CHANNEL, v1.result?.message_id) : "");

  // V2: same media entry, but the markup does NOT reference it — isolates
  // whether a failure is in the media entry or in the reference syntax.
  const v2 = await callRichMultipart(
    CHANNEL,
    {
      html: "<p>Media probe, unreferenced</p>",
      media: [{ id: "cover", media: { type: "photo", media: "attach://cover.png" } }],
    },
    PNG_FILE,
  );
  record("r2_media_attach_noref_channel", v2, v2.ok ? await del(CHANNEL, v2.result?.message_id) : "");

  // V3: plain <img src="https://..."> with no media array — does a remote image
  // render without going through InputRichMessageMedia at all?
  const v3 = await callJson("sendRichMessage", {
    chat_id: CHANNEL,
    rich_message: {
      html: '<p>URL media probe</p><img src="https://telegram.org/img/t_logo.png"/>',
    },
  });
  record("r2_media_url_img_tag_channel", v3, v3.ok ? await del(CHANNEL, v3.result?.message_id) : "");
}

// ── showcase: leave ONE message in the admin chat for human inspection ──────
const showcaseMarkdown = [
  "# Rich message probe",
  "",
  "Bu Telegram'ning yangi **rich message** formati. Agar sarlavha, ro'yxat va",
  "iqtibos chiroyli ko'rinsa — format ishlaydi.",
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
record("showcase_markdown_admin", showcase, showcase.ok ? "LEFT IN PLACE (review it)" : "");

// The money shot: cover image INSIDE the rich message, with formatting.
const showcaseMedia = await callRichMultipart(
  ADMIN,
  {
    html:
      "<h1>Media + formatting probe</h1>" +
      '<img src="tg://photo?id=cover"/>' +
      "<p>Rasm <b>rich message ichida</b> — alohida xabar emas.</p>" +
      "<ul><li>birinchi</li><li>ikkinchi</li></ul>" +
      "<blockquote>Iqtibos</blockquote>",
    media: [{ id: "cover", media: { type: "photo", media: "attach://cover.png" } }],
  },
  PNG_FILE,
);
record("showcase_media_admin", showcaseMedia, showcaseMedia.ok ? "LEFT IN PLACE (review it)" : "");

// ── report ─────────────────────────────────────────────────────────────────
console.log("\n=== RESULTS ===");
for (const r of results) {
  console.log(
    `${r.ok ? "OK  " : "FAIL"} | ${r.name.padEnd(32)} | http=${String(r.http).padEnd(3)} | ${r.description}` +
      (r.note ? ` | ${r.note}` : ""),
  );
}
const worked = results.filter((r) => r.ok).map((r) => r.name);
console.log(`\n=== SUMMARY === passed: ${worked.length}/${results.length}`);
if (worked.length) console.log(`working: ${worked.join(", ")}`);
