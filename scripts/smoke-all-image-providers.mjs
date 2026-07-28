/**
 * Smoke test: Nano Banana + Skywork image pipeline.
 *   node scripts/smoke-all-image-providers.mjs
 *
 * NOTE: Cloudflare Workers AI and AI Horde have been removed from the image
 * waterfall. This script now tests only the active providers: Nano Banana and Skywork.
 * For full waterfall smoke, use smoke-skywork-image.mjs or smoke-image-waterfall.mjs.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = (rel) => pathToFileURL(path.join(root, rel)).href;

const { generateImageBuffer, logAllImageBudgets } = await import(
  dist("dist/lib/imagePipeline.js")
);
const { isNanoBananaConfigured, canUseNanoBananaToday } = await import(
  dist("dist/lib/nanoBananaImage.js")
);
const { isSkyworkConfigured, canUseSkyworkToday } = await import(
  dist("dist/lib/skyworkImage.js")
);

const prompt =
  process.argv
    .find((a) => a.startsWith("--prompt="))
    ?.slice("--prompt=".length) ||
  "professional teal abstract neural network, AI engineering theme, clean modern, no text, no watermark";

const outDir = path.join(root, "data/images/provider-test");
fs.mkdirSync(outDir, { recursive: true });

function save(name, buffer, ext = "png") {
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

console.log("=== IMAGE PROVIDERS SMOKE (Nano Banana + Skywork) ===");
console.log("prompt:", prompt);
console.log("nano configured:", isNanoBananaConfigured(), canUseNanoBananaToday());
console.log("skywork configured:", isSkyworkConfigured(), canUseSkyworkToday());
logAllImageBudgets();

await run("1_pipeline_waterfall", async () => {
  const { buffer, provider } = await generateImageBuffer(prompt);
  const file = save(provider, buffer, "png");
  console.log(`  provider used: ${provider}`);
  return { file, bytes: buffer.length };
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
