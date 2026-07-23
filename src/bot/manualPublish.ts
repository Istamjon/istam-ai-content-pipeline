/**
 * Manual multi-platform publish (Telegram bot inbound).
 * User-supplied text + optional photo/video → ENABLED_PLATFORMS.
 */
import fs from "fs";
import { createHash } from "crypto";
import type { Platform } from "../agent/state.js";
import { platformLimits } from "../config/brand.js";
import { env } from "../config/env.js";
import {
  getDailyCount,
  getDailyLimit,
  insertPost,
  updatePostStatus,
  incrementDailyCount,
  insertAnalytics,
} from "../db.js";
import { isPlatformReady } from "../oauth/registry.js";
import { refreshAllExpiringTokens } from "../oauth/tokenRefresh.js";
import { deleteLocalImage } from "../lib/imageHost.js";
import { publishToPlatform, type MediaKind } from "../platforms/index.js";
import { notifyPublishReport } from "../lib/publishReport.js";

export type ManualMediaKind = "image" | "video" | "none";

export type ManualPublishInput = {
  text: string;
  mediaPath?: string;
  mediaKind: ManualMediaKind;
  /** Optional source label for DB (default telegram-bot). */
  source?: string;
};

export type ManualPlatformResult = {
  platform: Platform;
  status: "success" | "failed" | "skipped";
  error?: string;
};

export type ManualPublishResult = {
  results: ManualPlatformResult[];
  successCount: number;
  failCount: number;
  skipCount: number;
};

const ALL_PLATFORMS: Platform[] = [
  "telegram",
  "linkedin",
  "facebook",
  "instagram",
  "x",
  "threads",
  "blogger",
];

function smartTruncate(text: string, limit: number): string {
  const t = text.trim();
  if (t.length <= limit) return t;
  if (limit < 24) return t.slice(0, Math.max(0, limit - 1)) + "…";

  const window = t.slice(0, limit - 1);
  const minKeep = Math.floor(limit * 0.45);
  const space = window.lastIndexOf(" ");
  if (space >= minKeep) {
    return window.slice(0, space).trimEnd() + "…";
  }
  return window.trimEnd() + "…";
}

/** Escape for Telegram HTML parse_mode when we still use HTML footers elsewhere. */
export function escapeHtmlPlain(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Format user text for a platform (length limits only — no AI rewrite).
 * Telegram channel uses HTML; escape user body so <script> etc. is safe.
 */
export function formatManualText(text: string, platform: Platform): string {
  const raw = text.trim();
  const limit = platformLimits[platform] ?? 2000;
  // Leave small margin for platform quirks
  const body =
    platform === "telegram"
      ? escapeHtmlPlain(raw)
      : raw;

  // Short platforms: aggressive truncate
  if (platform === "x" || platform === "threads") {
    return smartTruncate(body, Math.min(limit, platform === "x" ? 280 : 500));
  }

  return smartTruncate(body, limit);
}

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
    instagram: "set INSTAGRAM_* or npm run auth:facebook",
    threads: "npm run auth -- threads",
    x: "OAuth1 keys or npm run auth -- x",
    blogger: "npm run auth -- blogger",
  };
  return `${platform} not authorized — ${hints[platform] || "configure"}`;
}

function enabledPlatforms(): Platform[] {
  const enabled = new Set(
    (env.ENABLED_PLATFORMS?.length
      ? env.ENABLED_PLATFORMS
      : ["telegram", "linkedin", "facebook", "instagram", "threads"]
    ).map((p) => p.toLowerCase()),
  );
  return ALL_PLATFORMS.filter((p) => enabled.has(p));
}

/**
 * Publish manual post to all enabled platforms.
 * Does not run quality/image pipeline gates (user supplies content).
 */
