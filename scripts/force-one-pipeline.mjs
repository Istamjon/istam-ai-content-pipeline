/**
 * One-shot full pipeline publish (VDS force-one-post).
 * Uses keep-alive timer so Node never exits while graph.invoke is in flight.
 */
import "dotenv/config";
import { graph, graphInvokeConfig } from "../dist/agent/graph.js";
import { createEmptyState } from "../dist/agent/state.js";
import { logAllImageBudgets } from "../dist/lib/imagePipeline.js";

const keepAlive = setInterval(() => {
  console.log(`[force-one] still running ${new Date().toISOString()}`);
}, 30_000);

async function run() {
  logAllImageBudgets();
  console.log("invoke start", new Date().toISOString());
  const r = await Promise.resolve(
    graph.invoke(createEmptyState(), graphInvokeConfig),
  );
  const pub = r.publishResults || [];
  const ok = pub.filter((p) => p.status === "success").length;
  console.log("=== PUBLISH RESULTS ===");
  console.log(JSON.stringify(pub, null, 2));
  console.log("successCount", ok);
  console.log("title", r.current?.title);
  console.log("image", r.current?.imagePath);
  console.log("quality", JSON.stringify(r.quality));
  console.log("errors", r.errors);
  return ok;
}

run()
  .then((ok) => {
    clearInterval(keepAlive);
    if (ok < 1) {
      console.error("force-one: no successful publish");
      process.exit(3);
    }
    console.log("force-one: OK");
    process.exit(0);
  })
  .catch((err) => {
    clearInterval(keepAlive);
    console.error("force-one-pipeline fatal:", err);
    process.exit(1);
  });
