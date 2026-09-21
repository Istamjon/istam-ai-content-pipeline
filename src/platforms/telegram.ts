/**
 * Telegram channel publishing.
 *
 * Layout: the ENTIRE article is delivered inside Telegram itself.
 *   - image/video present → media post with a caption (first ≤1024 chars),
 *     then the remainder as continuation message(s) (≤4096 each)
 *   - no media           → the whole post as message(s)
 *
 * There is no external long-form page (Telegra.ph was removed): the caption is
 * a strict prefix of the full text, so the continuation is a plain slice with
 * nothing repeated and nothing lost.
 *
 * Note: Telegram's 4096 message / 1024 caption limits apply to every account,
 * including Premium — Premium raises file upload size, not text limits.
 */
import { env } from "../config/env.js";
import fs from "fs";
import path from "path";
import { truncateHtmlPrefix } from "../config/platformTextLimits.js";

type TgResult = { success: boolean; error?: string };

/** Telegram media caption hard limit. */
const CAPTION_HARD = 1024;

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
      ok: Boolean(data.ok),
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
    chunks.push(remaining.slice(0, 4096));
    remaining = remaining.slice(4096);
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

async function sendPhoto(
  token: string,
  chatId: string,
  imagePath: string,
  caption: string,
): Promise<TgResult> {
  const buffer = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath) || "image.png";
  const ext = path.extname(filename).toLowerCase();
  const mime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".webp"
        ? "image/webp"
        : "image/png";

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("photo", new File([buffer], filename, { type: mime }));
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

export async function publishToTelegram(
  text: string,
  imagePath?: string,
  mediaKind: TelegramMediaKind = "image",
  /** Preformatted caption ≤1024 from the format layer (a prefix of `text`). */
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
