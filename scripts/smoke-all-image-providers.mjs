/**
 * Test Cloudflare + AI Horde and save samples.
 *   node scripts/smoke-all-image-providers.mjs
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = (rel) => pathToFileURL(path.join(root, rel)).href;

const { env } = await import(dist("dist/config/env.js"));
const {
  cloudflareImage,
  logImageBudget,
  getCloudflareAccounts,
} = await import(dist("dist/lib/cloudflareImage.js"));
const { hordeImage, canUseHordeToday } = await import(
  dist("dist/lib/hordeImage.js")
);

const prompt =
  process.argv
    .find((a) => a.startsWith("--prompt="))
    ?.slice("--prompt=".length) ||
  "professional teal abstract neural network, AI engineering theme, clean modern, no text, no watermark";

const outDir = path.join(root, "data/images/provider-test");
fs.mkdirSync(outDir, { recursive: true });

function save(name, buffer, ext = "jpg") {
  const file = path.join(outDir, `${name}-${Date.now()}.${ext}`);
  fs.writeFileSync(file, buffer);
  console.log(`  saved ${file} (${buffer.length} bytes)`);
  return file;
}

const results = [];

async function run(name, fn) {
  console.log(`\n========== ${name} ==========`);
  const t0 = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms, file: out.file, bytes: out.bytes });
    console.log(`  OK ${ms}ms`);
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, ms, error: msg.slice(0, 300) });
    console.log(`  FAIL ${ms}ms: ${msg.slice(0, 250)}`);
  }
}

console.log("=== IMAGE PROVIDERS SMOKE (CF + Horde) ===");
console.log("prompt:", prompt);
console.log(
  "CF accounts:",
  getCloudflareAccounts()
    .map((a) => a.label)
    .join(", ") || "(none)",
);
logImageBudget();
console.log("horde budget:", canUseHordeToday());
console.log("AIHORDE key set?", Boolean(env.AIHORDE_API_KEY));

await run("1_cloudflare", async () => {
  const buf = await cloudflareImage(prompt);
  const file = save("cloudflare", buf, "jpg");
  return { file, bytes: buf.length };
});

await run("2_horde", async () => {
  const buf = await hordeImage(prompt);
  const file = save("horde", buf, "webp");
  return { file, bytes: buf.length };
});

console.log("\n========== SUMMARY ==========");
for (const r of results) {
  if (r.ok) {
    console.log(`✅ ${r.name}  ${r.ms}ms  ${r.bytes}B  ${r.file}`);
  } else {
    console.log(`❌ ${r.name}  ${r.ms}ms  ${r.error}`);
  }
}
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} providers OK`);
console.log("files:", outDir);
process.exit(ok > 0 ? 0 : 1);
