/**
 * Delete stray messages from the channel by content match.
 *
 * Why this exists: the rich-message probe left two "Media probe" messages behind
 * because `deleteMessage` failed with a transient `fetch failed` right after the
 * multipart uploads. Telegram's Bot API has no "list channel messages", so the
 * only way back is to walk ids downward from a known anchor.
 *
 * How it works, and why it is safe:
 *   1. Post a sentinel to the channel — its id becomes the anchor.
 *   2. Walk ids downward, and for each candidate FORWARD it to the admin chat.
 *      `forwardMessage` returns the full Message, so the text can be inspected.
 *   3. Delete from the channel ONLY if the text matches. Everything else is
 *      reported as "kept" — so a shift in the id space can never silently delete
 *      a real post.
 *   4. Delete the forwarded copies and the sentinel.
 *
 * Usage (inside the container):
 *   node scripts/tg-channel-cleanup.mjs --match "Media probe" --scan 8
 *   node scripts/tg-channel-cleanup.mjs --match "Media probe" --scan 8 --dry-run
 */
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHANNEL = (process.env.TELEGRAM_CHANNEL || "").trim();
const ADMINS = (process.env.TELEGRAM_ADMIN_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ADMIN = ADMINS[0] || "";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const MATCH = arg("match", "Media probe");
const SCAN = Number(arg("scan", "8"));
const DRY_RUN = argv.includes("--dry-run");

if (!TOKEN || !CHANNEL || !ADMIN) {
  console.log(
    "TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL and TELEGRAM_ADMIN_IDS are all required",
  );
  process.exit(0);
}

const api = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;

async function call(method, body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(api(method), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        return {
          ok: Boolean(j.ok),
          description: j.description,
          result: j.result,
        };
      } catch {
        return { ok: false, description: `non-JSON: ${text.slice(0, 140)}` };
      }
    } catch (e) {
      if (attempt === 3)
        return { ok: false, description: `fetch error: ${e.message}` };
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return { ok: false, description: "unreachable" };
}

// 1. anchor
const sentinel = await call("sendMessage", {
  chat_id: CHANNEL,
  text: `🧹 cleanup scan — safe to delete (${new Date().toISOString()})`,
});
if (!sentinel.ok) {
  console.log(`FAILED to post sentinel: ${sentinel.description}`);
  process.exit(1);
}
const anchor = sentinel.result.message_id;
console.log(
  `anchor message_id=${anchor}, scanning ${anchor - 1} … ${anchor - SCAN}`,
);
console.log(`match=${JSON.stringify(MATCH)} dry_run=${DRY_RUN}\n`);

let deleted = 0;
let kept = 0;

for (let i = 1; i <= SCAN; i++) {
  const cand = anchor - i;
  if (cand <= 0) break;

  // 2. forward to inspect (returns the full Message, including text)
  const fwd = await call("forwardMessage", {
    chat_id: ADMIN,
    from_chat_id: CHANNEL,
    message_id: cand,
  });

  if (!fwd.ok) {
    console.log(`  ${cand}: not inspectable (${fwd.description})`);
    continue;
  }

  const text = String(fwd.result.text || fwd.result.caption || "");
  const matched = text.includes(MATCH);

  if (matched) {
    if (DRY_RUN) {
      console.log(
        `  ${cand}: MATCH (dry-run, not deleted) "${text.slice(0, 60)}"`,
      );
    } else {
      const d = await call("deleteMessage", {
        chat_id: CHANNEL,
        message_id: cand,
      });
      console.log(
        `  ${cand}: MATCH → ${d.ok ? "DELETED" : `delete FAILED (${d.description})`} "${text.slice(0, 60)}"`,
      );
      if (d.ok) deleted++;
    }
  } else {
    console.log(`  ${cand}: kept — "${text.slice(0, 60)}"`);
    kept++;
  }

  // 3. never leave the inspection copy behind
  if (!DRY_RUN) {
    await call("deleteMessage", {
      chat_id: ADMIN,
      message_id: fwd.result.message_id,
    });
  }
}

// 4. remove the sentinel
if (!DRY_RUN) {
  const s = await call("deleteMessage", {
    chat_id: CHANNEL,
    message_id: anchor,
  });
  console.log(
    `\nsentinel ${anchor}: ${s.ok ? "deleted" : `DELETE FAILED (${s.description})`}`,
  );
} else {
  console.log(`\nsentinel ${anchor}: left in place (dry-run)`);
}

console.log(`\n=== SUMMARY === deleted=${deleted} kept=${kept}`);
