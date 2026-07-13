import fs from "fs";
import path from "path";
import { env } from "../config/env.js";
import { buildOAuth1Header, OAuth1Credentials } from "../lib/oauth1.js";

type XResult = { success: boolean; error?: string };

function getOAuth1Creds(): OAuth1Credentials | null {
  const {
    X_API_KEY,
    X_API_SECRET,
    X_ACCESS_TOKEN,
    X_ACCESS_TOKEN_SECRET,
  } = env;

  if (X_API_KEY && X_API_SECRET && X_ACCESS_TOKEN && X_ACCESS_TOKEN_SECRET) {
    return {
      consumerKey: X_API_KEY,
      consumerSecret: X_API_SECRET,
      accessToken: X_ACCESS_TOKEN,
      accessTokenSecret: X_ACCESS_TOKEN_SECRET,
    };
  }
  return null;
}

/**
 * Publish to X (Twitter).
 * Prefer OAuth 1.0a user context (tweet.write + media).
 * Bearer token alone is usually app-only and cannot create tweets.
 */
export async function publishToX(
  text: string,
  imagePath?: string,
): Promise<XResult> {
  try {
    const oauth1 = getOAuth1Creds();

    if (oauth1) {
      return publishWithOAuth1(text, imagePath, oauth1);
    }

    // Last resort: Bearer (often fails for POST /2/tweets)
    if (env.X_BEARER_TOKEN) {
      if (imagePath) {
        console.warn(
          "[x] Bearer token cannot upload media; posting text only. Set X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_TOKEN_SECRET for media.",
        );
      }
      return publishWithBearer(text);
    }

    return {
      success: false,
      error:
        "X credentials required: set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET (OAuth 1.0a) or X_BEARER_TOKEN",
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function publishWithOAuth1(
  text: string,
  imagePath: string | undefined,
  creds: OAuth1Credentials,
): Promise<XResult> {
  let mediaId: string | undefined;

  if (imagePath && fs.existsSync(imagePath) && !/^https?:\/\//i.test(imagePath)) {
    const media = await uploadMediaOAuth1(imagePath, creds);
    if (media.mediaId) {
      mediaId = media.mediaId;
    } else {
      console.warn("[x] Media upload failed, posting text only:", media.error);
    }
  }

  const url = "https://api.twitter.com/2/tweets";
  const body: Record<string, unknown> = { text };
  if (mediaId) {
    body.media = { media_ids: [mediaId] };
  }

  const auth = buildOAuth1Header("POST", url, creds);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `X API ${response.status}: ${err}` };
  }

  return { success: true };
}

/**
 * Simple media upload (≤5MB images) via v1.1 endpoint.
 * @see https://developer.x.com/en/docs/twitter-api/v1/media/upload-media/api-reference/post-media-upload
 */
async function uploadMediaOAuth1(
  imagePath: string,
  creds: OAuth1Credentials,
): Promise<{ mediaId?: string; error?: string }> {
  try {
    const uploadUrl = "https://upload.twitter.com/1.1/media/upload.json";
    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("media", fs.createReadStream(imagePath), {
      filename: path.basename(imagePath),
      contentType: contentTypeFor(imagePath),
    });

    // OAuth signature for multipart must NOT include body fields
    const auth = buildOAuth1Header("POST", uploadUrl, creds);
    const headers = {
      ...form.getHeaders(),
      Authorization: auth,
    } as HeadersInit;

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers,
      body: form as unknown as BodyInit,
      signal: AbortSignal.timeout(120_000),
    });

    const raw = await response.text();
    if (!response.ok) {
      return { error: `X media upload ${response.status}: ${raw.slice(0, 300)}` };
    }

    let data: { media_id_string?: string; media_id?: number };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return { error: "X media upload returned invalid JSON" };
    }

    const mediaId =
      data.media_id_string ||
      (data.media_id !== undefined ? String(data.media_id) : undefined);

    if (!mediaId) {
      return { error: "X media upload returned no media_id" };
    }

    return { mediaId };
  } catch (error) {
    return { error: String(error) };
  }
}

async function publishWithBearer(text: string): Promise<XResult> {
  const response = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.X_BEARER_TOKEN}`,
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const err = await response.text();
    return {
      success: false,
      error: `X API ${response.status}: ${err}. Tip: use OAuth 1.0a user tokens for posting.`,
    };
  }

  return { success: true };
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}
