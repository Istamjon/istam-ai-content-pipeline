import "dotenv/config";
import { startScheduler } from "./scheduler.js";
import { env } from "./config/env.js";
import { createEmptyState } from "./agent/state.js";
import { getPollinationsUsage } from "./lib/pollinations.js";
import { logAllImageBudgets } from "./lib/imagePipeline.js";
import {
  initCloudflareAccounts,
  isCloudflareImageConfigured,
  getCloudflareAccounts,
} from "./lib/cloudflareImage.js";

async function logAiConfig(): Promise<void> {
  await initCloudflareAccounts();
  const usage = getPollinationsUsage();
  const textKeyOk = Boolean(env.POLLINATIONS_API_KEY);
  const cfSlots = getCloudflareAccounts();
  const cfOk = isCloudflareImageConfigured() && cfSlots.length > 0;
  const geminiOk = Boolean(env.GEMINI_API_KEY);
  console.log(
    `[AI] TEXT=${usage.textProvider} model=${usage.textModel} ` +
      `gemini=${geminiOk ? "set" : "off"} pollinations=${textKeyOk ? "set" : "MISSING"} ` +
      `poll_daily=${usage.used}/${usage.limit}`,
  );
  console.log(
    `[AI] IMAGE waterfall: Nano Banana → Cloudflare (${cfSlots.length} acct) → AI Horde`,
  );
  console.log(
    `[AI] CF model=${env.CLOUDFLARE_IMAGE_MODEL} quality=${env.IMAGE_QUALITY} ` +
      `${env.IMAGE_WIDTH}x${env.IMAGE_HEIGHT} steps=${env.CLOUDFLARE_IMAGE_STEPS} ` +
      `accounts=${cfSlots.map((s) => s.label).join(",") || "none"} creds=${cfOk ? "set" : "MISSING"}`,
  );
  logAllImageBudgets();
  if (env.CRON_RANDOM) {
    console.log(
      `[AI] Schedule: RANDOM ${env.CRON_SLOTS_PER_DAY}/day ` +
        `window=${env.CRON_WINDOW_START_HOUR}:00–${env.CRON_WINDOW_END_HOUR}:00 ` +
        `gap≥${env.CRON_MIN_GAP_MINUTES}m maxArticles/run=${env.MAX_ARTICLES_PER_RUN}`,
    );
  } else {
    console.log(
      `[AI] Schedule: fixed times=${env.CRON_TIMES.join(",") || "interval"} ` +
        `maxArticles/run=${env.MAX_ARTICLES_PER_RUN}`,
    );
  }
  if (!textKeyOk) {
    console.warn(
      "[AI] Set POLLINATIONS_API_KEY (text only) — https://enter.pollinations.ai",
    );
  }
}

void logAiConfig();

if (env.DRY_RUN) {
  console.log("[Main] DRY_RUN=true, running single pipeline manually...");
  void (async () => {
    try {
      const { graph, graphInvokeConfig } = await import("./agent/graph.js");
      const result = await graph.invoke(createEmptyState(), graphInvokeConfig);

      // Focused quality review dump (DRY_RUN)
      console.log("\n========== PIPELINE RESULT (DRY_RUN) ==========");
      console.log("Articles in batch:", result.newArticles?.length ?? 0);
      console.log("Article index:", result.articleIndex);
      console.log("Quality:", JSON.stringify(result.quality, null, 2));
      console.log("Publish plan:", JSON.stringify(result.publishResults, null, 2));
      console.log("Errors:", result.errors);

      if (result.current) {
        console.log("\n--- TITLE ---\n", result.current.title);
        console.log("\n--- URL ---\n", result.current.url);
        console.log("\n--- ANALYZE SUMMARY ---\n", result.current.summary);
        console.log(
          "\n--- REWRITTEN POST (Istam Obidov voice) ---\n",
          result.current.rewritten,
        );
        console.log("\n--- IMAGE PROMPT ---\n", result.current.imagePrompt);
        console.log("\n--- IMAGE PATH ---\n", result.current.imagePath);
      }

      if (result.formatted) {
        console.log("\n--- FORMATTED PREVIEWS ---");
        for (const [platform, post] of Object.entries(result.formatted)) {
          if (!post) {
            console.log(`\n[${platform}] skipped`);
            continue;
          }
          const preview = post.text.length > 400 ? post.text.slice(0, 400) + "…" : post.text;
          console.log(`\n[${platform}] hasImage=${post.hasImage} len=${post.text.length}\n${preview}`);
        }
      }

      console.log("\n[AI] Usage after run:", getPollinationsUsage());
    } catch (error) {
      console.error("Pipeline failed:", error);
      process.exit(1);
    }
  })();
} else {
  startScheduler();
}
