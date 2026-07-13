/**
 * Resolve Cloudflare Account IDs for all configured tokens and print rotation status.
 *   node scripts/cf-resolve-accounts.mjs
 */
import "dotenv/config";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = (rel) => pathToFileURL(path.join(root, rel)).href;

const { ensureCloudflareAccounts, getCloudflareAccountsSync } = await import(
  dist("dist/lib/cloudflareAccounts.js")
);
const { logImageBudget } = await import(dist("dist/lib/cloudflareImage.js"));

console.log("=== Cloudflare multi-account resolve ===\n");
const slots = await ensureCloudflareAccounts();
console.log("\nActive slots:");
for (const s of slots) {
  console.log(
    `  ${s.label}  account=…${s.accountId.slice(-8)}  token=…${s.token.slice(-8)}  ${s.name || ""}`,
  );
}
console.log("\nBudget:");
logImageBudget();
console.log("\nSync count:", getCloudflareAccountsSync().length);
if (slots.length < 2) {
  console.log(`
To enable full rotation (2–3 free neuron pools):
1. Open each Cloudflare account: https://dash.cloudflare.com
2. Copy Account ID (right sidebar)
3. Set in .env:
   CLOUDFLARE_ACCOUNT_ID_2=<id for token 2>
   CLOUDFLARE_ACCOUNT_ID_3=<id for token 3>
OR recreate tokens with permission: Account → Account Settings → Read
   then re-run: node scripts/cf-resolve-accounts.mjs
`);
}
process.exit(slots.length > 0 ? 0 : 1);
