import { StateAnnotation, PublishResult, GraphUpdate, Platform } from "../state.js";
import { publishToPlatform } from "../../platforms/index.js";
import {
  insertPost,
  updatePostStatus,
  incrementDailyCount,
  insertAnalytics,
  markArticleSeen,
} from "../../db.js";
import { env } from "../../config/env.js";
import {
  deleteLocalImage,
  purgePipelineImagesAfterPublish,
} from "../../lib/imageHost.js";
import { refreshAllExpiringTokens } from "../../oauth/tokenRefresh.js";
import { notifyPublishReport } from "../../lib/publishReport.js";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const imagesDir = path.resolve(__dirname, "../../../data/images");

/** Free disk: drop local cover after platforms finished (or on hard fail). */
function freeLocalImages(localImagePath?: string): void {
  try {
    const { deletedCurrent, purged } = purgePipelineImagesAfterPublish(
      imagesDir,
      localImagePath,
    );
    if (deletedCurrent || purged > 0) {
      console.log(
        `[publish] freed local images: current=${deletedCurrent} purged=${purged} dir=${imagesDir}`,
      );
    }
  } catch (e) {
    console.warn("[publish] image cleanup failed:", e);
    if (localImagePath) deleteLocalImage(localImagePath);
  }
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

function skipAll(
  results: PublishResult[],
  error: string,
): PublishResult[] {
  return results.map((r) =>
    r.status === "pending" ? { ...r, status: "skipped" as const, error } : r,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Platforms that benefit from a second attempt after Meta/CDN glitches. */
function isRetriablePlatformFail(platform: Platform, err?: string): boolean {
  if (platform === "instagram" || platform === "threads" || platform === "facebook") {
    return true;
  }
  return /unknown error|timeout|rate limit|temporar|try again|not ready|ECONNRESET|fetch failed|5\d\d/i.test(
    err || "",
  );
}

/**
 * Publish to one pending platform slot. Mutates results[i].
 */
async function publishOne(
  results: PublishResult[],
  i: number,
  opts: {
    url: string;
    title: string;
    imagePath: string;
    text: string;
    parts?: string[];
    caption?: string;
    dryRun: boolean;
  },
): Promise<boolean> {
  const result = results[i];
  if (result.status !== "pending" && result.status !== "failed") {
    return result.status === "success";
  }

  // Reset failed → pending for retry pass
  if (result.status === "failed") {
    results[i] = { ...result, status: "pending", error: undefined };
  }

  const platform = results[i].platform;

  if (opts.dryRun) {
    console.log(
      `[publish] DRY_RUN ✓ ${platform} (quality+image OK, not sent)`,
    );
    results[i] = { ...results[i], status: "success" };
    return true;
  }

  let postId = 0;
  try {
    postId = insertPost(
      opts.url,
      platform,
      opts.text,
      opts.imagePath,
      "pending",
    );
  } catch {
    results[i] = {
      ...results[i],
      status: "failed",
      error: "DB insert failed",
    };
    return false;
  }

  console.log(
    `[publish] → ${platform} text=${opts.text.length}` +
      (opts.parts ? ` parts=${opts.parts.length}` : "") +
      (opts.caption ? ` caption=${opts.caption.length}` : "") +
      "...",
  );

  const publishResult = await publishToPlatform(
    platform,
    opts.text,
    opts.imagePath,
    "image",
    {
      parts: opts.parts,
      caption: opts.caption,
    },
  );

  if (publishResult.success) {
    updatePostStatus(postId, "published");
    incrementDailyCount(platform);
    insertAnalytics(postId, platform);
    results[i] = {
      ...results[i],
      status: "success",
      error: publishResult.error, // partial thread notes etc.
    };
    console.log(`[publish] ✓ ${platform}`);
    return true;
  }

  updatePostStatus(postId, "failed", publishResult.error);
  results[i] = {
    ...results[i],
    status: "failed",
    error: publishResult.error,
  };
  console.warn(`[publish] ✗ ${platform}: ${publishResult.error}`);
  return false;
}

export async function publish(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  const localImagePath = state.current?.imagePath;

  try {
    const current = state.current;
    if (!current) {
      return { errors: ["publish: no current article"] };
    }

    if (!state.quality?.ok) {
      const err =
        "publish blocked: quality not OK — " +
        (state.quality?.issues?.slice(0, 3).join("; ") || "failed");
      console.warn(`[publish] ${err}`);
      freeLocalImages(localImagePath);
      const blocked = skipAll(state.publishResults, err);
      await notifyPublishReport({
        title: current.title,
        url: current.url,
        results: blocked,
      }).catch(() => undefined);
      return {
        publishResults: blocked,
        errors: [err],
        current: { ...current, imagePath: undefined },
      };
    }

    const hasImage =
      Boolean(localImagePath) &&
      (localImagePath!.startsWith("http") || fs.existsSync(localImagePath!));
    if (!hasImage) {
      const err = "publish blocked: image required (no imagePath / file missing)";
      console.warn(`[publish] ${err}`);
      freeLocalImages(localImagePath);
      const blocked = skipAll(state.publishResults, err);
      await notifyPublishReport({
        title: current.title,
        url: current.url,
        results: blocked,
      }).catch(() => undefined);
      return {
        publishResults: blocked,
        errors: [err],
        current: { ...current, imagePath: undefined },
      };
    }

    if (!env.DRY_RUN) {
      try {
        await refreshAllExpiringTokens();
      } catch (e) {
        console.warn("[publish] token refresh warning:", e);
      }
    }

    const results: PublishResult[] = state.publishResults.map((r) => ({
      ...r,
    }));
    const dryRun = env.DRY_RUN;
    let anySuccess = false;

    // Prefer non-Meta file upload platforms first, then IG/Threads (need public URL)
    const order = (p: Platform): number => {
      const rank: Record<string, number> = {
        telegram: 0,
        linkedin: 1,
        facebook: 2,
        blogger: 3,
        x: 4,
        instagram: 5,
        threads: 6,
      };
      return rank[p] ?? 9;
    };
    const indices = results
      .map((r, i) => i)
      .filter((i) => results[i].status === "pending")
      .sort((a, b) => order(results[a].platform) - order(results[b].platform));

    for (const i of indices) {
      const formatted = state.formatted[results[i].platform];
      if (!formatted?.text) {
        results[i] = {
          ...results[i],
          status: "skipped",
          error: "No formatted content",
        };
        continue;
      }

      const ok = await publishOne(results, i, {
        url: current.url,
        title: current.title,
        imagePath: localImagePath!,
        text: formatted.text,
        parts: formatted.parts,
        caption: formatted.caption,
        dryRun,
      });
      if (ok) anySuccess = true;
    }

    // Second pass: retry failed Meta / transient errors (image still on disk)
    if (!dryRun) {
      const retryIdx = results
        .map((r, i) => i)
        .filter(
          (i) =>
            results[i].status === "failed" &&
            isRetriablePlatformFail(
              results[i].platform,
              results[i].error,
            ),
        );
      if (retryIdx.length > 0) {
        console.warn(
          `[publish] retry pass for: ${retryIdx.map((i) => results[i].platform).join(", ")}`,
        );
        await sleep(4000);
        for (const i of retryIdx) {
          const formatted = state.formatted[results[i].platform];
          if (!formatted?.text) continue;
          // mark pending again inside publishOne
          results[i] = {
            ...results[i],
            status: "failed",
            error: results[i].error,
          };
          const ok = await publishOne(results, i, {
            url: current.url,
            title: current.title,
            imagePath: localImagePath!,
            text: formatted.text,
            parts: formatted.parts,
            caption: formatted.caption,
            dryRun: false,
          });
          if (ok) anySuccess = true;
        }
      }
    }

    if (anySuccess || dryRun) {
      try {
        markArticleSeen(
          current.url,
          current.title,
          dryRun ? "dry-run" : "pipeline",
          contentHash(current.rewritten || current.rawText),
        );
      } catch {
        // ignore
      }
    }

    freeLocalImages(localImagePath);

    // Bot → admin: which platforms published
    await notifyPublishReport({
      title: current.title,
      url: current.url,
      results,
      dryRun,
    }).catch((e) =>
      console.warn("[publish] report notify failed:", e),
    );

    return {
      publishResults: results,
      current: { ...current, imagePath: undefined },
    };
  } catch (error) {
    freeLocalImages(localImagePath);
    return {
      errors: [`publish error: ${String(error)}`],
    };
  }
}
