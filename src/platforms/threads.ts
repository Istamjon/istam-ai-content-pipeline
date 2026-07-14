import { env } from "../config/env.js";
import { ensurePublicImageUrl } from "../lib/imageHost.js";
import { threadsProvider } from "../oauth/providers/threads.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Threads Graph API: create container → publish.
 * Image posts need a public URL; local files go through temporary Litterbox hosting.
 * Containers are often not immediately publishable — retry like Instagram.
 * @see https://developers.facebook.com/docs/threads/posts
 */
export async function publishToThreads(
  text: string,
  imagePath?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const oauth = threadsProvider.getCredentials();
    const token = oauth?.accessToken || env.THREADS_TOKEN;
    const userId = oauth?.userId || env.THREADS_USER_ID;
    if (!token || !userId) {
      return {
        success: false,
        error: "Threads not authorized. Run: npm run auth -- threads",
      };
    }

    let publicImageUrl: string | undefined;
    if (imagePath) {
      const hosted = await ensurePublicImageUrl(imagePath);
      if (hosted.url) {
        publicImageUrl = hosted.url;
      } else {
        // Text-only fallback if temp host fails
        console.warn("[threads] Image host failed, posting text only:", hosted.error);
      }
    }

    const createBody: Record<string, string> = {
      media_type: publicImageUrl ? "IMAGE" : "TEXT",
      text,
      access_token: token,
    };
    if (publicImageUrl) {
      createBody.image_url = publicImageUrl;
    }

    const createResponse = await fetch(
      `https://graph.threads.net/v1.0/${userId}/threads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createBody),
        signal: AbortSignal.timeout(60_000),
      },
    );

    const createData = (await createResponse.json()) as {
      id?: string;
      error?: { message: string };
    };

    if (!createResponse.ok || createData.error || !createData.id) {
      const msg =
        createData.error?.message ||
        `Threads create failed: ${createResponse.status}`;
      return { success: false, error: msg };
    }

    // Container may need a few seconds (TEXT and IMAGE); code 24 = media not found yet
    let lastError = "Threads media_publish failed";
    for (let attempt = 0; attempt < 6; attempt++) {
      await sleep(attempt === 0 ? 2500 : 2000 * attempt);

      const publishResponse = await fetch(
        `https://graph.threads.net/v1.0/${userId}/threads_publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creation_id: createData.id,
            access_token: token,
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );

      const publishData = (await publishResponse.json()) as {
        id?: string;
        error?: { message: string; code?: number; error_subcode?: number };
      };

      if (!publishData.error && publishData.id) {
        return { success: true };
      }

      lastError = publishData.error?.message || lastError;
      const retryable =
        publishData.error?.code === 24 ||
        /not ready|in progress|wait|not found|does not exist|медиафайл/i.test(
          lastError,
        );
      if (!retryable) break;
      console.warn(
        `[threads] publish attempt ${attempt + 1} not ready: ${lastError.slice(0, 120)}`,
      );
    }

    return { success: false, error: lastError };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
