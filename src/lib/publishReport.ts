/**
 * After pipeline publish: Telegram report to admins —
 * which platforms succeeded / failed / skipped.
 */
import { env } from "../config/env.js";
import type { PublishResult } from "../agent/state.js";
import { sendTelegramAlert } from "../platforms/telegram.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function icon(status: string): string {
  if (status === "success") return "✅";
  if (status === "skipped") return "⏭";
  if (status === "pending") return "⏳";
  return "❌";
}

export function formatPublishReport(opts: {
  title?: string;
  url?: string;
  results: PublishResult[];
  dryRun?: boolean;
}): string {
  const ok = opts.results.filter((r) => r.status === "success");
  const fail = opts.results.filter((r) => r.status === "failed");
  const skip = opts.results.filter((r) => r.status === "skipped");
  const pending = opts.results.filter((r) => r.status === "pending");

  const lines = opts.results.map((r) => {
    const err = r.error ? ` — <i>${escapeHtml(r.error.slice(0, 120))}</i>` : "";
    return `${icon(r.status)} <b>${escapeHtml(r.platform)}</b>: ${r.status}${err}`;
  });

  const head = opts.dryRun
    ? "🧪 <b>DRY_RUN natija</b> (haqiqiy post yo‘q)"
    : "📣 <b>Post nashr hisoboti</b>";

  const title = opts.title
    ? `\n📌 ${escapeHtml(opts.title.slice(0, 120))}`
    : "";
  const link = opts.url
    ? `\n🔗 <code>${escapeHtml(opts.url.slice(0, 180))}</code>`
    : "";

  return [
    head + title + link,
    "",
    `✅ ${ok.length} · ❌ ${fail.length} · ⏭ ${skip.length}` +
      (pending.length ? ` · ⏳ ${pending.length}` : ""),
    "",
    ...lines,
    "",
    ok.length === opts.results.length && opts.results.length > 0
      ? "🎉 Barcha platformalarda chiqdi."
      : fail.length > 0
        ? "⚠️ Ba’zi platformalar muvaffaqiyatsiz — keyingi slot qayta urinishi mumkin."
        : "ℹ️ Ba’zi platformalar o‘tkazib yuborildi (limit / credentials).",
  ].join("\n");
}

/**
 * Send report to every TELEGRAM_ADMIN_ID + optional TELEGRAM_ALERT_CHAT.
 * Falls back to TELEGRAM_CHANNEL if no admins configured.
 */
export async function notifyPublishReport(opts: {
  title?: string;
  url?: string;
  results: PublishResult[];
  dryRun?: boolean;
}): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.warn("[publishReport] no TELEGRAM_BOT_TOKEN — skip notify");
    return;
  }
  if (!opts.results.length) return;

  const text = formatPublishReport(opts);
  const chats = new Set<string>();
  for (const id of env.TELEGRAM_ADMIN_IDS) {
    if (id.trim()) chats.add(id.trim());
  }
  if (env.TELEGRAM_ALERT_CHAT?.trim()) {
    chats.add(env.TELEGRAM_ALERT_CHAT.trim());
  }
  if (chats.size === 0 && env.TELEGRAM_CHANNEL?.trim()) {
    chats.add(env.TELEGRAM_CHANNEL.trim());
  }

  if (chats.size === 0) {
    console.warn(
      "[publishReport] no admin chat — set TELEGRAM_ADMIN_IDS or TELEGRAM_ALERT_CHAT",
    );
    return;
  }

  for (const chat of chats) {
    try {
      const r = await sendTelegramAlert(text, chat);
      if (!r.success) {
        console.warn(
          `[publishReport] send → ${chat} failed: ${r.error?.slice(0, 120)}`,
        );
      } else {
        console.log(`[publishReport] sent → ${chat}`);
      }
    } catch (e) {
      console.warn(
        `[publishReport] send error ${chat}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
