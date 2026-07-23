/**
 * One-shot brand face check (VDS force-one-post).
 * Run inside container: node /app/scripts/force-face-check.mjs
 * (scripts dir mounted or copied)
 */
import { loadBrandFace, logBrandFace } from "../dist/lib/brandFace.js";

logBrandFace();
const f = await loadBrandFace();
if (!f) {
  console.error("NO FACE");
  process.exit(2);
}
console.log("OK face bytes", f.buffer.length);
