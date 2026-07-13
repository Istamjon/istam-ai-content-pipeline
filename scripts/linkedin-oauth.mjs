/**
 * Thin wrapper — prefer TypeScript OAuth Manager:
 *   npm run linkedin:auth
 *
 * This file remains for compatibility; it delegates to dist after build.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "dist/oauth/runLinkedInAuth.js");

const build = spawnSync("npx", ["tsc"], { cwd: root, stdio: "inherit", shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const run = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});
process.exit(run.status ?? 0);
