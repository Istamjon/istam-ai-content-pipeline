/**
 * Z.AI GLM-Image — paid high-quality text-to-image.
 * @see https://docs.z.ai/api-reference/image/generate-image
 * @see https://docs.z.ai/guides/image/glm-image
 */
import { env } from "../config/env.js";
import {
  getProviderImageBudget,
  incrementProviderImageUsage,
} from "../db.js";

const PROVIDER = "zai";
const API_URL = "https://api.z.ai/api/paas/v4/images/generations";

/** GLM-Image preferred sizes (multiples of 32, 1024–2048). */
const PRESET_SIZES = [
  "1280x1280",
  "1568x1056",
  "1056x1568",
  "1472x1088",
  "1088x1472",
  "1728x960",
  "960x1728",
] as const;

export function isZaiImageConfigured(): boolean {
  return Boolean(env.ZAI_API_KEY?.trim());
}

export function canUseZaiImageToday(): {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
} {
  if (!isZaiImageConfigured()) {
    return { ok: false, used: 0, limit: 0, remaining: 0 };
  }
  const limit = env.DAILY_ZAI_IMAGE_LIMIT;
  if (limit <= 0) {
    return { ok: true, used: 0, limit: 0, remaining: 999 };
  }
  const b = getProviderImageBudget(PROVIDER, limit);
  return { ok: b.remaining > 0, ...b };
}

export function logZaiImageBudget(): void {
  if (!isZaiImageConfigured()) {
    console.log("[AI] ZAI GLM-Image: not configured (set ZAI_API_KEY)");
    return;
  }
  const b = canUseZaiImageToday();
  console.log(
    `[AI] ZAI GLM-Image: ${b.used}/${b.limit || "∞"} remaining=${b.remaining} model=${env.ZAI_IMAGE_MODEL}`,
  );
}

function pickSize(width: number, height: number): string {
  const forced = (env.ZAI_IMAGE_SIZE || "").trim();
  if (forced && /^\d{3,4}x\d{3,4}$/.test(forced)) return forced;

  // Nearest preset by aspect + area
  const aspect = width / Math.max(1, height);
  let best: string = PRESET_SIZES[0];
  let bestScore = Infinity;
  for (const s of PRESET_SIZES) {
    const [w, h] = s.split("x").map(Number);
    const a = w / h;
    const score =
      Math.abs(a - aspect) * 10 + Math.abs(w * h - width * height) / 1e6;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/**
 * Generate image via Z.AI GLM-Image; returns PNG/JPEG buffer.
 * Response URL is temporary (docs: ~30 days) — we download immediately.
 */
export async function zaiImage(prompt: string): Promise<Buffer> {
  if (!isZaiImageConfigured()) {
    throw new Error("ZAI_API_KEY missing — https://z.ai/manage-apikey/apikey-list");
  }
  const budget = canUseZaiImageToday();
  if (!budget.ok) {
    throw new Error(
      `Z.AI image daily limit ${budget.used}/${budget.limit} (UTC)`,
    );
  }

  const safePrompt = prompt.trim().slice(0, 4000);
  if (!safePrompt) throw new Error("Z.AI image: empty prompt");

  const model = env.ZAI_IMAGE_MODEL || "glm-image";
  const size = pickSize(env.IMAGE_WIDTH || 1024, env.IMAGE_HEIGHT || 1024);
  const quality = env.ZAI_IMAGE_QUALITY === "standard" ? "standard" : "hd";

  console.log(
    `[zai-image] model=${model} size=${size} quality=${quality} promptLen=${safePrompt.length} budget=${budget.used}/${budget.limit || "∞"}`,
  );

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.ZAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: safePrompt,
      size,
      quality,
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const raw = await res.text();
  let json: {
    data?: Array<{ url?: string }>;
    error?: { message?: string; code?: number };
    code?: number;
    message?: string;
  };
  try {
    json = JSON.parse(raw) as typeof json;
  } catch {
    throw new Error(
      `Z.AI image non-JSON ${res.status}: ${raw.slice(0, 200)}`,
    );
  }

  if (!res.ok) {
    const msg =
      json.error?.message ||
      json.message ||
      raw.slice(0, 220);
    throw new Error(`Z.AI image failed HTTP ${res.status}: ${msg}`);
  }

  if (json.code && json.code !== 0 && !json.data?.[0]?.url) {
    throw new Error(
      `Z.AI image error code=${json.code}: ${json.message || raw.slice(0, 200)}`,
    );
  }

  const url = json.data?.[0]?.url;
  if (!url) {
    throw new Error(
      `Z.AI image: no URL in response: ${raw.slice(0, 300)}`,
    );
  }

  const imgRes = await fetch(url, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!imgRes.ok) {
    throw new Error(
      `Z.AI image download failed HTTP ${imgRes.status} url=${url.slice(0, 80)}`,
    );
  }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  if (buf.length < 500) {
    throw new Error(`Z.AI image too small (${buf.length} bytes)`);
  }

  const used = incrementProviderImageUsage(PROVIDER, 1);
  console.log(
    `[zai-image] OK bytes=${buf.length} daily=${used}/${budget.limit || "∞"}`,
  );
  return buf;
}
