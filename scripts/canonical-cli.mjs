/**
 * Canonical Content CLI
 *
 *   npm run canonical:list
 *   npm run canonical:show -- --id=abc123
 *   npm run canonical:regen -- --url="https://..."
 *   npm run canonical:regen -- --id=abc123
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

// Use compiled dist after build
const require = createRequire(import.meta.url);

async function loadDist() {
  const base = path.resolve("dist/canonical");
  return {
    listCanonical: (await import(pathToFileUrl(path.join(base, "store.js")))).listCanonical,
    loadCanonical: (await import(pathToFileUrl(path.join(base, "store.js")))).loadCanonical,
    loadCanonicalByUrl: (await import(pathToFileUrl(path.join(base, "store.js")))).loadCanonicalByUrl,
    regenerateDerived: (await import(pathToFileUrl(path.join(base, "buildCanonical.js")))).regenerateDerived,
  };
}

function pathToFileUrl(p) {
  const resolved = path.resolve(p);
  return "file:///" + resolved.replace(/\\/g, "/");
}

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : "";
}

const cmd = process.argv[2] || "list";

const { listCanonical, loadCanonical, loadCanonicalByUrl, regenerateDerived } =
  await loadDist();

if (cmd === "list") {
  const rows = listCanonical(30);
  console.log("\nCanonical Content (latest)\n");
  if (!rows.length) {
    console.log("(empty — run pipeline once)");
  }
  for (const r of rows) {
    console.log(`- ${r.id}  v${r.version}  ${r.updatedAt}`);
    console.log(`  ${r.title}`);
    console.log(`  ${r.sourceUrl}\n`);
  }
  process.exit(0);
}

if (cmd === "show") {
  const id = arg("id");
  const url = arg("url");
  const doc = id ? loadCanonical(id) : url ? loadCanonicalByUrl(url) : null;
  if (!doc) {
    console.error("Not found. Use --id= or --url=");
    process.exit(1);
  }
  console.log(JSON.stringify(doc, null, 2));
  process.exit(0);
}

if (cmd === "regen") {
  const id = arg("id");
  const url = arg("url");
  const doc = id ? loadCanonical(id) : url ? loadCanonicalByUrl(url) : null;
  if (!doc) {
    console.error("Not found. Use --id= or --url=");
    process.exit(1);
  }
  const next = regenerateDerived(doc);
  console.log(
    `Regenerated derived posts for ${next.id} v${next.version} platforms=`,
    Object.keys(next.derived || {}).filter((k) => next.derived?.[k]?.text),
  );
  process.exit(0);
}

console.error("Usage: list | show | regen");
process.exit(1);
