/**
 * Inbound Telegram bot — admin sends photo/video + caption → multi-platform publish.
 *
 * Flow:
 *  1. Admin DMs bot with photo or video (caption = post text), or text then media
 *  2. Bot shows preview + inline buttons: Publish all / Cancel
 *  3. On confirm → publishManualPost to ENABLED_PLATFORMS
 *
 * Auth: TELEGRAM_ADMIN_IDS (comma-separated numeric user ids)
 * Disable: TELEGRAM_BOT_INBOUND=false
 */
import fs from "fs";
import path from "path";
import { env } from "../config/env.js";
import {
  formatResultsMessage,
  publishManualPost,
  type ManualMediaKind,
} from "./manualPublish.js";

const API = (token: string) => `https://api.telegram.org/bot${token}`;

type TgUser = { id: number; username?: string; first_name?: string };
type TgChat = { id: number; type: string };
type TgPhotoSize = { file_id: string; file_unique_id: string; width: number; height: number };
type TgVideo = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};
type TgDocument = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};
type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  video?: TgVideo;
  document?: TgDocument;
};
type TgCallbackQuery = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};
type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
};

type Draft = {
  text: string;
  mediaPath?: string;
  mediaKind: ManualMediaKind;
  createdAt: number;
  /** File ids for cleanup tracking */
  chatId: number;
};

const drafts = new Map<number, Draft>();
const DRAFT_TTL_MS = 30 * 60 * 1000;
const MEDIA_DIR = path.resolve("./data/bot-uploads");

let offset = 0;
let running = false;
let busyPublish = false;

function isAdmin(userId: number): boolean {
  const ids = env.TELEGRAM_ADMIN_IDS;
  if (!ids.length) return false;
  return ids.includes(String(userId));
}

