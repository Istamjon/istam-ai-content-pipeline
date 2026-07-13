/**
 * Unified CLI:
 *   npm run auth -- linkedin
 *   npm run auth -- facebook
 *   npm run auth -- threads
 *   npm run auth -- x
 *   npm run auth -- blogger
 *   npm run auth -- status
 */
import "dotenv/config";
import { getProvider, listProviders } from "./registry.js";
import { startUnifiedOAuthServer } from "./callbackServer.js";
import type { OAuthPlatform } from "./types.js";

const arg = (process.argv[2] || "status").toLowerCase();

if (arg === "status" || arg === "list") {
  console.log("\nOAuth / credential status\n");
  for (const p of listProviders()) {
    console.log(
      `${p.id.padEnd(10)} configured=${String(p.isConfigured()).padEnd(5)} ready=${String(p.isReady()).padEnd(5)}`,
    );
    if (!p.isReady()) console.log(p.setupHelp().replace(/^/gm, "    "));
  }
  console.log("\ntelegram   (bot token in .env TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL)");
  process.exit(0);
}

const platform = arg as OAuthPlatform;
const provider = getProvider(platform);
if (!provider) {
  console.error(
    `Unknown platform: ${arg}\nUse: linkedin | facebook | threads | x | blogger | status`,
  );
  process.exit(1);
}

// Manual code
const codeArg = process.argv.find((a) => a.startsWith("--code="))?.slice(7);
const urlArg = process.argv.find((a) => a.startsWith("--url="))?.slice(6);
if (codeArg || urlArg) {
  let code = codeArg || "";
  if (urlArg) {
    try {
      code = new URL(urlArg).searchParams.get("code") || "";
    } catch {
      const m = String(urlArg).match(/[?&]code=([^&]+)/);
      code = m ? decodeURIComponent(m[1]) : "";
    }
  }
  provider
    .exchangeCode(code)
    .then((t) => {
      console.log("OK", t.platform, t.userId);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
} else {
  startUnifiedOAuthServer({
    platform,
    openBrowser: !process.argv.includes("--no-browser"),
  });
}
