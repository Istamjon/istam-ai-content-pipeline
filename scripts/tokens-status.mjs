/**
 * Token expiry status + optional refresh.
 *   npm run tokens:status
 *   npm run tokens:refresh
 */
import "dotenv/config";
import path from "path";
import { pathToFileURL } from "url";

const refresh = process.argv.includes("--refresh");
const base = path.resolve("dist/oauth/tokenRefresh.js");
const mod = await import(pathToFileURL(base).href);

if (refresh) {
  await mod.refreshAllExpiringTokens();
}

const rows = mod.tokenStatusReport();
console.log("\n=== OAuth token status ===\n");
for (const r of rows) {
  const days =
    r.daysLeft === null ? "unknown" : r.daysLeft < 0 ? "EXPIRED" : `${r.daysLeft}d left`;
  const flag = !r.hasToken ? "❌ none" : r.expiring ? "⚠️  expiring" : "✅ ok";
  console.log(`${r.platform.padEnd(12)} ${flag.padEnd(14)} ${days}`);
}
console.log("");
