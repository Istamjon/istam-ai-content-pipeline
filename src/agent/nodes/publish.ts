import { StateAnnotation, PublishResult, GraphUpdate } from "../state.js";
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

export async function publish(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  const localImagePath = state.current?.imagePath;

  try {
    const current = state.current;
    if (!current) {
      return { errors: ["publish: no current article"] };
    }

    // C + B hard gates: never publish bad or imageless content
    if (!state.quality?.ok) {
      const err =
        "publish blocked: quality not OK — " +
        (state.quality?.issues?.slice(0, 3).join("; ") || "failed");
      console.warn(`[publish] ${err}`);
      freeLocalImages(localImagePath);
      return {
        publishResults: skipAll(state.publishResults, err),
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
      return {
        publishResults: skipAll(state.publishResults, err),
        errors: [err],
        current: { ...current, imagePath: undefined },
      };
    }

    // Refresh Meta / LinkedIn tokens before any publish attempt
    if (!env.DRY_RUN) {
      try {
        await refreshAllExpiringTokens();
      } catch (e) {
        console.warn("[publish] token refresh warning:", e);
      }
    }

    // Copy results; do not mutate state in place
    const results: PublishResult[] = state.publishResults.map((r) => ({ ...r }));
    const dryRun = env.DRY_RUN;
    let anySuccess = false;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status !== "pending") continue;

      const formatted = state.formatted[result.platform];
      if (!formatted?.text) {
        results[i] = { ...result, status: "skipped", error: "No formatted content" };
        continue;
      }

      if (dryRun) {
        console.log(
          `[publish] DRY_RUN ✓ ${result.platform} (quality+image OK, not sent)`,
        );
        // Do not burn real daily platform limits or analytics during dry runs
        results[i] = { ...result, status: "success" };
        anySuccess = true;
        continue;
      }

      let postId = 0;
      try {
        postId = insertPost(
          current.url,
          result.platform,
          formatted.text,
          current.imagePath,
          "pending",
        );
      } catch {
        results[i] = { ...result, status: "failed", error: "DB insert failed" };
        continue;
      }

      console.log(
        `[publish] → ${result.platform} text=${formatted.text.length}` +
          (formatted.parts ? ` parts=${formatted.parts.length}` : "") +
          (formatted.caption ? ` caption=${formatted.caption.length}` : "") +
          "...",
      );
      const publishResult = await publishToPlatform(
        result.platform,
        formatted.text,
        current.imagePath,
        "image",
        {
          parts: formatted.parts,
          caption: formatted.caption,
        },
      );

      if (publishResult.success) {
        updatePostStatus(postId, "published");
        incrementDailyCount(result.platform);
        insertAnalytics(postId, result.platform);
        results[i] = { ...result, status: "success" };
        anySuccess = true;
        console.log(`[publish] ✓ ${result.platform}`);
      } else {
        updatePostStatus(postId, "failed", publishResult.error);
        results[i] = { ...result, status: "failed", error: publishResult.error };
        console.warn(`[publish] ✗ ${result.platform}: ${publishResult.error}`);
      }
    }

    // Only mark seen when something actually succeeded (or dry-run preview).
    // Pure failures stay unseen so the next cron slot can retry after outages.
    if (anySuccess || dryRun) {
      try {
        markArticleSeen(
          current.url,
          current.title,
          dryRun ? "dry-run" : "pipeline",
          contentHash(current.rewritten || current.rawText),
        );
      } catch {
        // Non-fatal: article may already be marked
      }
    }

    // Drop local temp file(s) after all platforms finished.
    // IG/Threads already uploaded to Litterbox/Catbox; TG/LI/FB read file before this.
    freeLocalImages(localImagePath);

    return {
      publishResults: results,
      // Clear path in state so later steps do not reference a deleted file
      current: { ...current, imagePath: undefined },
    };
  } catch (error) {
    // Still free disk on unexpected errors after partial publish
    freeLocalImages(localImagePath);
    return {
      errors: [`publish error: ${String(error)}`],
    };
  }
}
