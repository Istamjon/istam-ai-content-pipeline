import { env } from "../config/env.js";
import { ensurePublicImageUrl, ensurePublicMediaUrl } from "../lib/imageHost.js";
import { loadTokens } from "../oauth/tokenStore.js";

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
 * Instagram Graph API requires a publicly reachable image_url / video_url.
 * Local paths are uploaded to temporary Litterbox hosting first.
 * Token: Instagram OAuth store, or Page token from Facebook Login.
 * Video → REELS container.
 */
export async function publishToInstagram(
  text: string,
  imagePath?: string,
  mediaKind: InstagramMediaKind = "image",
): Promise<{ success: boolean; error?: string }> {
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
    const hosted = video
      ? await ensurePublicMediaUrl(imagePath)
      : await ensurePublicImageUrl(imagePath);
    if (!hosted.url) {
      return {
        success: false,
        error:
          hosted.error ||
          `Failed to get temporary public ${video ? "video" : "image"} URL for Instagram`,
      };
    }

    const createBody: Record<string, string> = {
      caption: text,
      access_token: token,
    };
    if (video) {
      createBody.media_type = "REELS";
      createBody.video_url = hosted.url;
      createBody.share_to_feed = "true";
    } else {
      createBody.image_url = hosted.url;
    }

    const createResponse = await fetch(`https://graph.facebook.com/v19.0/${userId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createBody),
      signal: AbortSignal.timeout(120_000),
    });

    const createData = (await createResponse.json()) as {
      id?: string;
      error?: { message: string };
    };
    if (createData.error) {
      return { success: false, error: createData.error.message };
    }

    const mediaId = createData.id;
    if (!mediaId) {
      return { success: false, error: "No media ID returned from Instagram" };
    }

    // Container often needs a few seconds before publish
    let lastError = "Instagram media_publish failed";
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        await sleep(2000 * attempt);
      }

      const publishResponse = await fetch(
        `https://graph.facebook.com/v19.0/${userId}/media_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creation_id: mediaId,
            access_token: token,
          }),
          signal: AbortSignal.timeout(90_000),
        },
      );

      const publishData = (await publishResponse.json()) as {
        id?: string;
        error?: { message: string; code?: number };
      };

      if (!publishData.error && publishData.id) {
        return { success: true };
      }

      lastError = publishData.error?.message || lastError;
      // Retry only on "not ready" style errors
      if (!/not ready|in progress|wait/i.test(lastError)) {
        break;
      }
    }

    return { success: false, error: lastError };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
