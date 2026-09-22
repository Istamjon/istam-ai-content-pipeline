/**
 * Telegram channel publishing.
 *
 * Preferred layout: ONE rich message — the entire article plus the cover image
 * embedded as a block inside it (`sendRichMessage`, Bot API 10.1+, June 2026).
 *
 * Fallback layout: image/video post with a caption (first ≤1024 chars), then the
 * remainder as continuation message(s) (≤4096 each). Used when there is no image
 * to embed, when the rich path is switched off, or whenever Telegram rejects the
 * rich message.
 *
 * There is no external long-form page (Telegra.ph was removed): in the fallback
 * the caption is a strict prefix of the full text, so the continuation is a
 * plain slice with nothing repeated and nothing lost.
 *
 * Limits, all verified live against the channel:
 *   - rich message: 32768 chars  (40000 → RICH_MESSAGE_TEXT_TOO_LONG)
 *   - sendMessage:  4096  chars
 *   - sendPhoto caption: 1024 chars — UNCHANGED by the rich-message release.
 *     This is why the old layout had to spill into follow-up messages, and why
 *     "one message" is only possible through the rich path.
 */
import { env } from "../config/env.js";
import fs from "fs";
import path from "path";
import { truncateHtmlPrefix } from "../config/platformTextLimits.js";

type TgResult = { success: boolean; error?: string };

/** Telegram media caption hard limit. */
const CAPTION_HARD = 1024;

/** Telegram per-message limit for the legacy sendMessage path. */
const MESSAGE_HARD = 4096;

/**
 * Media id linking the uploaded file to its place in the markup. Telegram
 * requires the `id` in `media[]` and the `tg://photo?id=` reference to agree, and
 * restricts it to 1-64 chars of A-Za-z0-9_-.
 */
const RICH_MEDIA_ID = "cover";

/** Filename used for the multipart part, referenced as `attach://<name>`. */
const RICH_MEDIA_FILENAME = "cover.png";

function mimeForImage(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

async function parseTelegramResponse(response: Response): Promise<{
  ok: boolean;
  description?: string;
  raw: string;
}> {
  const raw = await response.text();
  if (!raw.trim()) {
    return {
      ok: false,
      description: `Empty response (HTTP ${response.status})`,
      raw,
    };
  }
  try {
    const data = JSON.parse(raw) as { ok?: boolean; description?: string };
    return {
      ok: data.ok === true,
      description: data.description,
      raw,
    };
  } catch {
    return {
      ok: false,
      description: `Invalid JSON (HTTP ${response.status}): ${raw.slice(0, 200)}`,
      raw,
    };
  }
}

/** Send text, split into ≤4096-char messages (Telegram's per-message limit). */
async function sendMessage(
  token: string,
  chatId: string,
  text: string,
  preview = false,
): Promise<TgResult> {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, MESSAGE_HARD));
    remaining = remaining.slice(MESSAGE_HARD);
  }
  if (chunks.length === 0) return { success: true };

  for (const chunk of chunks) {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: "HTML",
          disable_web_page_preview: !preview,
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    const data = await parseTelegramResponse(response);
    if (!data.ok) {
      return {
        success: false,
        error: data.description || "Telegram sendMessage failed",
      };
    }
  }
  return { success: true };
}

/**
 * Send ONE rich message: the full article, with the cover image embedded as a
 * block when one is available.
 *
 * The image is uploaded as a multipart part and referenced from the markup as
 * `tg://photo?id=<RICH_MEDIA_ID>`; both halves must use the same id. Without an
 * image the payload is plain JSON — there is nothing to upload.
 *
 * Returns success:false on ANY rejection (unknown method, unsupported tag,
 * over-long text, missing permission) so the caller can fall back to the caption
 * layout. The rich API is new enough that a clean fallback matters far more than
 * a precise failure reason, so the reason is returned but never thrown.
 */
async function sendRichMessage(
  token: string,
  chatId: string,
  html: string,
  imagePath?: string,
): Promise<TgResult> {
  const hasImage = Boolean(imagePath && fs.existsSync(imagePath));

  const richMessage: {
    html: string;
    media?: Array<{ id: string; media: { type: string; media: string } }>;
  } = {
    html: hasImage
      ? `<img src="tg://photo?id=${RICH_MEDIA_ID}"/>${html}`
      : html,
  };

  let body: FormData | string;
  const headers: Record<string, string> = {};

  if (hasImage) {
    richMessage.media = [
      {
        id: RICH_MEDIA_ID,
        media: { type: "photo", media: `attach://${RICH_MEDIA_FILENAME}` },
      },
    ];
    const form = new FormData();
    form.append("chat_id", chatId);
    // The Bot API takes nested objects as JSON strings on multipart requests.
    form.append("rich_message", JSON.stringify(richMessage));
    form.append(
      RICH_MEDIA_FILENAME,
      new File([fs.readFileSync(imagePath as string)], RICH_MEDIA_FILENAME, {
        type: mimeForImage(imagePath as string),
      }),
    );
    body = form;
  } else {
    body = JSON.stringify({ chat_id: chatId, rich_message: richMessage });
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendRichMessage`,
    {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(120_000),
    },
  );

  const data = await parseTelegramResponse(response);
  if (!data.ok) {
    return {
      success: false,
      error: data.description || "Telegram sendRichMessage failed",
    };
  }
  return { success: true };
}

async function sendPhoto(
  token: string,
  chatId: string,
  imagePath: string,
  caption: string,
): Promise<TgResult> {
  const buffer = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath) || "image.png";

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append(
    "photo",
    new File([buffer], filename, { type: mimeForImage(imagePath) }),
  );
  const cap = (caption || "").trim() || " ";
  form.append("caption", cap.slice(0, CAPTION_HARD));
  form.append("parse_mode", "HTML");

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendPhoto`,
    {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    },
  );

  const data = await parseTelegramResponse(response);
  if (!data.ok) {
    return {
      success: false,
      error: data.description || "Telegram sendPhoto failed",
    };
  }
  return { success: true };
}

