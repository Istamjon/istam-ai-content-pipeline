/**
 * Smoke-test image waterfall: Nano Banana → Skywork
 *
 *   node scripts/smoke-image-waterfall.mjs
 *   node scripts/smoke-image-waterfall.mjs --prompt="..."
 *
 * NOTE: Cloudflare Workers AI, AI Horde, and Pollinations image have been
 * removed from the waterfall. Only Nano Banana and Skywork are active.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = (rel) => pathToFileURL(path.join(root, rel)).href;

const { logAllImageBudgets, generateImageBuffer } = await import(
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
  "close up photo of a rabbit, soft studio light, professional";

console.log("=== Image waterfall smoke (Nano Banana → Skywork) ===");
console.log("Nano:", isNanoBananaConfigured(), canUseNanoBananaToday());
console.log("Skywork:", isSkyworkConfigured(), canUseSkyworkToday());
logAllImageBudgets();

const outDir = path.join(root, "data/images");
fs.mkdirSync(outDir, { recursive: true });

function save(provider, buffer) {
  const file = path.join(outDir, `smoke-${provider}-${Date.now()}.png`);
  fs.writeFileSync(file, buffer);
  console.log(`saved ${file} (${buffer.length} bytes)`);
  return file;
}

try {
  console.log("--- full waterfall generateImageBuffer (Nano → Skywork) ---");
  const r = await generateImageBuffer(prompt);
  console.log("provider=", r.provider);
  save(r.provider, r.buffer);
  console.log("OK");
} catch (e) {
  console.error("FAIL:", e);
  process.exit(1);
}
