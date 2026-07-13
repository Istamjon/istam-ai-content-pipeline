import { env } from "../config/env.js";
import { ensurePublicImageUrl } from "../lib/imageHost.js";
import { threadsProvider } from "../oauth/providers/threads.js";

/**
 * Threads Graph API: create container → publish.
 * Image posts need a public URL; local files go through temporary Litterbox hosting.
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

    const publishResponse = await fetch(
      `https://graph.threads.net/v1.0/${userId}/threads_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: createData.id,
          access_token: token,
        }),
      },
    );

    const publishData = (await publishResponse.json()) as {
      id?: string;
      error?: { message: string };
    };

    if (!publishResponse.ok || publishData.error) {
      return {
        success: false,
        error: publishData.error?.message || `Threads publish failed: ${publishResponse.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
