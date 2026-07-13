/**
 * Threads token without local HTTPS server.
 *
 * Plan A (recommended if Meta allows saving ONE redirect URI):
 *   Meta → Redirect Callback URLs:
 *     https://oauth.pstmn.io/v1/callback
 *   Then: node scripts/threads-token.mjs
 *   Browser opens → Allow → copy ?code= from address bar → paste here
 *
 * Plan B (already have token + user id):
 *   node scripts/threads-token.mjs --token=THQVJ... --user-id=123
 *
 * Plan C (exchange only):
 *   node scripts/threads-token.mjs --code=AQB...
 */
import "dotenv/config";
import { createInterface } from "readline";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import path from "path";
import { exec } from "child_process";

const APP_ID = process.env.THREADS_APP_ID || process.env.FACEBOOK_APP_ID || "";
const APP_SECRET =
  process.env.THREADS_APP_SECRET || process.env.FACEBOOK_APP_SECRET || "";
// Public HTTPS redirect used by Postman OAuth helper — no local server needed.
const REDIRECT =
  process.env.THREADS_REDIRECT_URI || "https://oauth.pstmn.io/v1/callback";
const SCOPES = "threads_basic,threads_content_publish";
const TOKENS_DIR = path.resolve("data/tokens");
const TOKENS_FILE = path.join(TOKENS_DIR, "threads.json");
const ENV_PATH = path.resolve(".env");

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : "";
}

function openBrowser(url) {
  if (process.platform === "win32") exec(`start "" "${url}"`);
  else if (process.platform === "darwin") exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}

function ask(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(q, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function extractCode(raw) {
  const s = raw.replace(/#_$/, "").trim();
  if (!s) return "";
  if (!s.includes("code=") && !s.startsWith("http")) return s;
  try {
    const u = s.startsWith("http") ? new URL(s) : new URL(s, "https://x");
    return u.searchParams.get("code") || "";
  } catch {
    const m = s.match(/[?&]code=([^&#]+)/);
    return m ? decodeURIComponent(m[1]) : s;
  }
}

function upsertEnv(map) {
  let text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  for (const [k, v] of Object.entries(map)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, line);
    else text = text.trimEnd() + `\n${line}\n`;
  }
  writeFileSync(ENV_PATH, text.endsWith("\n") ? text : text + "\n", "utf8");
}

function saveTokens({ accessToken, userId, expiresIn }) {
  mkdirSync(TOKENS_DIR, { recursive: true });
  const payload = {
    platform: "threads",
    accessToken,
    userId: String(userId || ""),
    obtainedAt: Date.now(),
    expiresIn: expiresIn || undefined,
    scopes: SCOPES,
  };
  writeFileSync(TOKENS_FILE, JSON.stringify(payload, null, 2), "utf8");
  upsertEnv({
    THREADS_TOKEN: accessToken,
    THREADS_USER_ID: String(userId || ""),
    THREADS_REDIRECT_URI: REDIRECT,
  });
  console.log("\n✅ Saved:");
  console.log("  ", TOKENS_FILE);
  console.log("  .env → THREADS_TOKEN + THREADS_USER_ID");
}

async function exchangeCode(code) {
  if (!APP_ID || !APP_SECRET) {
    throw new Error("THREADS_APP_ID and THREADS_APP_SECRET required in .env");
  }
  const body = new URLSearchParams({
    client_id: APP_ID,
    client_secret: APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT,
    code,
  });
  const res = await fetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const raw = await res.text();
  // Avoid JSON.parse number precision loss on large user_id (e.g. 2668…730 vs …729)
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Threads token response not JSON: " + raw.slice(0, 200));
  }
  if (!json.access_token) {
    throw new Error(json.error_message || json.error?.message || raw);
  }

  // Prefer long-lived (~60 days) first, then resolve user via /me (string id)
  let accessToken = json.access_token;
  let expiresIn = json.expires_in;
  try {
    const ll = await fetch(
      `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(APP_SECRET)}&access_token=${encodeURIComponent(accessToken)}`,
    );
    const llJson = await ll.json();
    if (llJson.access_token) {
      accessToken = llJson.access_token;
      expiresIn = llJson.expires_in;
      console.log("Long-lived token OK, expires_in=", expiresIn);
    }
  } catch {
    console.warn("Long-lived exchange skipped; short-lived token kept");
  }

  const me = await fetch(
    `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`,
  );
  const meJson = await me.json();
  const userId = meJson.id ? String(meJson.id) : "";
  if (!userId) {
    throw new Error("Could not resolve Threads user id: " + JSON.stringify(meJson));
  }
  console.log("User:", meJson.username || userId, userId);

  saveTokens({ accessToken, userId, expiresIn });
}

async function main() {
  const tokenArg = arg("token");
  const userArg = arg("user-id") || arg("userId");
  const codeArg = arg("code");
  const urlArg = arg("url");

  console.log("\n=== Threads manual token helper ===");
  console.log("Redirect URI (must match Meta exactly):\n ", REDIRECT);
  console.log("App ID:", APP_ID || "(missing)");

  if (tokenArg) {
    let userId = userArg;
    if (!userId) {
      const me = await fetch(
        `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(tokenArg)}`,
      );
      const meJson = await me.json();
      if (!meJson.id) {
        throw new Error(
          "Token invalid or user-id required: " + JSON.stringify(meJson),
        );
      }
      userId = meJson.id;
      console.log("User:", meJson.username || userId);
    }
    saveTokens({ accessToken: tokenArg, userId });
    return;
  }

  let code = codeArg || (urlArg ? extractCode(urlArg) : "");
  if (!code) {
    if (!APP_ID) throw new Error("Set THREADS_APP_ID in .env");
    const authUrl =
      `https://threads.net/oauth/authorize` +
      `?client_id=${encodeURIComponent(APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&response_type=code`;

    console.log(`
STEP 1 — Meta Developer (Threads app ${APP_ID}):
  Use cases → Access the Threads API → Redirect Callback URLs
  Add EXACTLY:
    ${REDIRECT}
  (If Save fails: also fill Uninstall + Delete callback with same URL, then Save)

STEP 2 — Browser opens; click Allow.
`);
    openBrowser(authUrl);
    console.log("Auth URL:\n", authUrl, "\n");
    const pasted = await ask(
      "STEP 3 — Paste full redirect URL (or only code= value), then Enter:\n> ",
    );
    code = extractCode(pasted);
  }

  if (!code) throw new Error("No code found in paste");
  await exchangeCode(code);
  console.log("\nDone. Check: npm run auth:status");
}

main().catch((e) => {
  console.error("\n❌", e.message || e);
  process.exit(1);
});
