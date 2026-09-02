import "dotenv/config";
import dns from "dns";
import { Agent, setGlobalDispatcher } from "undici";
import { startScheduler } from "./scheduler.js";
import { startTelegramBot } from "./bot/telegramBot.js";
import { env } from "./config/env.js";
import { createEmptyState } from "./agent/state.js";
import { getGeminiTextUsage, logGeminiTextBudget } from "./lib/geminiText.js";
import { logAllImageBudgets } from "./lib/imagePipeline.js";
import { releaseTransientFetchSkips } from "./db.js";

// Many VDS hosts have broken/partial IPv6 — Node would otherwise prefer AAAA and
// fail with opaque "fetch failed" to api.telegram.org and other APIs.
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  /* Node < 17 */
}
// Force dual-stack off at the HTTP client layer (stronger than dns order alone)
try {
  setGlobalDispatcher(
    new Agent({
      connect: { family: 4, timeout: 20_000 },
      connections: 32,
      keepAliveTimeout: 10_000,
    }),
  );
} catch (e) {
  console.warn("[net] undici IPv4 Agent not applied:", e);
}

async function logAiConfig(): Promise<void> {
  // One-shot: re-open articles burned by old fetch-error permanent skip
  try {
    const n = releaseTransientFetchSkips();
    if (n > 0) {
      console.log(
        `[db] Released ${n} transient fetch/empty skips so they can be retried`,
      );
    }
  } catch (e) {
    console.warn("[db] releaseTransientFetchSkips failed:", e);
  }
  const usage = getGeminiTextUsage();
  console.log(
    `[AI] TEXT=Gemini model=${usage.model} keys=${usage.keys} ` +
      `daily=${usage.used}/${usage.limit || "∞"} remaining=${usage.remaining}`,
  );
  console.log(
    `[AI] IMAGE waterfall: Nano Banana → Skywork` +
      ` | skywork=${
        [
          env.SKYWORK_API_KEY,
          env.SKYWORK_API_KEY_2,
          env.SKYWORK_API_KEY_3,
          env.SKYWORK_API_KEY_4,
          env.SKYWORK_API_KEY_5,
        ].filter((k) => k?.trim()).length || "off"
      } key(s)`,
  );
  logAllImageBudgets();
  if (env.CRON_RANDOM) {
    const lo = Math.min(env.CRON_SLOTS_MIN, env.CRON_SLOTS_MAX);
    const hi = Math.max(env.CRON_SLOTS_MIN, env.CRON_SLOTS_MAX);
    console.log(
      `[AI] Schedule: RANDOM ${lo}–${hi} slots/day (picked each local day) ` +
        `window=${env.CRON_WINDOW_START_HOUR}:00–${env.CRON_WINDOW_END_HOUR}:00 ` +
        `gap≥${env.CRON_MIN_GAP_MINUTES}m maxArticles/run=${env.MAX_ARTICLES_PER_RUN}`,
    );
  } else {
    console.log(
      `[AI] Schedule: fixed times=${env.CRON_TIMES.join(",") || "interval"} ` +
        `maxArticles/run=${env.MAX_ARTICLES_PER_RUN}`,
    );
  }
  console.log(
    `[AI] DRY_RUN=${env.DRY_RUN} CRON_RUN_ON_START=${env.CRON_RUN_ON_START} ` +
      `platforms=${env.ENABLED_PLATFORMS.join(",")} ` +
      `tg_bot=${env.TELEGRAM_BOT_INBOUND ? "on" : "off"} ` +
      `tg_admins=${env.TELEGRAM_ADMIN_IDS.length}`,
  );
  logGeminiTextBudget();
}

void logAiConfig();

if (env.DRY_RUN) {
  console.log("[Main] DRY_RUN=true, running single pipeline manually...");
  // Still allow inbound bot for dry-run multi-platform previews
  startTelegramBot();
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

      console.log("\n[AI] Usage after run:", getGeminiTextUsage());
    } catch (error) {
      console.error("Pipeline failed:", error);
      process.exit(1);
    }
  })();
} else {
  startScheduler();
  startTelegramBot();
}
