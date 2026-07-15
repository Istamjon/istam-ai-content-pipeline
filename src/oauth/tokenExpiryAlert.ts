/**
 * Telegram alert when OAuth tokens are about to expire (default: 1 day left).
 * Deduped per platform per calendar day so pipeline restarts do not spam.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../config/env.js";
import { sendTelegramAlert } from "../platforms/telegram.js";
import { loadTokens } from "./tokenStore.js";
import { expiresAtMs, msUntilExpiry } from "./tokenRefresh.js";
import type { OAuthPlatform, StoredTokens } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const alertStatePath = path.resolve(projectRoot, "data/token-alerts.json");

type AlertState = Record<string, string>; // key → YYYY-MM-DD last alerted (UTC)

function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function loadState(): AlertState {
  try {
    if (!fs.existsSync(alertStatePath)) return {};
    return JSON.parse(fs.readFileSync(alertStatePath, "utf8")) as AlertState;
  } catch {
    return {};
  }
}

function saveState(state: AlertState): void {
  const dir = path.dirname(alertStatePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(alertStatePath, JSON.stringify(state, null, 2), "utf8");
}

function hoursLeft(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

function daysLeft(ms: number): number {
  return Math.round((ms / 86_400_000) * 10) / 10;
}

type ExpiryRow = {
  key: string;
  label: string;
  msLeft: number;
  expiresAt: number;
  hasRefresh: boolean;
};

function rowFromStored(
  key: string,
  label: string,
  t: StoredTokens | null,
): ExpiryRow | null {
  if (!t?.accessToken) return null;
  const left = msUntilExpiry(t);
  const exp = expiresAtMs(t);
  if (left === null || exp === null) {
    // No known expiry (e.g. FB long-lived page NEVER) — no alert
    return null;
  }
  return {
    key,
    label,
    msLeft: left,
    expiresAt: exp,
    hasRefresh: Boolean(t.refreshToken),
  };
}

/**
 * Collect platforms that need an alert when ≤ TOKEN_ALERT_DAYS left (or already expired).
 * Only platforms that currently have a token with a known expiry.
 */
export function collectExpiringTokens(
  alertWithinDays = env.TOKEN_ALERT_DAYS,
): ExpiryRow[] {
  const thresholdMs = Math.max(0, alertWithinDays) * 86_400_000;
  const enabled = new Set(
    (env.ENABLED_PLATFORMS || []).map((p) => p.toLowerCase()),
  );
  const platforms: Array<{ id: OAuthPlatform; label: string }> = [
    { id: "linkedin", label: "LinkedIn" },
    { id: "facebook", label: "Facebook (page)" },
    { id: "instagram", label: "Instagram" },
    { id: "threads", label: "Threads" },
    { id: "x", label: "X (Twitter)" },
    { id: "blogger", label: "Blogger" },
  ];

  const rows: ExpiryRow[] = [];

  for (const p of platforms) {
    // Skip platforms not in ENABLED_PLATFORMS (except always watch linkedin/fb/ig/threads if token file exists)
    if (enabled.size > 0 && !enabled.has(p.id)) continue;

    const t = loadTokens(p.id);
    const row = rowFromStored(p.id, p.label, t);
    if (row && row.msLeft <= thresholdMs) {
      rows.push(row);
    }

    // Facebook: optional user token expiry only if explicitly stored (not NEVER)
    if (p.id === "facebook" && t?.extra?.userTokenExpiresIn) {
      const obtained = Number(t.extra.userTokenObtainedAt || t.obtainedAt || 0);
      const expiresIn = Number(t.extra.userTokenExpiresIn || 0);
      if (obtained > 0 && expiresIn > 0) {
        const exp = obtained + expiresIn * 1000;
        const left = exp - Date.now();
        if (left <= thresholdMs) {
          rows.push({
            key: "facebook-user",
            label: "Facebook (user / refresh)",
            msLeft: left,
            expiresAt: exp,
            hasRefresh: false,
          });
        }
      }
    }
  }

  return rows;
}

function formatAlertMessage(rows: ExpiryRow[]): string {
  const lines = [
    "⚠️ <b>Token muddati ogohlantirishi</b>",
    "",
    `Quyidagi token(lar)ning muddati <b>${env.TOKEN_ALERT_DAYS} kun</b> ichida tugaydi yoki allaqachon tugagan:`,
    "",
  ];

  for (const r of rows) {
    if (r.msLeft < 0 && r.expiresAt === 0) {
      lines.push(`• <b>${r.label}</b> — token yo‘q yoki o‘qib bo‘lmadi`);
      continue;
    }
    if (r.msLeft <= 0) {
      lines.push(
        `• <b>${r.label}</b> — ❌ MUDDATI TUGAGAN (${new Date(r.expiresAt).toISOString().slice(0, 16)} UTC)`,
      );
    } else {
      const d = daysLeft(r.msLeft);
      const h = hoursLeft(r.msLeft);
      const when = new Date(r.expiresAt).toISOString().slice(0, 16).replace("T", " ");
      lines.push(
        `• <b>${r.label}</b> — ~${d} kun (~${h} soat) qoldi\n  tugash: <code>${when} UTC</code>` +
          (r.hasRefresh ? "\n  (refresh token bor — avtomatik yangilanishi mumkin)" : ""),
      );
    }
  }

  lines.push(
    "",
    "Qayta ulash: lokalda <code>npm run auth -- &lt;platform&gt;</code>",
    "so‘ng <code>data/tokens/*.json</code> ni VDS ga nusxalang.",
  );
  return lines.join("\n");
}

/**
 * Check token expiry and send Telegram once per platform per UTC day when within window.
 * @returns number of platforms newly alerted
 */
export async function checkAndAlertTokenExpiry(): Promise<{
  checked: number;
  alerted: number;
  skipped: number;
}> {
  if (env.TOKEN_ALERT_ENABLED === false) {
    return { checked: 0, alerted: 0, skipped: 0 };
  }
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHANNEL) {
    console.warn("[tokenAlert] Telegram bot/channel missing — skip expiry alerts");
    return { checked: 0, alerted: 0, skipped: 0 };
  }

  const rows = collectExpiringTokens(env.TOKEN_ALERT_DAYS);
  if (rows.length === 0) {
    console.log(
      `[tokenAlert] OK — no tokens within ${env.TOKEN_ALERT_DAYS} day(s)`,
    );
    return { checked: 0, alerted: 0, skipped: 0 };
  }

  const state = loadState();
  const today = utcDay();
  const toSend = rows.filter((r) => state[r.key] !== today);

  if (toSend.length === 0) {
    console.log(
      `[tokenAlert] Already alerted today for: ${rows.map((r) => r.key).join(", ")}`,
    );
    return { checked: rows.length, alerted: 0, skipped: rows.length };
  }

  const text = formatAlertMessage(toSend);
  const result = await sendTelegramAlert(text, env.TELEGRAM_ALERT_CHAT || undefined);

  if (!result.success) {
    console.warn("[tokenAlert] Telegram send failed:", result.error);
    return { checked: rows.length, alerted: 0, skipped: 0 };
  }

  for (const r of toSend) {
    state[r.key] = today;
  }
  saveState(state);
  console.log(
    `[tokenAlert] Sent alert for: ${toSend.map((r) => r.label).join(", ")}`,
  );
  return { checked: rows.length, alerted: toSend.length, skipped: rows.length - toSend.length };
}
