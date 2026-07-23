/**
 * One-shot brand face check (VDS force-one-post).
 */
import { loadBrandFace, logBrandFace } from "../dist/lib/brandFace.js";

function main() {
  logBrandFace();
  return loadBrandFace().then((f) => {
    if (!f) {
      console.error("NO FACE");
      process.exitCode = 2;
      return;
    }
    console.log("OK face bytes", f.buffer.length);
    process.exitCode = 0;
  });
}

main().catch((err) => {
  console.error("force-face-check fatal:", err);
  process.exitCode = 1;
});
