/**
 * Facebook + Instagram token via one Facebook Login (no local HTTPS server).
 *
 * Meta app (FACEBOOK_APP_ID) → Facebook Login → Valid OAuth Redirect URIs:
 *   https://oauth.pstmn.io/v1/callback
 *
 * Also enable products: Facebook Login, Instagram Graph API (or Instagram).
 * Permissions (App Review later for prod): pages_show_list, pages_manage_posts,
 *   instagram_basic, instagram_content_publish
 *
 * Usage:
 *   npm run auth:facebook
 *   npm run auth:facebook -- --code=AQB...
 *   npm run auth:facebook -- --url="https://oauth.pstmn.io/v1/callback?code=..."
 *   npm run auth:facebook -- --token=EAA... --page-id=...
 */
import "dotenv/config";
import { createInterface } from "readline";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import path from "path";
import { exec } from "child_process";

const APP_ID = process.env.FACEBOOK_APP_ID || process.env.INSTAGRAM_APP_ID || "";
const APP_SECRET =
  process.env.FACEBOOK_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || "";
const REDIRECT =
  process.env.FACEBOOK_REDIRECT_URI || "https://oauth.pstmn.io/v1/callback";
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "public_profile",
].join(",");

const TOKENS_DIR = path.resolve("data/tokens");
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
    if (v === undefined || v === null || v === "") continue;
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, line);
    else text = text.trimEnd() + `\n${line}\n`;
  }
  writeFileSync(ENV_PATH, text.endsWith("\n") ? text : text + "\n", "utf8");
}

function saveJson(platform, payload) {
  mkdirSync(TOKENS_DIR, { recursive: true });
  writeFileSync(
    path.join(TOKENS_DIR, `${platform}.json`),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
}

async function resolvePageAndIg(userToken) {
  const pagesRes = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts` +
      `?fields=id,name,access_token,instagram_business_account` +
      `&access_token=${encodeURIComponent(userToken)}`,
  );
  const pagesJson = await pagesRes.json();
  if (!pagesJson.data?.length) {
    throw new Error(
      pagesJson.error?.message ||
        "No Facebook Pages. Create a Page and link Instagram Business/Creator.",
    );
  }
  console.log("\nPages found:");
  for (const p of pagesJson.data) {
    console.log(
      `  - ${p.name} (${p.id}) IG=${p.instagram_business_account?.id || "none"}`,
    );
  }
  const page =
    pagesJson.data.find((p) => p.instagram_business_account?.id) || pagesJson.data[0];
  return page;
}

function persist(page, userToken, expiresIn) {
  const igId = page.instagram_business_account?.id || "";

  saveJson("facebook", {
    platform: "facebook",
    accessToken: page.access_token,
    userId: page.id,
    obtainedAt: Date.now(),
    expiresIn,
    scopes: SCOPES,
    extra: { pageName: page.name, userToken, instagramUserId: igId || undefined },
  });

  const envMap = {
    FACEBOOK_PAGE_TOKEN: page.access_token,
    FACEBOOK_PAGE_ID: page.id,
    FACEBOOK_REDIRECT_URI: REDIRECT,
  };

  if (igId) {
    saveJson("instagram", {
      platform: "instagram",
      accessToken: page.access_token,
      userId: igId,
      obtainedAt: Date.now(),
      expiresIn,
      scopes: SCOPES,
      extra: { pageId: page.id, pageName: page.name },
    });
    envMap.INSTAGRAM_TOKEN = page.access_token;
    envMap.INSTAGRAM_USER_ID = igId;
    console.log("\n✅ Instagram Business linked:", igId);
  } else {
    console.warn(
      "\n⚠ Instagram Business account not linked to this Page.\n" +
        "  Meta Business Suite → link IG Business/Creator to the Facebook Page.",
    );
  }

  upsertEnv(envMap);
  console.log("\n✅ Facebook Page saved:", page.name, page.id);
  console.log("  data/tokens/facebook.json");
  if (igId) console.log("  data/tokens/instagram.json");
  console.log("  .env updated (FACEBOOK_* / INSTAGRAM_*)");
}

async function exchangeCode(code) {
  if (!APP_ID || !APP_SECRET) {
    throw new Error("FACEBOOK_APP_ID and FACEBOOK_APP_SECRET required in .env");
  }
  const tokenUrl =
    `https://graph.facebook.com/v19.0/oauth/access_token` +
    `?client_id=${encodeURIComponent(APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
    `&client_secret=${encodeURIComponent(APP_SECRET)}` +
    `&code=${encodeURIComponent(code)}`;
  const tokenRes = await fetch(tokenUrl);
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    throw new Error(
      tokenJson.error?.message || JSON.stringify(tokenJson) || "token exchange failed",
    );
  }

  const llUrl =
    `https://graph.facebook.com/v19.0/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(APP_ID)}` +
    `&client_secret=${encodeURIComponent(APP_SECRET)}` +
    `&fb_exchange_token=${encodeURIComponent(tokenJson.access_token)}`;
  const llRes = await fetch(llUrl);
  const llJson = await llRes.json();
  const userToken = llJson.access_token || tokenJson.access_token;
  const expiresIn = llJson.expires_in;

  const page = await resolvePageAndIg(userToken);
  persist(page, userToken, expiresIn);
}

async function main() {
  const tokenArg = arg("token");
  const pageIdArg = arg("page-id") || arg("pageId");
  const codeArg = arg("code");
  const urlArg = arg("url");

  console.log("\n=== Facebook + Instagram (one login) ===");
  console.log("App ID:", APP_ID || "(missing)");
  console.log("Redirect (must match Meta exactly):\n ", REDIRECT);

  if (tokenArg) {
    // User pasted a long-lived user or page token
    let page;
    if (pageIdArg) {
      const pr = await fetch(
        `https://graph.facebook.com/v19.0/${pageIdArg}` +
          `?fields=id,name,access_token,instagram_business_account` +
          `&access_token=${encodeURIComponent(tokenArg)}`,
      );
      page = await pr.json();
      if (page.error) throw new Error(page.error.message);
      // If token is page token, access_token field may be missing — use tokenArg
      if (!page.access_token) page.access_token = tokenArg;
    } else {
      page = await resolvePageAndIg(tokenArg);
    }
    persist(page, tokenArg, undefined);
    return;
  }

  let code = codeArg || (urlArg ? extractCode(urlArg) : "");
  if (!code) {
    if (!APP_ID) throw new Error("Set FACEBOOK_APP_ID in .env");
    const authUrl =
      `https://www.facebook.com/v19.0/dialog/oauth` +
      `?client_id=${encodeURIComponent(APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&response_type=code`;

    console.log(`
STEP 1 — Meta Developer app ${APP_ID}:
  Facebook Login → Settings → Valid OAuth Redirect URIs:
    ${REDIRECT}
  Client OAuth Login = ON, Web OAuth Login = ON
  Products: Facebook Login + Instagram (Graph / content publish)
  App roles: your account is Admin/Developer/Tester

STEP 2 — Browser: Allow all permissions (Page + Instagram).
`);
    openBrowser(authUrl);
    console.log("Auth URL:\n", authUrl, "\n");
    const pasted = await ask(
      "STEP 3 — Paste full redirect URL (or code= value), then Enter:\n> ",
    );
    code = extractCode(pasted);
  }

  if (!code) throw new Error("No code found");
  await exchangeCode(code);
  console.log("\nDone. Check: npm run auth:status");
}

main().catch((e) => {
  console.error("\n❌", e.message || e);
  process.exit(1);
});
