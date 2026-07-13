import { StateAnnotation, Platform, PublishResult, GraphUpdate } from "../state.js";
import { getDailyCount, getDailyLimit } from "../../db.js";
import { env } from "../../config/env.js";
import { isPlatformReady } from "../../oauth/registry.js";

function missingCredentials(platform: Platform): string | null {
  if (platform === "telegram") {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHANNEL) {
      return "TELEGRAM_BOT_TOKEN / TELEGRAM_CHANNEL missing";
    }
    return null;
  }

  if (isPlatformReady(platform)) return null;

  const hints: Record<string, string> = {
    linkedin: "npm run auth -- linkedin",
    facebook: "npm run auth -- facebook",
    instagram: "set INSTAGRAM_* or npm run auth -- facebook",
    threads: "npm run auth -- threads",
    x: "npm run auth -- x  (or set OAuth1 keys)",
    blogger: "npm run auth -- blogger",
  };
  return `${platform} not authorized — ${hints[platform] || "configure credentials"}`;
}

export async function schedule(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    const all: Platform[] = [
      "telegram",
      "linkedin",
      "facebook",
      "instagram",
      "x",
      "threads",
      "blogger",
    ];
    const enabled = new Set(
      (env.ENABLED_PLATFORMS?.length
        ? env.ENABLED_PLATFORMS
        : ["telegram", "linkedin", "facebook", "instagram", "threads"]
      ).map((p) => p.toLowerCase()),
    );
    const platforms = all.filter((p) => enabled.has(p));
    const results: PublishResult[] = [];

    for (const platform of platforms) {
      const formatted = state.formatted[platform];
      if (!formatted?.text) {
        results.push({
          platform,
          status: "skipped",
          error: "No formatted content",
        });
        continue;
      }

      const creds = missingCredentials(platform);
      if (creds) {
        results.push({
          platform,
          status: "skipped",
          error: creds,
        });
        continue;
      }

      const count = getDailyCount(platform);
      const limit = getDailyLimit(platform);

      // limit <= 0 means unlimited (no soft daily cap)
      if (limit > 0 && count >= limit) {
        results.push({
          platform,
          status: "skipped",
          error: `Daily limit reached (${count}/${limit})`,
        });
      } else {
        results.push({
          platform,
          status: "pending",
        });
      }
    }

    const pending = results.filter((r) => r.status === "pending").map((r) => r.platform);
    const skipped = results.filter((r) => r.status === "skipped").length;
    console.log(
      `[schedule] pending=[${pending.join(", ") || "none"}] skipped=${skipped}`,
    );

    return { publishResults: results };
  } catch (error) {
    return {
      errors: [`schedule error: ${String(error)}`],
    };
  }
}
