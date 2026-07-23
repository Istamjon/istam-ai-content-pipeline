/**
 * One-shot full pipeline publish (VDS force-one-post).
 * Must run with cwd=/app and dist built; env from compose .env.
 */
import "dotenv/config";
import { graph, graphInvokeConfig } from "../dist/agent/graph.js";
import { createEmptyState } from "../dist/agent/state.js";
import { logAllImageBudgets } from "../dist/lib/imagePipeline.js";

logAllImageBudgets();
console.log("invoke start", new Date().toISOString());
const r = await graph.invoke(createEmptyState(), graphInvokeConfig);
const pub = r.publishResults || [];
const ok = pub.filter((p) => p.status === "success").length;
console.log("=== PUBLISH RESULTS ===");
console.log(JSON.stringify(pub, null, 2));
console.log("successCount", ok);
console.log("title", r.current?.title);
console.log("image", r.current?.imagePath);
console.log("quality", JSON.stringify(r.quality));
console.log("errors", r.errors);
if (ok < 1) process.exit(3);
