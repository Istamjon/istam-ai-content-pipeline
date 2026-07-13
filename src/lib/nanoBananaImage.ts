/**
 * Nano Banana — Gemini native image generation with multi-key rotation.
 * On 429 / quota exhaust → next Gemini API key (same models).
 * @see https://ai.google.dev/gemini-api/docs/image-generation
 */
import { env } from "../config/env.js";
import {
  getProviderImageBudget,
  incrementProviderImageUsage,
  type ImageProviderName,
} from "../db.js";

const PROVIDER_BASE = "nanobanana" as const;

/** Prefer free/fast → pro fallback order when primary fails with 404 */
const MODEL_FALLBACKS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
  "gemini-3-pro-image",
];

export type NanoBananaKeySlot = {
  label: string;
  apiKey: string;
  providerKey: ImageProviderName;
};

/** Session-level: keys that hit 429 today — skip without re-calling. */
const exhaustedKeys = new Set<string>();

function parseExtraKeysFromEnv(): string[] {
  const blob = [
    process.env.GEMINI_API_KEYS || "",
    process.env.NANOBANANA_API_KEYS || "",
  ]
    .join(",")
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return blob;
}

/**
 * All Gemini keys for image generation rotation.
 * Order: GEMINI_API_KEY → KEY_2 → KEY_3 → comma-list extras (deduped).
 */
export function getNanoBananaKeySlots(): NanoBananaKeySlot[] {
  const ordered: string[] = [];
  const push = (k: string) => {
    const t = k.trim();
    if (!t) return;
    if (ordered.includes(t)) return;
    ordered.push(t);
  };

  push(env.GEMINI_API_KEY);
  push(env.GEMINI_API_KEY_2);
  push(env.GEMINI_API_KEY_3);
  for (const k of parseExtraKeysFromEnv()) push(k);

  const providerKeys: ImageProviderName[] = [
    "nanobanana",
    "nanobanana2",
    "nanobanana3",
  ];

  return ordered.map((apiKey, i) => ({
    label: `nb${i + 1}`,
    apiKey,
    // Cap named providers at 3 for DB; further keys share last bucket soft-cap
    providerKey: providerKeys[Math.min(i, providerKeys.length - 1)]!,
  }));
}

export function isNanoBananaConfigured(): boolean {
  return getNanoBananaKeySlots().length > 0;
}

export function canUseNanoBananaToday(): {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
  keys: number;
} {
  const slots = getNanoBananaKeySlots();
  if (slots.length === 0) {
    return { ok: false, used: 0, limit: 0, remaining: 0, keys: 0 };
  }
  const perKey = env.DAILY_NANOBANANA_LIMIT;
  if (perKey <= 0) {
    return {
      ok: true,
      used: 0,
      limit: 0,
      remaining: 999,
      keys: slots.length,
    };
  }

  let used = 0;
  let remaining = 0;
  // Aggregate unique provider keys (max 3 tracked)
  const seen = new Set<string>();
  for (const s of slots) {
    if (seen.has(s.providerKey)) continue;
    seen.add(s.providerKey);
    const b = getProviderImageBudget(s.providerKey, perKey);
    used += b.used;
    remaining += b.remaining;
  }
  // Soft total = per-key × unique provider buckets (≈ number of keys, max 3 tracked)
  const limit = perKey * seen.size;
  return { ok: remaining > 0, used, limit, remaining, keys: slots.length };
}

function canUseKeySlot(slot: NanoBananaKeySlot): boolean {
  if (exhaustedKeys.has(slot.apiKey)) return false;
  const perKey = env.DAILY_NANOBANANA_LIMIT;
  if (perKey <= 0) return true;
  const b = getProviderImageBudget(slot.providerKey, perKey);
  return b.remaining > 0;
}

function markKeyExhausted(slot: NanoBananaKeySlot, reason: string): void {
  exhaustedKeys.add(slot.apiKey);
  console.warn(
    `[nanobanana] ${slot.label} exhausted this session: ${reason.slice(0, 120)}`,
  );
}

function extractImageBuffer(json: unknown): Buffer {
  const obj = json as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          inlineData?: { mimeType?: string; data?: string };
          inline_data?: { mime_type?: string; data?: string };
        }>;
      };
    }>;
    error?: { message?: string };
  };
  if (obj.error?.message) {
    throw new Error(obj.error.message);
  }
  const parts = obj.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const data = part.inlineData?.data || part.inline_data?.data;
    if (data && data.length > 100) {
      return Buffer.from(data, "base64");
    }
  }
  throw new Error(
    "Nano Banana: no image in response " + JSON.stringify(json).slice(0, 280),
  );
}

