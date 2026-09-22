/**
 * Round 3 probe: does the cover image actually LAND inside the rich message,
 * and does the post's real payload shape survive the round trip?
 *
 * Why this exists: rounds 1-2 proved `sendRichMessage` accepts our payload
 * (HTTP 200), but 200 only proves the request parsed — not that the photo became
 * a block in the message. The docs say "Media can be specified only as a
 * separate block", and the publisher currently emits
 * `<img src="tg://photo?id=cover"/>` glued directly onto the body text. If that
 * violates the rule, Telegram may silently DROP the image and still answer 200.
 *
 * The ground truth is the response: `sendRichMessage` returns the sent Message,
 * and `Message.rich_message.blocks` lists the blocks Telegram actually created.
 * A `photo` block in there means the cover landed.
 *
 * Probes:
 *   A  img glued to the text      (current production shape)
 *   B  img as its own block       (documented shape)
 *   C  img + <hr/> + <footer>     (the richer layout we want to ship)
 *   D  <footer>/<hr/> alone       (are the rich-only tags accepted at all?)
 *
 * Safety:
 *   - NEVER prints the token.
 *   - Every message it creates is deleted (with retries) before it exits.
 *   - Does not touch the DB, the scheduler, or any state.
 *
 * Usage (inside the container):  node scripts/tg-rich-shape-probe.mjs
 */
import zlib from "node:zlib";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHANNEL = (process.env.TELEGRAM_CHANNEL || "").trim();

if (!TOKEN) {
  console.log("TELEGRAM_BOT_TOKEN not set — nothing to probe");
  process.exit(0);
}
if (!CHANNEL) {
  console.log("TELEGRAM_CHANNEL not set — nothing to probe");
  process.exit(0);
}

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

function makePng(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
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
const PNG_FILE = { buf: PNG, partName: "cover.png", type: "image/png" };

// ── API helpers ────────────────────────────────────────────────────────────
const api = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;

async function parse(res) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return {
      http: res.status,
      ok: Boolean(j.ok),
      description: j.description,
      result: j.result,
    };
  } catch {
    return {
      http: res.status,
      ok: false,
      description: `non-JSON: ${text.slice(0, 160)}`,
    };
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

async function callRichMultipart(richMessage, file) {
  try {
    const form = new FormData();
    form.append("chat_id", CHANNEL);
    form.append("rich_message", JSON.stringify(richMessage));
    if (file) {
      form.append(
        file.partName,
        new File([file.buf], file.partName, { type: file.type }),
      );
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

/** Delete with retries — the earlier rounds leaked messages when this flaked. */
async function del(messageId) {
  if (!messageId) return "no message_id";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await callJson("deleteMessage", {
      chat_id: CHANNEL,
      message_id: messageId,
    });
    if (r.ok) return "deleted";
    if (attempt === 4) return `delete FAILED after 4 tries: ${r.description}`;
    await new Promise((s) => setTimeout(s, 800 * attempt));
  }
  return "unreachable";
}

/** The block types Telegram actually created — the whole point of this probe. */
function blockTypes(res) {
  const blocks = res.result?.rich_message?.blocks;
  if (!Array.isArray(blocks)) return "(no rich_message.blocks in response)";
  if (blocks.length === 0) return "(0 blocks)";
  return blocks.map((b) => b.type).join(" → ");
}

function hasPhoto(res) {
  const blocks = res.result?.rich_message?.blocks;
  return Array.isArray(blocks) && blocks.some((b) => b.type === "photo");
}

// ── probes ─────────────────────────────────────────────────────────────────
const results = [];

async function probe(name, richMessage, file) {
  const res = file
    ? await callRichMultipart(richMessage, file)
    : await callJson("sendRichMessage", {
        chat_id: CHANNEL,
        rich_message: richMessage,
      });
  const note = res.ok ? await del(res.result?.message_id) : "";
  results.push({
    name,
    ok: res.ok,
    http: res.http,
    description: (res.description || "").slice(0, 110),
    blocks: blockTypes(res),
    photo: hasPhoto(res),
    note,
  });
}

const MEDIA = [
  { id: "cover", media: { type: "photo", media: "attach://cover.png" } },
];

console.log("=== TARGET ===");
console.log(`channel=${CHANNEL ? "set" : "(none)"}`);

// A — the CURRENT production shape: <img/> glued straight onto the body text.
await probe(
  "A_img_glued",
  {
    html: '<img src="tg://photo?id=cover"/><p>Shape probe A</p>',
    media: MEDIA,
  },
  PNG_FILE,
);

// B — the DOCUMENTED shape: the image is its own block.
await probe(
  "B_img_separate_block",
  {
    html: '<img src="tg://photo?id=cover"/>\n\n<p>Shape probe B</p>',
    media: MEDIA,
  },
  PNG_FILE,
);

// C — the layout we want to ship: cover block, body, real divider, footer.
await probe(
  "C_img_hr_footer",
  {
    html:
      '<img src="tg://photo?id=cover"/>\n\n' +
      "<p>Shape probe C</p>\n\n" +
      "<hr/>\n" +
      "<footer><b>Istam Obidov</b>\nAI Engineering\n" +
      '<a href="https://t.me/istam_obidov">Telegram</a></footer>',
    media: MEDIA,
  },
  PNG_FILE,
);

// D — are the rich-only tags (<hr/>, <footer>) accepted at all, without media?
await probe("D_hr_footer_only", {
  html: "<p>Shape probe D</p>\n<hr/>\n<footer>Footer block</footer>",
});

// E — does the classic fallback still reject them? (proves we must NOT put
//     rich-only tags into `text`, which the caption layout also consumes)
const classic = await callJson("sendMessage", {
  chat_id: CHANNEL,
  text: "<p>Shape probe E</p>\n<hr/>\n<footer>Footer block</footer>",
  parse_mode: "HTML",
});
results.push({
  name: "E_classic_rejects_richtags",
  ok: classic.ok,
  http: classic.http,
  description: (classic.description || "").slice(0, 110),
  blocks: "n/a",
  photo: false,
  note: classic.ok
    ? await del(classic.result?.message_id)
    : "(rejected = good)",
});

// ── report ─────────────────────────────────────────────────────────────────
console.log("\n=== RESULTS ===");
for (const r of results) {
  console.log(
    `${r.ok ? "OK  " : "FAIL"} | ${r.name.padEnd(26)} | http=${String(r.http).padEnd(3)} | photo=${r.photo ? "YES" : "no "} | ${r.description}`,
  );
  console.log(`       blocks: ${r.blocks}`);
  if (r.note) console.log(`       cleanup: ${r.note}`);
}

const leaked = results.filter((r) => r.note.startsWith("delete FAILED"));
console.log(
  `\n=== SUMMARY === ok=${results.filter((r) => r.ok).length}/${results.length} leaked=${leaked.length}`,
);
if (leaked.length) {
  console.log(
    "LEAKED (needs cleanup): " + leaked.map((r) => r.name).join(", "),
  );
}