async function sendVideo(
  token: string,
  chatId: string,
  videoPath: string,
  caption: string,
): Promise<TgResult> {
  const buffer = fs.readFileSync(videoPath);
  const filename = path.basename(videoPath) || "video.mp4";
  const ext = path.extname(videoPath).toLowerCase();
  const mime =
    ext === ".mov"
      ? "video/quicktime"
      : ext === ".webm"
        ? "video/webm"
        : "video/mp4";

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("video", new File([buffer], filename, { type: mime }));
  const cap = (caption || "").trim() || " ";
  form.append("caption", cap.slice(0, CAPTION_HARD));
  form.append("parse_mode", "HTML");
  form.append("supports_streaming", "true");

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendVideo`,
    {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(300_000),
    },
  );

  const data = await parseTelegramResponse(response);
  if (!data.ok) {
    return {
      success: false,
      error: data.description || "Telegram sendVideo failed",
    };
  }
  return { success: true };
}

/**
 * Caption for the media post.
 *
 * MUST be a strict prefix of `text`, so the continuation is exactly
 * `text.slice(caption.length)`. If the format layer ever breaks that invariant
 * we recompute locally rather than trust it — a non-prefix caption would
 * duplicate the opening of the article in the channel.
 */
function resolveCaption(text: string, prebuilt?: string): string {
  const candidate = (prebuilt || "").trim();
  if (candidate && text.startsWith(candidate)) return candidate;
  return truncateHtmlPrefix(text, CAPTION_HARD);
}

/**
 * Ops / admin alert (token expiry, health). Uses TELEGRAM_CHANNEL by default.
 * Does not count toward daily post limits.
 */
export async function sendTelegramAlert(
  text: string,
  chatId?: string,
): Promise<TgResult> {
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    const channel = (chatId || env.TELEGRAM_CHANNEL || "").trim();
    if (!token || !channel) {
      return {
        success: false,
        error:
          "TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL are required for alerts",
      };
    }
    return await sendMessage(token, channel, text, false);
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export type TelegramMediaKind = "image" | "video";

/**
 * Publish the channel post.
 *
 * Tries ONE rich message first (cover embedded, up to 32768 chars); on any
 * rejection, or for video, falls back to the caption layout.
 */
export async function publishToTelegram(
  text: string,
  imagePath?: string,
  mediaKind: TelegramMediaKind = "image",
  /**
   * Preformatted caption ≤1024 from the format layer (a prefix of `text`).
   * Used only by the FALLBACK layout — a rich message has no caption.
   */
  prebuiltCaption?: string,
): Promise<TgResult> {
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    const channel = env.TELEGRAM_CHANNEL;
    if (!token || !channel) {
      return {
        success: false,
        error: "TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL are required",
      };
    }

    const hasMedia = Boolean(imagePath && fs.existsSync(imagePath));
    const isVideo =
      mediaKind === "video" ||
      (hasMedia && /\.(mp4|mov|webm|mkv)$/i.test(imagePath || ""));

    // Preferred path: ONE rich message with the cover embedded as a block.
    //
    // Skipped for video (kept on the proven caption layout) and when disabled by
    // env. Any rejection falls through to the caption layout below rather than
    // failing the publish — the rich API is new, and a post that arrives in two
    // messages beats a post that does not arrive.
    if (env.TELEGRAM_RICH_MESSAGES && !isVideo) {
      const rich = await sendRichMessage(
        token,
        channel,
        text,
        hasMedia ? imagePath : undefined,
      );
      if (rich.success) {
        console.log(
          `[telegram] rich single message OK (${text.length} chars` +
            `${hasMedia ? " + embedded cover" : ", no image"})`,
        );
        return { success: true };
      }
      console.warn(
        "[telegram] rich message rejected — falling back to caption layout:",
        rich.error,
      );
    }

    // No media → the post is pure text, one or more messages.
    if (!hasMedia) {
      return await sendMessage(token, channel, text, false);
    }

    const caption = resolveCaption(text, prebuiltCaption);
    const remainder = text.slice(caption.length).trim();
    console.log(
      `[telegram] caption=${caption.length}/${CAPTION_HARD} continuation=${remainder.length}`,
    );

    const head = isVideo
      ? await sendVideo(token, channel, imagePath as string, caption)
      : await sendPhoto(token, channel, imagePath as string, caption);

    if (!head.success) {
      console.warn(
        `[telegram] ${isVideo ? "sendVideo" : "sendPhoto"} failed, posting text only:`,
        head.error,
      );
      return await sendMessage(token, channel, text, false);
    }
    console.log(`[telegram] ${isVideo ? "video" : "photo"}+caption post OK`);

    // The rest of the article stays inside Telegram as a continuation.
    if (remainder) {
      const follow = await sendMessage(token, channel, remainder, false);
      if (!follow.success) {
        console.warn("[telegram] continuation failed:", follow.error);
        return { success: true, error: `continuation failed: ${follow.error}` };
      }
      console.log("[telegram] continuation message OK");
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