export async function publishManualPost(
  input: ManualPublishInput,
): Promise<ManualPublishResult> {
  const text = (input.text || "").trim();
  if (!text) {
    return {
      results: [],
      successCount: 0,
      failCount: 0,
      skipCount: 0,
      // caller should reject empty text
    };
  }

  const mediaKind: MediaKind =
    input.mediaKind === "video"
      ? "video"
      : input.mediaKind === "image"
        ? "image"
        : "none";

  const mediaPath =
    mediaKind !== "none" &&
    input.mediaPath &&
    fs.existsSync(input.mediaPath)
      ? input.mediaPath
      : undefined;

  if (!env.DRY_RUN) {
    try {
      await refreshAllExpiringTokens();
    } catch (e) {
      console.warn("[manualPublish] token refresh warning:", e);
    }
  }

  const platforms = enabledPlatforms();
  const results: ManualPlatformResult[] = [];
  const sourceUrl = `manual://${input.source || "telegram-bot"}/${createHash("sha256")
    .update(text + (mediaPath || ""))
    .digest("hex")
    .slice(0, 16)}`;

  for (const platform of platforms) {
    const formatted = formatManualText(text, platform);
    if (!formatted) {
      results.push({
        platform,
        status: "skipped",
        error: "Empty text after format",
      });
      continue;
    }

    const creds = missingCredentials(platform);
    if (creds) {
      results.push({ platform, status: "skipped", error: creds });
      continue;
    }

    if (platform === "instagram" && !mediaPath) {
      results.push({
        platform,
        status: "skipped",
        error: "Instagram requires image or video",
      });
      continue;
    }

    // Video: LinkedIn has no video API wired — skip, publish elsewhere only
    if (platform === "linkedin" && mediaKind === "video") {
      results.push({
        platform,
        status: "skipped",
        error: "Video LinkedIn da qo‘llab-quvvatlanmaydi — skip",
      });
      console.log("[manualPublish] ⏭ linkedin skipped (video)");
      continue;
    }

    const count = getDailyCount(platform);
    const limit = getDailyLimit(platform);
    if (limit > 0 && count >= limit) {
      results.push({
        platform,
        status: "skipped",
        error: `Daily limit reached (${count}/${limit})`,
      });
      continue;
    }

    if (env.DRY_RUN) {
      console.log(
        `[manualPublish] DRY_RUN ✓ ${platform} len=${formatted.length} media=${mediaKind}`,
      );
      results.push({ platform, status: "success" });
      continue;
    }

    let postId = 0;
    try {
      postId = insertPost(
        sourceUrl,
        platform,
        formatted,
        mediaPath,
        "pending",
      );
    } catch {
      results.push({ platform, status: "failed", error: "DB insert failed" });
      continue;
    }

    console.log(`[manualPublish] → ${platform} (${mediaKind})...`);
    const pub = await publishToPlatform(
      platform,
      formatted,
      mediaPath,
      mediaKind,
    );

    if (pub.success) {
      updatePostStatus(postId, "published");
      incrementDailyCount(platform);
      insertAnalytics(postId, platform);
      results.push({ platform, status: "success" });
      console.log(`[manualPublish] ✓ ${platform}`);
    } else {
      updatePostStatus(postId, "failed", pub.error);
      results.push({
        platform,
        status: "failed",
        error: pub.error,
      });
      console.warn(`[manualPublish] ✗ ${platform}: ${pub.error}`);
    }
  }

  // Free local media after all platforms done
  if (mediaPath) {
    deleteLocalImage(mediaPath);
  }

  const successCount = results.filter((r) => r.status === "success").length;
  const failCount = results.filter((r) => r.status === "failed").length;
  const skipCount = results.filter((r) => r.status === "skipped").length;

  // Same report as pipeline → admins get full platform matrix
  try {
    await notifyPublishReport({
      title: (input.text || "").slice(0, 80) || "Manual bot post",
      results: results.map((r) => ({
        platform: r.platform,
        status: r.status,
        error: r.error,
      })),
    });
  } catch (e) {
    console.warn("[manualPublish] report notify failed:", e);
  }

  return { results, successCount, failCount, skipCount };
}

export function formatResultsMessage(r: ManualPublishResult): string {
  if (r.results.length === 0) {
    return "Hech qanday platforma tanlanmagan (ENABLED_PLATFORMS).";
  }
  const lines = r.results.map((row) => {
    const icon =
      row.status === "success" ? "✅" : row.status === "skipped" ? "⏭" : "❌";
    const extra = row.error ? ` — ${row.error}` : "";
    return `${icon} <b>${row.platform}</b>: ${row.status}${extra}`;
  });
  return [
    `<b>Natija</b>: ${r.successCount} OK · ${r.failCount} xato · ${r.skipCount} skip`,
    "",
    ...lines,
  ].join("\n");
}
