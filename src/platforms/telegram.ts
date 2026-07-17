import { env } from "../config/env.js";
import fs from "fs";
import path from "path";
import { brand } from "../config/brand.js";
import {
  createTelegraphPage,
  buildTelegramTeaser,
} from "../lib/telegraph.js";

type TgResult = { success: boolean; error?: string };

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

  for (const chunk of chunks) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: "HTML",
        // Enable preview so telegra.ph card shows
        disable_web_page_preview: !preview,
      }),
      signal: AbortSignal.timeout(60_000),
    });
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
  form.append("photo", new Blob([buffer], { type: mime }), filename);
  // Always attach caption so image + text stay one Telegram post
  const cap = (caption || "").trim() || " ";
  form.append("caption", cap.slice(0, 1024));
  form.append("parse_mode", "HTML");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

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
  const ext = path.extname(filename).toLowerCase();
  const mime =
    ext === ".mov"
      ? "video/quicktime"
      : ext === ".webm"
        ? "video/webm"
        : "video/mp4";

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("video", new Blob([buffer], { type: mime }), filename);
  const cap = (caption || "").trim() || " ";
  form.append("caption", cap.slice(0, 1024));
  form.append("parse_mode", "HTML");
  form.append("supports_streaming", "true");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(300_000),
  });

  const data = await parseTelegramResponse(response);
  if (!data.ok) {
    return {
      success: false,
      error: data.description || "Telegram sendVideo failed",
    };
  }
  return { success: true };
}

function extractTitle(text: string): string {
  const plain = text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/Yangi\s+[\w\s.-]*maqolasi\s*:\s*/gi, "")
    .replace(/Skywork(\s+AI)?\s*maqolasi\s*:\s*/gi, "")
    .trim();
  // Prefer short title-like first line; avoid dumping full hook as title
  let first = plain.split(/\n/)[0]?.trim() || brand.name;
  if (first.length > 70) {
    const sp = first.slice(0, 70).lastIndexOf(" ");
    first = (sp > 30 ? first.slice(0, sp) : first.slice(0, 70)).trim();
  }
  return first.slice(0, 100) || `Istam Obidov — AI Engineering`;
}

/**
 * Publish to Telegram.
 * Long content → Telegra.ph full article + short channel teaser with link.
 * Enables much longer canonical body on Telegram without multi-message spam.
 */
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
        error: "TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL are required for alerts",
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
  /** Preformatted caption ≤1024 from format layer (optional). */
  prebuiltCaption?: string,
): Promise<TgResult> {
  try {
    const token = env.TELEGRAM_BOT_TOKEN;
    const channel = env.TELEGRAM_CHANNEL;
    if (!token || !channel) {
      return { success: false, error: "TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL are required" };
    }

    const CAPTION_HARD = 1024;
    const useTelegraph = env.TELEGRAPH_ENABLED !== false;
    let channelText = text;
    let telegraphUrl = "";

    // Telegra.ph for long text + still image — full article always when over caption budget
    const isVideo =
      mediaKind === "video" ||
      (Boolean(imagePath) &&
        /\.(mp4|mov|webm|mkv)$/i.test(imagePath || ""));
    const needsTelegraph =
      useTelegraph && !isVideo && (text.length > 700 || Boolean(imagePath));
    if (needsTelegraph) {
      try {
        const page = await createTelegraphPage({
          title: extractTitle(text),
          content: text,
          imagePath:
            imagePath && fs.existsSync(imagePath) && !isVideo
              ? imagePath
              : undefined,
          authorName: brand.name,
          authorUrl: brand.socialLinks.telegram,
        });
        telegraphUrl = page.url;
        channelText = buildTelegramTeaser(text, page.url);
        console.log("[telegram] Telegra.ph:", telegraphUrl);
      } catch (e) {
        console.warn("[telegram] Telegra.ph failed, posting smart teaser only:", e);
        channelText = buildTelegramTeaser(text, "");
      }
    }

    if (imagePath && fs.existsSync(imagePath)) {
      // Prefer format-layer caption; else teaser; never mid-sentence slice
      let caption = (prebuiltCaption || channelText || " ").trim();
      if (telegraphUrl && !caption.includes(telegraphUrl)) {
        // Ensure full-article link present when we have Telegra.ph
        caption = buildTelegramTeaser(text, telegraphUrl);
      }
      if (caption.length > CAPTION_HARD) {
        caption = buildTelegramTeaser(text, telegraphUrl || "").slice(0, CAPTION_HARD);
        // buildTelegramTeaser already respects ~1024; hard clamp without mid-word if still over
        if (caption.length > CAPTION_HARD) {
          const sp = caption.lastIndexOf(" ", CAPTION_HARD - 1);
          caption =
            (sp > 40 ? caption.slice(0, sp) : caption.slice(0, CAPTION_HARD - 1)).trim() +
            "…";
        }
      }
      console.log(`[telegram] captionLen=${caption.length}/${CAPTION_HARD}`);

      if (isVideo) {
        const video = await sendVideo(token, channel, imagePath, caption);
        if (!video.success) {
          console.warn(
            "[telegram] sendVideo failed, falling back to message:",
            video.error,
          );
          return await sendMessage(
            token,
            channel,
            channelText,
            Boolean(telegraphUrl),
          );
        }
        console.log("[telegram] single video+caption post OK");
        return { success: true };
      }

      // ONE post: image + text together (caption under photo — not two messages)
      const photo = await sendPhoto(token, channel, imagePath, caption);
      if (!photo.success) {
        console.warn(
          "[telegram] sendPhoto failed, falling back to message:",
          photo.error,
        );
        return await sendMessage(
          token,
          channel,
          channelText,
          Boolean(telegraphUrl),
        );
      }
      console.log("[telegram] single photo+caption post OK");
      if (telegraphUrl && caption.length >= CAPTION_HARD - 20) {
        const linkMsg =
          `📖 <b>Toʻliq matn</b>\n<a href="${telegraphUrl}">${telegraphUrl}</a>`;
        const follow = await sendMessage(token, channel, linkMsg, true);
        if (!follow.success) {
          console.warn("[telegram] telegra follow-up failed:", follow.error);
        }
      }
      return { success: true };
    }

    return await sendMessage(token, channel, channelText, Boolean(telegraphUrl));
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
