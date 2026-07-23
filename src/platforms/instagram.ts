import fs from "fs";
import path from "path";
import os from "os";
import { env } from "../config/env.js";
import {
  ensurePublicImageUrl,
  ensurePublicMediaUrl,
} from "../lib/imageHost.js";
import { loadTokens } from "../oauth/tokenStore.js";

const GRAPH = "https://graph.facebook.com/v19.0";

/** Meta crawlers often fail on litter.*; prefer stable hosts for IG. */
const IG_HOST_PREFER = ["catbox", "litterbox", "0x0", "imgbb"] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type InstagramMediaKind = "image" | "video";

function isVideoPath(p?: string, kind?: InstagramMediaKind): boolean {
  if (kind === "video") return true;
  if (kind === "image") return false;
  return Boolean(p && /\.(mp4|mov|webm|mkv)$/i.test(p));
}

/**
 * Meta docs: JPEG is the only officially supported still-image format.
 * Optional sharp conversion when the package is present (Docker/linux).
 */
async function ensureJpegForInstagram(imagePath: string): Promise<{
  path: string;
  cleanup?: () => void;
}> {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return { path: imagePath };
  }
  if (/^https?:\/\//i.test(imagePath) || !fs.existsSync(imagePath)) {
    return { path: imagePath };
  }

  try {
    const sharpMod = await import("sharp").catch(() => null);
    if (!sharpMod?.default) return { path: imagePath };

    const out = path.join(
      os.tmpdir(),
      `ig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`,
    );
    await sharpMod
      .default(imagePath)
      .rotate()
      .flatten({ background: { r: 10, g: 10, b: 12 } })
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(out);
    console.log(
      `[instagram] converted ${path.basename(imagePath)} → JPEG ${path.basename(out)}`,
    );
    return {
      path: out,
      cleanup: () => {
        try {
          if (fs.existsSync(out)) fs.unlinkSync(out);
        } catch {
          /* ignore */
        }
      },
    };
  } catch (e) {
    console.warn(
      `[instagram] JPEG convert skipped: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { path: imagePath };
  }
}

type ContainerStatus = {
  status_code?: string;
  status?: string;
  error?: { message: string };
};

/**
 * Poll IG container until FINISHED (or ERROR/EXPIRED).
 * Fixes "Media ID is not available" when publish runs too early.
 */
async function waitForContainerReady(
  containerId: string,
  token: string,
  opts?: { maxAttempts?: number; video?: boolean },
): Promise<{ ok: boolean; status: string; error?: string }> {
  const max = opts?.maxAttempts ?? (opts?.video ? 30 : 18);
  let last = "UNKNOWN";

  for (let i = 0; i < max; i++) {
    if (i > 0) {
      await sleep(opts?.video ? 3000 : 2000);
    }
    try {
      const url =
        `${GRAPH}/${containerId}?fields=status_code,status` +
        `&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const data = (await res.json()) as ContainerStatus;
      if (data.error?.message) {
        return { ok: false, status: "ERROR", error: data.error.message };
      }
      last = (data.status_code || data.status || "UNKNOWN").toUpperCase();
      console.log(
        `[instagram] container ${containerId} status=${last} attempt=${i + 1}/${max}`,
      );

      if (last === "FINISHED" || last === "PUBLISHED") {
        return { ok: true, status: last };
      }
      if (last === "ERROR" || last === "EXPIRED") {
        return {
          ok: false,
          status: last,
          error: data.status || `Container ${last}`,
        };
      }
    } catch (e) {
      console.warn(
        `[instagram] status poll failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return {
    ok: false,
    status: last,
    error: `Container not ready after poll (last=${last})`,
  };
}

function isRetriablePublishError(msg: string): boolean {
  return /not ready|in progress|wait|media id is not available|try again|temporarily|processing|not available|unknown error|unexpected|please retry|service unavailable|timeout|rate limit|OAuthException/i.test(
    msg,
  );
}

function isHostFetchError(msg: string): boolean {
  return /download|fetch|unable to|could not|invalid image|unsupported|format|image_url|media url|cannot load|url|unknown error/i.test(
    msg,
  );
}

async function createMediaContainer(
  userId: string,
  token: string,
  publicUrl: string,
  caption: string,
  video: boolean,
): Promise<{ id?: string; error?: string }> {
  const body = new URLSearchParams();
  body.set("access_token", token);
  body.set("caption", caption.slice(0, 2200));
  if (video) {
    body.set("media_type", "REELS");
    body.set("video_url", publicUrl);
    body.set("share_to_feed", "true");
  } else {
    body.set("image_url", publicUrl);
  }

  const createResponse = await fetch(`${GRAPH}/${userId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(120_000),
  });

  const createData = (await createResponse.json()) as {
    id?: string;
    error?: { message: string };
  };
  if (createData.error) {
    return { error: createData.error.message };
  }
  if (!createData.id) {
    return { error: "No media ID returned from Instagram container create" };
  }
  return { id: createData.id };
}

async function publishContainer(
  userId: string,
  token: string,
  containerId: string,
): Promise<{ id?: string; error?: string }> {
  const body = new URLSearchParams();
  body.set("creation_id", containerId);
  body.set("access_token", token);

  const publishResponse = await fetch(`${GRAPH}/${userId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(90_000),
  });

  const publishData = (await publishResponse.json()) as {
    id?: string;
    error?: { message: string };
  };

  if (!publishData.error && publishData.id) {
    return { id: publishData.id };
  }
  return {
    error: publishData.error?.message || "Instagram media_publish failed",
  };
}

/**
 * Instagram Graph API: public image_url/video_url → container → wait FINISHED → publish.
 * Retries "Media ID is not available" and re-hosts when Meta cannot fetch the URL.
 */
export async function publishToInstagram(
  text: string,
  imagePath?: string,
  mediaKind: InstagramMediaKind = "image",
): Promise<{ success: boolean; error?: string }> {
  let jpegCleanup: (() => void) | undefined;
  try {
    const ig = loadTokens("instagram");
    const fb = loadTokens("facebook");
    const token =
      ig?.accessToken ||
      env.INSTAGRAM_TOKEN ||
      fb?.accessToken ||
      env.FACEBOOK_PAGE_TOKEN ||
      "";
    const userId = ig?.userId || env.INSTAGRAM_USER_ID || "";
    if (!token || !userId) {
      return {
        success: false,
        error:
          "Instagram not authorized. Run: npm run auth:facebook (links IG Business to Page)",
      };
    }

    if (!imagePath) {
      return { success: false, error: "Instagram requires an image or video" };
    }

    const video = isVideoPath(imagePath, mediaKind);
    let mediaLocal = imagePath;

    if (!video) {
      const jpeg = await ensureJpegForInstagram(imagePath);
      mediaLocal = jpeg.path;
      jpegCleanup = jpeg.cleanup;
    }

    const triedHosts: string[] = [];
    let lastError = "Instagram publish failed";

    // Up to 3 different public hosts (Meta often returns "unknown error" on one CDN)
    for (let hostRound = 0; hostRound < 3; hostRound++) {
      const hosted = video
        ? await ensurePublicMediaUrl(mediaLocal)
        : await ensurePublicImageUrl(mediaLocal, {
            prefer: [...IG_HOST_PREFER],
            skipHosts: triedHosts,
          });

      if (!hosted.url) {
        lastError =
          hosted.error ||
          `Failed to get temporary public ${video ? "video" : "image"} URL for Instagram`;
        break;
      }
      if (hosted.host) triedHosts.push(hosted.host);

      console.log(
        `[instagram] create container userId=${userId} host=${hosted.host || "?"} ` +
          `url=${hosted.url.slice(0, 72)}… video=${video} round=${hostRound + 1}`,
      );

      const created = await createMediaContainer(
        userId,
        token,
        hosted.url,
        text,
        video,
      );

      if (created.error || !created.id) {
        lastError = created.error || "No media ID returned from Instagram";
        console.warn(`[instagram] container create failed: ${lastError.slice(0, 160)}`);
        if (isHostFetchError(lastError) && !video) {
          continue; // try next host
        }
        return { success: false, error: lastError };
      }

      const mediaId = created.id;
      console.log(`[instagram] container id=${mediaId} — waiting FINISHED…`);

      const ready = await waitForContainerReady(mediaId, token, { video });
      if (!ready.ok) {
        console.warn(
          `[instagram] status wait ended status=${ready.status} err=${ready.error || "n/a"} — publish attempts continue`,
        );
        if (
          (ready.status === "ERROR" || ready.status === "EXPIRED") &&
          isHostFetchError(ready.error || "") &&
          !video
        ) {
          lastError = ready.error || ready.status;
          continue;
        }
      }

      for (let attempt = 0; attempt < 8; attempt++) {
        if (attempt > 0) {
          await sleep(Math.min(12_000, 1500 * attempt));
          const st = await waitForContainerReady(mediaId, token, {
            maxAttempts: 3,
            video,
          });
          if (st.status === "ERROR" || st.status === "EXPIRED") {
            lastError = st.error || `Container ${st.status}`;
            break;
          }
        }

        const pub = await publishContainer(userId, token, mediaId);
        if (pub.id) {
          console.log(`[instagram] published media id=${pub.id}`);
          return { success: true };
        }

        lastError = pub.error || lastError;
        console.warn(
          `[instagram] media_publish attempt ${attempt + 1}/8: ${lastError.slice(0, 160)}`,
        );

        if (!isRetriablePublishError(lastError)) {
          break;
        }
      }

      // If publish failed with host-related / media-id / unknown Meta errors, try next host
      if (
        !video &&
        hostRound < 2 &&
        (isHostFetchError(lastError) || isRetriablePublishError(lastError))
      ) {
        console.warn(`[instagram] retrying with alternate public host…`);
        await sleep(2000 * (hostRound + 1));
        continue;
      }
      break;
    }

    return { success: false, error: lastError };
  } catch (error) {
    return { success: false, error: String(error) };
  } finally {
    jpegCleanup?.();
  }
}