async function tgCall<T = unknown>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const res = await fetch(`${API(token)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(method === "getUpdates" ? 60_000 : 30_000),
  });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) {
    throw new Error(data.description || `Telegram ${method} failed`);
  }
  return data.result as T;
}

async function sendText(
  chatId: number,
  text: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await tgCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

async function answerCallback(id: string, text?: string): Promise<void> {
  try {
    await tgCall("answerCallbackQuery", {
      callback_query_id: id,
      text: text?.slice(0, 200),
      show_alert: false,
    });
  } catch {
    // ignore expired callbacks
  }
}

function ensureMediaDir(): void {
  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  }
}

async function downloadFile(
  fileId: string,
  preferredName: string,
): Promise<string> {
  ensureMediaDir();
  const file = await tgCall<{ file_path?: string }>("getFile", {
    file_id: fileId,
  });
  if (!file.file_path) {
    throw new Error("getFile: no file_path");
  }
  const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) {
    throw new Error(`Download failed HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const ext =
    path.extname(file.file_path) ||
    path.extname(preferredName) ||
    ".bin";
  const local = path.join(
    MEDIA_DIR,
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`,
  );
  fs.writeFileSync(local, buf);
  return local;
}

function cleanupDraft(chatId: number): void {
  const d = drafts.get(chatId);
  if (d?.mediaPath && fs.existsSync(d.mediaPath)) {
    try {
      fs.unlinkSync(d.mediaPath);
    } catch {
      // ignore
    }
  }
  drafts.delete(chatId);
}

function expireOldDrafts(): void {
  const now = Date.now();
  for (const [chatId, d] of drafts) {
    if (now - d.createdAt > DRAFT_TTL_MS) {
      cleanupDraft(chatId);
    }
  }
}

function previewHtml(d: Draft): string {
  const media =
    d.mediaKind === "image"
      ? "🖼 Rasm"
      : d.mediaKind === "video"
        ? "🎬 Video"
        : "📝 Matn only";
  const platforms = env.ENABLED_PLATFORMS.join(", ") || "(none)";
  const textPreview =
    d.text.length > 800 ? d.text.slice(0, 800) + "…" : d.text;
  const videoNote =
    d.mediaKind === "video"
      ? "\n⏭ <i>Video: LinkedIn skip (video API yoʻq)</i>"
      : "";
  return [
    "<b>Draft tayyor</b>",
    `Media: ${media}`,
    `Platformalar: <code>${platforms}</code>${videoNote}`,
    "",
    "<b>Matn:</b>",
    escapeHtml(textPreview),
    "",
    "Pastdagi tugma bilan barcha platformalarga joylaysiz.",
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function confirmKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "✅ Barcha platformalarga joylash", callback_data: "pub:yes" },
        { text: "❌ Bekor", callback_data: "pub:no" },
      ],
    ],
  };
}

async function setDraftAndPreview(chatId: number, draft: Draft): Promise<void> {
  // Replace previous draft media
  const prev = drafts.get(chatId);
  if (prev?.mediaPath && prev.mediaPath !== draft.mediaPath) {
    try {
      if (fs.existsSync(prev.mediaPath)) fs.unlinkSync(prev.mediaPath);
    } catch {
      // ignore
    }
  }
  drafts.set(chatId, draft);
  await sendText(chatId, previewHtml(draft), {
    reply_markup: confirmKeyboard(),
  });
}

async function handleMessage(msg: TgMessage): Promise<void> {
  const from = msg.from;
  if (!from) return;
  const chatId = msg.chat.id;

  // Only private chats for admin posts (avoids channel noise)
  if (msg.chat.type !== "private") {
    return;
  }

  const textCmd = (msg.text || "").trim();

  if (textCmd === "/start" || textCmd === "/help") {
    const admin = isAdmin(from.id);
    await sendText(
      chatId,
      [
        "<b>Istam AI — Manual Publish Bot</b>",
        "",
        "Rasm yoki video + caption (post matni) yuboring.",
        "Tasdiqlagach, barcha yoqilgan platformalarga joylanadi.",
        "",
        "<b>Buyruqlar</b>",
        "/help — yordam",
        "/whoami — sizning Telegram ID",
        "/platforms — yoqilgan platformalar",
        "/cancel — draftni bekor qilish",
        "",
        admin
          ? "✅ Siz <b>admin</b>siz — post yuborishingiz mumkin."
          : "⛔ Siz admin emassiz. <code>TELEGRAM_ADMIN_IDS</code> ga ID qoʻshing.",
      ].join("\n"),
    );
    return;
  }

  if (textCmd === "/whoami") {
    await sendText(
      chatId,
      `Sizning ID: <code>${from.id}</code>\nUsername: @${from.username || "—"}\nAdmin: ${isAdmin(from.id) ? "ha" : "yoʻq"}`,
    );
    return;
  }

  if (textCmd === "/platforms") {
    await sendText(
      chatId,
      `Yoqilgan: <code>${env.ENABLED_PLATFORMS.join(", ") || "(boʻsh)"}</code>\nDRY_RUN=${env.DRY_RUN}`,
    );
    return;
  }

  if (textCmd === "/cancel") {
    cleanupDraft(chatId);
    await sendText(chatId, "Draft bekor qilindi.");
    return;
  }

  if (!isAdmin(from.id)) {
    await sendText(
      chatId,
      `⛔ Ruxsat yoʻq.\nID: <code>${from.id}</code>\n.env da: <code>TELEGRAM_ADMIN_IDS=${from.id}</code>`,
    );
    return;
  }

  // Photo (largest size)
  if (msg.photo?.length) {
    const best = msg.photo[msg.photo.length - 1];
    const caption = (msg.caption || "").trim();
    if (!caption) {
      await sendText(
        chatId,
        "Rasm yubordingiz, lekin <b>caption</b> (post matni) yoʻq.\nRasmni matn bilan birga yuboring.",
      );
      return;
    }
    try {
      await sendText(chatId, "⏳ Rasm yuklanmoqda…");
      const local = await downloadFile(best.file_id, "photo.jpg");
      await setDraftAndPreview(chatId, {
        text: caption,
        mediaPath: local,
        mediaKind: "image",
        createdAt: Date.now(),
        chatId,
      });
    } catch (e) {
      await sendText(chatId, `Rasm yuklash xato: ${escapeHtml(String(e))}`);
    }
    return;
  }

  // Video
  if (msg.video) {
    const caption = (msg.caption || "").trim();
    if (!caption) {
      await sendText(
        chatId,
        "Video yubordingiz, lekin <b>caption</b> (post matni) yoʻq.\nVideoni matn bilan birga yuboring.",
      );
      return;
    }
    const size = msg.video.file_size || 0;
    // Bot API getFile limit ~20MB for standard bots
    if (size > 20 * 1024 * 1024) {
      await sendText(
        chatId,
        "Video juda katta (Telegram Bot API ~20MB limit). Qisqaroq video yuboring.",
      );
      return;
    }
    try {
      await sendText(chatId, "⏳ Video yuklanmoqda…");
      const local = await downloadFile(
        msg.video.file_id,
        msg.video.file_name || "video.mp4",
      );
      await setDraftAndPreview(chatId, {
        text: caption,
        mediaPath: local,
        mediaKind: "video",
        createdAt: Date.now(),
        chatId,
      });
    } catch (e) {
      await sendText(chatId, `Video yuklash xato: ${escapeHtml(String(e))}`);
    }
    return;
  }

  // Document image/video
  if (msg.document) {
    const mime = (msg.document.mime_type || "").toLowerCase();
    const name = (msg.document.file_name || "").toLowerCase();
    const isImage =
      mime.startsWith("image/") ||
      /\.(jpe?g|png|webp|gif)$/i.test(name);
    const isVideo =
      mime.startsWith("video/") ||
      /\.(mp4|mov|webm|mkv)$/i.test(name);
    if (!isImage && !isVideo) {
      await sendText(chatId, "Faqat rasm yoki video hujjat qabul qilinadi.");
      return;
    }
    const caption = (msg.caption || "").trim();
    if (!caption) {
      await sendText(
        chatId,
        "Hujjatda <b>caption</b> (post matni) kerak.",
      );
      return;
    }
    const size = msg.document.file_size || 0;
    if (size > 20 * 1024 * 1024) {
      await sendText(chatId, "Fayl juda katta (~20MB limit).");
      return;
    }
    try {
      await sendText(chatId, "⏳ Fayl yuklanmoqda…");
      const local = await downloadFile(
        msg.document.file_id,
        msg.document.file_name || (isVideo ? "video.mp4" : "image.jpg"),
      );
      await setDraftAndPreview(chatId, {
        text: caption,
        mediaPath: local,
        mediaKind: isVideo ? "video" : "image",
        createdAt: Date.now(),
        chatId,
      });
    } catch (e) {
      await sendText(chatId, `Yuklash xato: ${escapeHtml(String(e))}`);
    }
    return;
  }

  // Text-only post
  if (textCmd && !textCmd.startsWith("/")) {
    await setDraftAndPreview(chatId, {
      text: textCmd,
      mediaKind: "none",
      createdAt: Date.now(),
      chatId,
    });
    return;
  }
}

async function handleCallback(cq: TgCallbackQuery): Promise<void> {
  const chatId = cq.message?.chat.id;
  if (!chatId) {
    await answerCallback(cq.id);
    return;
  }

  if (!isAdmin(cq.from.id)) {
    await answerCallback(cq.id, "Ruxsat yoʻq");
    return;
  }

  const data = cq.data || "";
  if (data === "pub:no") {
    cleanupDraft(chatId);
    await answerCallback(cq.id, "Bekor");
    await sendText(chatId, "Draft bekor qilindi.");
    return;
  }

  if (data !== "pub:yes") {
    await answerCallback(cq.id);
    return;
  }

  const draft = drafts.get(chatId);
  if (!draft) {
    await answerCallback(cq.id, "Draft topilmadi");
    await sendText(chatId, "Draft yoʻq yoki muddati oʻtgan. Qayta yuboring.");
    return;
  }

  if (busyPublish) {
    await answerCallback(cq.id, "Boshqa publish ketmoqda…");
    await sendText(chatId, "⏳ Boshqa post hali joylanmoqda. Biroz kuting.");
    return;
  }

  await answerCallback(cq.id, "Publish boshlandi…");
  busyPublish = true;
  // Remove draft from map but keep files until publish finishes
  drafts.delete(chatId);

  try {
    await sendText(
      chatId,
      `🚀 Joylash boshlandi…\nPlatformalar: <code>${env.ENABLED_PLATFORMS.join(", ")}</code>`,
    );

    // Copy media path — publishManualPost deletes local media at end
    const result = await publishManualPost({
      text: draft.text,
      mediaPath: draft.mediaPath,
      mediaKind: draft.mediaKind,
      source: "telegram-bot",
    });

    await sendText(chatId, formatResultsMessage(result));
  } catch (e) {
    // On failure, try to free media
    if (draft.mediaPath && fs.existsSync(draft.mediaPath)) {
      try {
        fs.unlinkSync(draft.mediaPath);
      } catch {
        // ignore
      }
    }
    await sendText(chatId, `❌ Publish xato: ${escapeHtml(String(e))}`);
  } finally {
    busyPublish = false;
  }
}

async function processUpdate(u: TgUpdate): Promise<void> {
  try {
    if (u.callback_query) {
      await handleCallback(u.callback_query);
      return;
    }
    if (u.message) {
      await handleMessage(u.message);
    }
  } catch (e) {
    console.warn("[telegramBot] update error:", e);
  }
}

/**
 * Long-poll loop. Call once from process start; non-blocking (async loop).
 */
export function startTelegramBot(): void {
  if (!env.TELEGRAM_BOT_INBOUND) {
    console.log("[telegramBot] Inbound disabled (TELEGRAM_BOT_INBOUND=false)");
    return;
  }
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.warn("[telegramBot] No TELEGRAM_BOT_TOKEN — bot not started");
    return;
  }
  if (!env.TELEGRAM_ADMIN_IDS.length) {
    console.warn(
      "[telegramBot] TELEGRAM_ADMIN_IDS empty — bot starts but nobody can publish. " +
        "DM bot /whoami and set your id in .env",
    );
  }

  if (running) {
    console.log("[telegramBot] Already running");
    return;
  }
  running = true;
  ensureMediaDir();

  console.log(
    `[telegramBot] Starting long-poll · admins=${env.TELEGRAM_ADMIN_IDS.join(",") || "(none)"} · platforms=${env.ENABLED_PLATFORMS.join(",")}`,
  );

  // Drop pending updates so we don't re-process old messages after restart
  void (async () => {
    try {
      await tgCall("deleteWebhook", { drop_pending_updates: true });
    } catch {
      // ignore
    }
    void pollLoop();
  })();
}

async function pollLoop(): Promise<void> {
  while (running) {
    try {
      expireOldDrafts();
      const updates = await tgCall<TgUpdate[]>("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      });

      for (const u of updates) {
        offset = u.update_id + 1;
        await processUpdate(u);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Timeout on long-poll is normal if AbortSignal fires; network blips retry
      if (!/aborted|timeout/i.test(msg)) {
        console.warn("[telegramBot] poll error:", msg.slice(0, 200));
      }
      await sleep(2000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function stopTelegramBot(): void {
  running = false;
}
