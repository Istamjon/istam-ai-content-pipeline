/**
 * Backward-compatible entry — delegates to unified OAuth CLI.
 * Prefer: npm run auth -- linkedin
 */
import "dotenv/config";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "runAuth.js");
const r = spawnSync(process.execPath, [entry, "linkedin", ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(r.status ?? 0);