async function generateOnce(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const raw = await res.text();
  let json: unknown = raw;
  try {
    json = JSON.parse(raw);
  } catch {
    /* keep */
  }

  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } })?.error?.message ||
      raw.slice(0, 250);
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return extractImageBuffer(json);
}

/**
 * Generate image via Nano Banana (Gemini image models).
 * Rotates API keys on 429/quota; tries model fallbacks per key.
 */
export async function nanoBananaImage(prompt: string): Promise<Buffer> {
  const slots = getNanoBananaKeySlots();
  if (slots.length === 0) {
    throw new Error(
      "No Gemini keys for Nano Banana (set GEMINI_API_KEY / GEMINI_API_KEY_2 / …)",
    );
  }

  const budget = canUseNanoBananaToday();
  if (!budget.ok) {
    throw new Error(
      `Nano Banana daily limit ${budget.used}/${budget.limit} across ${budget.keys} key(s)`,
    );
  }

  const primary = (env.NANOBANANA_IMAGE_MODEL || MODEL_FALLBACKS[0]).replace(
    /^models\//,
    "",
  );
  const models = [
    primary,
    ...MODEL_FALLBACKS.filter((m) => m !== primary),
  ];

  const safePrompt = prompt.trim().slice(0, 2500);
  const usable = slots.filter(canUseKeySlot);
  console.log(
    `[nanobanana] generate keys=${usable.map((s) => s.label).join("→") || "none"} models=[${models.slice(0, 3).join(",")}] promptLen=${safePrompt.length} budget=${budget.used}/${budget.limit}`,
  );

  if (usable.length === 0) {
    throw new Error("Nano Banana: all keys exhausted or over soft budget");
  }

  let lastErr: unknown;
  for (const slot of usable) {
    console.log(
      `[nanobanana] trying ${slot.label} key=…${slot.apiKey.slice(-6)}`,
    );
    let keyQuotaHit = false;

    for (const model of models) {
      try {
        const buf = await generateOnce(slot.apiKey, model, safePrompt);
        const used = incrementProviderImageUsage(slot.providerKey, 1);
        console.log(
          `[nanobanana] OK ${slot.label} model=${model} bytes=${buf.length} keyDaily=${used}/${env.DAILY_NANOBANANA_LIMIT}`,
        );
        return buf;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `[nanobanana] ${slot.label} model=${model} failed: ${msg.slice(0, 200)}`,
        );
        // 429 / quota → mark key exhausted, rotate to next key
        if (/429|quota|rate limit|RESOURCE_EXHAUSTED|billing/i.test(msg)) {
          markKeyExhausted(slot, msg);
          keyQuotaHit = true;
          break;
        }
        // 401/403 invalid key → skip this key
        if (/HTTP 401|HTTP 403|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) {
          markKeyExhausted(slot, msg);
          keyQuotaHit = true;
          break;
        }
      }
    }

    if (keyQuotaHit) {
      console.log(`[nanobanana] ${slot.label} → next key`);
      continue;
    }
  }

  throw new Error(
    `Nano Banana failed (all keys): ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/** Per-key budget lines for logAllImageBudgets */
export function logNanoBananaBudgets(): void {
  const slots = getNanoBananaKeySlots();
  if (slots.length === 0) {
    console.log(
      "[AI] NANOBANANA: not configured (set GEMINI_API_KEY / GEMINI_API_KEY_2)",
    );
    return;
  }
  const total = canUseNanoBananaToday();
  console.log(
    `[AI] NANOBANANA total today (UTC): ${total.used}/${total.limit} remaining=${total.remaining} keys=${total.keys} model=${env.NANOBANANA_IMAGE_MODEL}`,
  );
  const seen = new Set<string>();
  for (const s of slots) {
    if (seen.has(s.providerKey)) continue;
    seen.add(s.providerKey);
    const b = getProviderImageBudget(s.providerKey, env.DAILY_NANOBANANA_LIMIT);
    const ex = exhaustedKeys.has(s.apiKey) ? " [session-exhausted]" : "";
    console.log(
      `[AI]   ${s.label}: ${b.used}/${b.limit} remaining=${b.remaining} …${s.apiKey.slice(-6)}${ex}`,
    );
  }
}
