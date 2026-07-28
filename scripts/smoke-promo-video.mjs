/**
 * One-shot promo still (9:16) with brand face via Skywork Image API (cheap).
 * Video animation is done separately (Skywork Open API has no video endpoint).
 *
 *   node scripts/smoke-promo-video.mjs
 *
 * Budget: uses 1 Skywork image credit on one key. Soft daily image limit still applies.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = (rel) => pathToFileURL(path.join(root, rel)).href;

// Force vertical Reels / Stories frame for this smoke only
process.env.SKYWORK_ASPECT_RATIO = "9:16";
process.env.SKYWORK_RESOLUTION = process.env.SKYWORK_RESOLUTION || "1K";

const { skyworkImage, isSkyworkConfigured, canUseSkyworkToday, logSkyworkBudget } =
  await import(dist("dist/lib/skyworkImage.js"));
const { loadBrandFace, isBrandFaceConfigured, logBrandFace } = await import(
  dist("dist/lib/brandFace.js")
);

if (!isSkyworkConfigured()) {
  console.error("FAIL: set SKYWORK_API_KEY in .env");
  process.exit(1);
}

logSkyworkBudget();
logBrandFace();

const budget = canUseSkyworkToday();
if (!budget.ok) {
  console.error("FAIL: Skywork soft daily image budget exhausted", budget);
  process.exit(1);
}

const face = await loadBrandFace();
if (!face || !isBrandFaceConfigured()) {
  console.error("FAIL: data/brand/face.jpg required for identity promo");
  process.exit(1);
}

const prompt = [
  "Premium vertical 9:16 personal-brand promo still for AI Engineering creator Istam Obidov.",
  "Keep the SAME real person identity from the reference face photo — natural skin, same facial structure, no beauty filter, no different person.",
  "Confident half-body portrait, slight natural smile, looking at camera, modern dark tech studio background with soft teal (#00C2A8) accent light and subtle circuit/glow particles.",
  "Clean space on the lower third for text; elegant thin sans-serif overlay text exactly: ISTAM OBIDOV",
  "Small secondary line: AI Agents · LangGraph · Automation",
  "Cinematic, sharp, professional LinkedIn/Reels cover quality, no watermark, no extra logos, no random faces.",
].join(" ");

console.log("=== Promo still smoke (Skywork image, 9:16, face) ===");
console.log("aspect=9:16 resolution=", process.env.SKYWORK_RESOLUTION);
console.log("face bytes=", face.buffer.length);
console.log("promptLen=", prompt.length);

const buffer = await skyworkImage(prompt, {
  face: {
    mimeType: face.mimeType || "image/jpeg",
    base64: face.base64,
    path: face.path,
  },
});

const outDir = path.join(root, "data", "videos");
fs.mkdirSync(outDir, { recursive: true });
const stamp = Date.now();
const stillPath = path.join(outDir, `promo-still-9x16-${stamp}.png`);
fs.writeFileSync(stillPath, buffer);
fs.writeFileSync(
  path.join(outDir, `promo-still-9x16-${stamp}.prompt.txt`),
  prompt,
  "utf8",
);

console.log("OK still:", stillPath, "bytes=", buffer.length);
console.log(
  "Next: animate this still with cheapest image-to-video (6s, 480p) — Skywork Open API has no /video endpoint.",
);
console.log("STILL_PATH=" + stillPath);
