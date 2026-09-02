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
 *
 * Design notes:
 * - Per-chat lock (busyChats) — each admin can publish independently.
 * - Draft TTL = 30 min; preview shows deadline.
 * - Parallel platform publish via Promise.allSettled.
 * - drop_pending_updates=false so admin messages on restart are preserved.
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

type ChatState =
  | { step: "IDLE" }
  | { step: "WAITING_FOR_TEXT" }
  | { step: "WAITING_FOR_MEDIA"; text: string };

const chatStates = new Map<number, ChatState>();

let offset = 0;
let running = false;

/**
 * Per-chat publish lock — prevents double-tap and allows multiple admins
 * to publish concurrently from different chats.
 */
const busyChats = new Set<number>();

function isAdmin(userId: number): boolean {
  const ids = env.TELEGRAM_ADMIN_IDS;
  if (!ids.length) return false;
  return ids.includes(String(userId));
}

async function tgCallOnce<T = unknown>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const url = `${API(token)}/${method}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), method === "getUpdates" ? 60_000 : 30_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) {
      throw new Error(data.description || `Telegram ${method} failed`);
    }
    return data.result as T;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Telegram API call with one network-level retry.
 * The global undici Agent reaps keep-alive sockets at 10s while Telegram
 * long-polls run 25s, so a reused-closed socket can surface as a single
 * "fetch failed" that succeeds on immediate retry.
 */
async function tgCall<T = unknown>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  try {
    return await tgCallOnce<T>(method, body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch failed|ECONNRESET|EPIPE|socket hang up|EAI_AGAIN/i.test(msg)) {
      await sleep(1_000);
      return tgCallOnce<T>(method, body);
    }
    throw e;
  }
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
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
  } finally {
    clearTimeout(timeout);
  }
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
  // Show expiry deadline so admin knows the time window
  const expiresAt = new Date(d.createdAt + DRAFT_TTL_MS);
  const hh = String(expiresAt.getHours()).padStart(2, "0");
  const mm = String(expiresAt.getMinutes()).padStart(2, "0");
  const expiryNote = `⏱ Muddati: <b>${hh}:${mm}</b> gacha (30 daqiqa)`;
  return [
    "<b>Draft tayyor</b>",
    `Media: ${media}`,
    `Platformalar: <code>${platforms}</code>${videoNote}`,
    expiryNote,
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
        "Siz postni ikkita usulda joylashingiz mumkin:",
        "1. Matn va rasmni bitta xabarda yuborish.",
        "2. <b>/post</b> yoki <b>/new</b> orqali bosqichma-bosqich boshlash.",
        "",
        "Tasdiqlagach, barcha yoqilgan platformalarga joylanadi.",
        "",
        "<b>Buyruqlar</b>",
        "/post — yangi postni boshlash",
        "/help — yordam",
        "/whoami — sizning Telegram ID",
        "/platforms — yoqilgan platformalar",
        "/cancel — amaliyotni bekor qilish",
        "",
        admin
          ? "✅ Siz <b>admin</b>siz — post yuborishingiz mumkin."
          : "⛔ Siz admin emassiz. <code>TELEGRAM_ADMIN_IDS</code> ga ID qoʻshing.",
      ].join("\n"),
    );
    chatStates.set(chatId, { step: "IDLE" });
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
    chatStates.set(chatId, { step: "IDLE" });
    await sendText(chatId, "Bekor qilindi.");
    return;
  }

  if (!isAdmin(from.id)) {
    await sendText(
      chatId,
      `⛔ Ruxsat yoʻq.\nID: <code>${from.id}</code>\n.env da: <code>TELEGRAM_ADMIN_IDS=${from.id}</code>`,
    );
    return;
  }

  // Ensure state exists
  const state = chatStates.get(chatId) || { step: "IDLE" };

  if (textCmd === "/post" || textCmd === "/new") {
    chatStates.set(chatId, { step: "WAITING_FOR_TEXT" });
    await sendText(
      chatId,
      "📝 <b>1-qadam: Post matnini yuboring.</b>\n\n(Yoki faqat rasmli/videoli post uchun /skip bosing)",
    );
    return;
  }

  // --- WIZARD: WAITING_FOR_TEXT ---
  if (state.step === "WAITING_FOR_TEXT") {
    if (textCmd === "/skip") {
      chatStates.set(chatId, { step: "WAITING_FOR_MEDIA", text: "" });
      await sendText(
        chatId,
        "Matn bekor qilindi. 🖼 <b>2-qadam: Endi rasm yoki video yuboring.</b>",
      );
      return;
    }

    if (msg.photo?.length || msg.video || msg.document) {
      // User sent media instead of text directly in this step, with or without caption
      // We will handle it by falling through to the media handler below, treating it as completing both steps.
    } else if (textCmd) {
      chatStates.set(chatId, { step: "WAITING_FOR_MEDIA", text: textCmd });
      await sendText(
        chatId,
        "✅ Matn qabul qilindi. 🖼 <b>2-qadam: Endi rasm yoki video yuboring.</b>\n\n(Yoki faqat matnli post uchun /skip bosing)",
      );
      return;
    }
  }

  // --- WIZARD: WAITING_FOR_MEDIA ---
  if (state.step === "WAITING_FOR_MEDIA") {
    if (textCmd === "/skip") {
      if (!state.text) {
        await sendText(chatId, "❌ Matn va media ikkalasi ham bo'sh bo'lishi mumkin emas. /cancel bosing.");
        return;
      }
      chatStates.set(chatId, { step: "IDLE" });
      await setDraftAndPreview(chatId, {
        text: state.text,
        mediaKind: "none",
        createdAt: Date.now(),
        chatId,
      });
      return;
    }
  }

  // Photo (largest size)
  if (msg.photo?.length) {
    const best = msg.photo[msg.photo.length - 1];
    let caption = (msg.caption || "").trim();
    if (state.step === "WAITING_FOR_MEDIA") {
      caption = state.text || caption;
    }
    if (!caption) {
      await sendText(
        chatId,
        "Rasm yubordingiz, lekin <b>caption</b> (post matni) yoʻq.\nRasmni matn bilan birga yuboring yoki avval /post bosing.",
      );
      return;
    }
    chatStates.set(chatId, { step: "IDLE" });
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
    let caption = (msg.caption || "").trim();
    if (state.step === "WAITING_FOR_MEDIA") {
      caption = state.text || caption;
    }
    if (!caption) {
      await sendText(
        chatId,
        "Video yubordingiz, lekin <b>caption</b> (post matni) yoʻq.\nVideoni matn bilan birga yuboring yoki avval /post bosing.",
      );
      return;
    }
    chatStates.set(chatId, { step: "IDLE" });
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
    let caption = (msg.caption || "").trim();
    if (state.step === "WAITING_FOR_MEDIA") {
      caption = state.text || caption;
    }
    if (!caption) {
      await sendText(
        chatId,
        "Hujjatda <b>caption</b> (post matni) kerak. Yoki /post orqali yuboring.",
      );
      return;
    }
    chatStates.set(chatId, { step: "IDLE" });
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
    if (state.step === "WAITING_FOR_MEDIA") {
      await sendText(chatId, "Media kutyapman. Agar media kerak bo'lmasa /skip bosing.");
      return;
    }
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

  // Per-chat lock — each admin chat can publish independently.
  if (busyChats.has(chatId)) {
    await answerCallback(cq.id, "Shu chat publish ketmoqda…");
    await sendText(chatId, "⏳ Bu chatda post hali joylanmoqda. Biroz kuting.");
    return;
  }

  await answerCallback(cq.id, "Publish boshlandi…");
  busyChats.add(chatId);

  // Keep draft in map until publish finishes so media cleanup is safe.
  // We work on a snapshot copy.
  const draftSnapshot: Draft = { ...draft };

  try {
    await sendText(
      chatId,
      `🚀 Joylash boshlandi…\nPlatformalar: <code>${env.ENABLED_PLATFORMS.join(", ")}</code>`,
    );

    const result = await publishManualPost({
      text: draftSnapshot.text,
      mediaPath: draftSnapshot.mediaPath,
      mediaKind: draftSnapshot.mediaKind,
      source: "telegram-bot",
    });

    // Remove draft only after successful publish
    drafts.delete(chatId);

    await sendText(chatId, formatResultsMessage(result));
  } catch (e) {
    // On failure keep draft so admin can retry; clean up media manually
    if (draftSnapshot.mediaPath && fs.existsSync(draftSnapshot.mediaPath)) {
      try {
        fs.unlinkSync(draftSnapshot.mediaPath);
      } catch {
        // ignore
      }
    }
    drafts.delete(chatId);
    await sendText(chatId, `❌ Publish xato: ${escapeHtml(String(e))}`);
  } finally {
    busyChats.delete(chatId);
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

  // Clear webhook without dropping pending updates — preserve admin messages on restart.
  void (async () => {
    try {
      await tgCall("deleteWebhook", { drop_pending_updates: false });
    } catch {
      // ignore
    }
    void pollLoop();
  })();
}

async function pollLoop(): Promise<void> {
  let consecutiveFails = 0;
  while (running) {
    try {
      expireOldDrafts();
      const updates = await tgCall<TgUpdate[]>("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      });
      consecutiveFails = 0;

      for (const u of updates) {
        offset = u.update_id + 1;
        await processUpdate(u);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Timeout on long-poll is normal if AbortSignal fires; network blips retry
      if (!/aborted|timeout/i.test(msg)) {
        consecutiveFails += 1;
        // Rate-limit spam: log every failure at first, then every 15th
        if (consecutiveFails <= 3 || consecutiveFails % 15 === 0) {
          console.warn(
            `[telegramBot] poll error (n=${consecutiveFails}):`,
            msg.slice(0, 200),
          );
          if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(msg)) {
            console.warn(
              "[telegramBot] Hint: VDS may block Telegram or prefer broken IPv6. " +
                "Container uses NODE_OPTIONS=--dns-result-order=ipv4first. " +
                "Test: curl -4 -I https://api.telegram.org",
            );
          }
        }
      }
      // Back off harder on repeated network failures (avoid log flood + busy-loop)
      const backoff = Math.min(60_000, 2000 * Math.max(1, consecutiveFails));
      await sleep(backoff);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function stopTelegramBot(): void {
  running = false;
}
