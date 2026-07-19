/**
 * Local Skywork-only image smoke (skips Nano Banana waterfall).
 *
 *   node scripts/smoke-skywork-image.mjs
 *   node scripts/smoke-skywork-image.mjs --title="My topic" --hint="context"
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = (rel) => pathToFileURL(path.join(root, rel)).href;

function arg(name, fallback = "") {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const title =
  arg("title") ||
  process.env.TEST_TITLE ||
  "LangGraph multi-agent orchestration for production RAG";
const hint =
  arg("hint") ||
  process.env.TEST_HINT ||
  "state machine, tool calling, retrieval layers, guardrails, production reliability";
const presetForce = arg("preset") || process.env.IMAGE_PRESET || "";
const compositionForce =
  arg("composition") || process.env.IMAGE_COMPOSITION || "";

const { skyworkImage, isSkyworkConfigured, canUseSkyworkToday, logSkyworkBudget } =
  await import(dist("dist/lib/skyworkImage.js"));
const { buildPremiumImagePrompt } = await import(
  dist("dist/config/imagePrompt.js")
);
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
  console.error("FAIL: Skywork soft daily budget exhausted", budget);
  process.exit(1);
}

const faceRef = isBrandFaceConfigured();
const face = await loadBrandFace();
const opts = { faceRef };
if (presetForce) opts.preset = presetForce;
if (compositionForce) opts.composition = compositionForce;
const { prompt, preset, composition, heading, pose } = buildPremiumImagePrompt(
  title,
  hint,
  opts,
);

console.log("=== Skywork local smoke ===");
console.log("title:", title);
console.log("hint:", hint.slice(0, 120));
console.log("preset:", preset);
console.log("composition:", composition);
console.log("pose:", pose);
console.log("heading:", heading);
console.log("faceRef:", faceRef, face ? `bytes=${face.buffer.length}` : "(missing)");
console.log("promptLen:", prompt.length);
console.log("--- prompt lead ---");
console.log(prompt.slice(0, 420));
console.log("---");

if (!face) {
  console.warn(
    "WARN: no face.jpg — Skywork will text-to-image only (no identity edit API)",
  );
}

const t0 = Date.now();
const buf = await skyworkImage(prompt, { face });
const ms = Date.now() - t0;

const outDir = path.join(root, "data", "images");
fs.mkdirSync(outDir, { recursive: true });
const stamp = Date.now();
const imgPath = path.join(outDir, `skywork-local-${stamp}.png`);
const promptPath = path.join(outDir, `skywork-local-${stamp}.prompt.txt`);

fs.writeFileSync(imgPath, buf);
fs.writeFileSync(
  promptPath,
  [
    `title: ${title}`,
    `hint: ${hint}`,
    `preset: ${preset}`,
    `composition: ${composition}`,
    `pose: ${pose}`,
    `heading: ${heading}`,
    `faceRef: ${faceRef}`,
    `faceBytes: ${face?.buffer.length ?? 0}`,
    `promptLen: ${prompt.length}`,
    `bytes: ${buf.length}`,
    `ms: ${ms}`,
    "",
    prompt,
  ].join("\n"),
  "utf8",
);

console.log("OK provider=skywork" + (face ? " faceRef=yes(edit)" : " faceRef=no"));
console.log("image:", imgPath);
console.log("prompt:", promptPath);
console.log("bytes:", buf.length, "ms:", ms);
logSkyworkBudget();
