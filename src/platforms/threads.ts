import { env } from "../config/env.js";
import { ensurePublicImageUrl, ensurePublicMediaUrl } from "../lib/imageHost.js";
import { threadsProvider } from "../oauth/providers/threads.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ThreadsMediaKind = "image" | "video";

function isVideoPath(p?: string, kind?: ThreadsMediaKind): boolean {
  if (kind === "video") return true;
  if (kind === "image") return false;
  return Boolean(p && /\.(mp4|mov|webm|mkv)$/i.test(p));
}

async function createAndPublishPart(opts: {
  userId: string;
  token: string;
  text: string;
  mediaType: string;
  imageUrl?: string;
  videoUrl?: string;
  replyToId?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const createBody: Record<string, string> = {
    media_type: opts.mediaType,
    text: opts.text,
    access_token: opts.token,
  };
  if (opts.imageUrl) createBody.image_url = opts.imageUrl;
  if (opts.videoUrl) createBody.video_url = opts.videoUrl;
  // Thread reply: attach to previous published post
  if (opts.replyToId) createBody.reply_to_id = opts.replyToId;

  const createResponse = await fetch(
    `https://graph.threads.net/v1.0/${opts.userId}/threads`,
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

  let lastError = "Threads media_publish failed";
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(attempt === 0 ? 2500 : 2000 * attempt);

    const publishResponse = await fetch(
      `https://graph.threads.net/v1.0/${opts.userId}/threads_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: createData.id,
          access_token: opts.token,
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );

    const publishData = (await publishResponse.json()) as {
      id?: string;
      error?: { message: string; code?: number };
    };

    if (!publishData.error && publishData.id) {
      return { success: true, id: publishData.id };
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
}

/**
 * Threads Graph API: single post or multi-part thread (reply chain).
 * Image/video only on the root post. Continuations use reply_to_id.
 * @see https://developers.facebook.com/docs/threads/posts
 * @see https://developers.facebook.com/docs/threads/retrieve-and-manage-replies/create-replies
 */
export async function publishToThreads(
  text: string,
  imagePath?: string,
  mediaKind: ThreadsMediaKind = "image",
  parts?: string[],
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

    const chain =
      parts && parts.length > 0
        ? parts.map((p) => p.trim()).filter(Boolean)
        : [text.trim()].filter(Boolean);

    if (chain.length === 0) {
      return { success: false, error: "Threads: empty text" };
    }

    // Enforce 500 per part (API hard)
    const safe = chain.map((p) =>
      p.length > 500 ? p.slice(0, 499).replace(/\s+\S*$/, "") + "…" : p,
    );

    const video = isVideoPath(imagePath, mediaKind);
    let publicMediaUrl: string | undefined;
    if (imagePath) {
      const hosted = video
        ? await ensurePublicMediaUrl(imagePath)
        : await ensurePublicImageUrl(imagePath);
      if (hosted.url) {
        publicMediaUrl = hosted.url;
      } else {
        console.warn(
          "[threads] Media host failed, posting text only:",
          hosted.error,
        );
      }
    }

    console.log(
      `[threads] chain parts=${safe.length} rootLen=${safe[0].length} media=${publicMediaUrl ? (video ? "video" : "image") : "none"}`,
    );

    // Root post
    const root = await createAndPublishPart({
      userId,
      token,
      text: safe[0],
      mediaType: publicMediaUrl ? (video ? "VIDEO" : "IMAGE") : "TEXT",
      imageUrl:
        publicMediaUrl && !video ? publicMediaUrl : undefined,
      videoUrl: publicMediaUrl && video ? publicMediaUrl : undefined,
    });

    if (!root.success || !root.id) {
      return { success: false, error: root.error || "Threads root failed" };
    }
    console.log(`[threads] chain 1/${safe.length} OK id=${root.id}`);

    let replyTo = root.id;
    for (let i = 1; i < safe.length; i++) {
      const part = await createAndPublishPart({
        userId,
        token,
        text: safe[i],
        mediaType: "TEXT",
        replyToId: replyTo,
      });
      if (!part.success || !part.id) {
        // Partial success: root already live — report soft fail with context
        console.warn(
          `[threads] chain ${i + 1}/${safe.length} failed: ${part.error}`,
        );
        return {
          success: true,
          error: `partial thread: published ${i}/${safe.length} — ${part.error}`,
        };
      }
      console.log(`[threads] chain ${i + 1}/${safe.length} OK`);
      replyTo = part.id;
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
