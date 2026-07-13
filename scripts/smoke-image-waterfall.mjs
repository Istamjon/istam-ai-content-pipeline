/**
 * Smoke-test image waterfall: Cloudflare → AI Horde
 *
 *   node scripts/smoke-image-waterfall.mjs
 *   node scripts/smoke-image-waterfall.mjs --force-fallback
 *   node scripts/smoke-image-waterfall.mjs --only=horde
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = (rel) => pathToFileURL(path.join(root, rel)).href;

const { env } = await import(dist("dist/config/env.js"));
const { logAllImageBudgets, generateImageBuffer } = await import(
  dist("dist/lib/imagePipeline.js")
);
const { isHordeConfigured, canUseHordeToday, hordeImage } = await import(
  dist("dist/lib/hordeImage.js")
);
const {
  isCloudflareImageConfigured,
  canGenerateImageToday,
} = await import(dist("dist/lib/cloudflareImage.js"));

const forceFallback = process.argv.includes("--force-fallback");
const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const prompt =
  process.argv
    .find((a) => a.startsWith("--prompt="))
    ?.slice("--prompt=".length) ||
  "close up photo of a rabbit, soft studio light, professional";

console.log("=== Image waterfall smoke ===");
console.log("CF:", isCloudflareImageConfigured(), canGenerateImageToday());
console.log(
  "HORDE:",
  isHordeConfigured(),
  env.AIHORDE_API_KEY ? env.AIHORDE_API_KEY.slice(0, 8) + "…" : "(empty)",
  canUseHordeToday(),
);
logAllImageBudgets();

const outDir = path.join(root, "data/images");
fs.mkdirSync(outDir, { recursive: true });

function save(provider, buffer) {
  const ext = provider === "horde" ? "webp" : "jpg";
  const file = path.join(outDir, `smoke-${provider}-${Date.now()}.${ext}`);
  fs.writeFileSync(file, buffer);
  console.log(`saved ${file} (${buffer.length} bytes)`);
  return file;
}

try {
  if (only === "horde") {
    console.log("--- direct horde ---");
    save("horde", await hordeImage(prompt));
  } else if (forceFallback) {
    console.log("--- force fallback (skip CF → horde) ---");
    if (isHordeConfigured() && canUseHordeToday().ok) {
      save("horde", await hordeImage(prompt));
    } else {
      throw new Error("Horde unavailable");
    }
  } else {
    console.log("--- full waterfall generateImageBuffer ---");
    const r = await generateImageBuffer(prompt);
    console.log("provider=", r.provider);
    save(r.provider, r.buffer);
  }
  console.log("OK");
} catch (e) {
  console.error("FAIL:", e);
  process.exit(1);
}
