/**
 * One-shot full pipeline publish (VDS force-one-post).
 * No top-level await — keeps event loop alive via promise chain.
 */
import "dotenv/config";
import { graph, graphInvokeConfig } from "../dist/agent/graph.js";
import { createEmptyState } from "../dist/agent/state.js";
import { logAllImageBudgets } from "../dist/lib/imagePipeline.js";

function main() {
  logAllImageBudgets();
  console.log("invoke start", new Date().toISOString());
  return graph.invoke(createEmptyState(), graphInvokeConfig).then((r) => {
    const pub = r.publishResults || [];
    const ok = pub.filter((p) => p.status === "success").length;
    console.log("=== PUBLISH RESULTS ===");
    console.log(JSON.stringify(pub, null, 2));
    console.log("successCount", ok);
    console.log("title", r.current?.title);
    console.log("image", r.current?.imagePath);
    console.log("quality", JSON.stringify(r.quality));
    console.log("errors", r.errors);
    if (ok < 1) {
      process.exitCode = 3;
      return;
    }
    process.exitCode = 0;
  });
}

main().catch((err) => {
  console.error("force-one-pipeline fatal:", err);
  process.exitCode = 1;
});
