/**
 * Google Gemini API — Free Tier text generation (sole text provider).
 * @see https://ai.google.dev/gemini-api/docs
 *
 * Multi-key rotation (GEMINI_API_KEY, _2, _3):
 * - Each key gets its own soft daily budget (DAILY_GEMINI_LIMIT per key, UTC)
 * - Daily start offset so key #1 is not always first after midnight reset
 * - Per-key quota/HTTP failure → next key, then hard error
 *
 * Pollinations was removed from the project (2026-09): text is Gemini-only.
 */
import { env } from "../config/env.js";
import {
  getProviderImageBudget,
  incrementProviderImageUsage,
  type ImageProviderName,
} from "../db.js";
import {
  orderSlotsForDailyRotation,
  formatRotationOrder,
  type RotatableSlot,
} from "./keyRotation.js";

type GeminiSlot = RotatableSlot;

/** Per-key soft usage slots in the shared provider usage table. */
const SLOT_PROVIDER_KEYS: ImageProviderName[] = [
  "gemini",
  "gemini2",
  "gemini3",
];

/** Configured Gemini keys in priority order (deduped, trimmed). */
function geminiSlots(): GeminiSlot[] {
  const keys = [
    env.GEMINI_API_KEY,
    env.GEMINI_API_KEY_2,
    env.GEMINI_API_KEY_3,
  ]
    .map((k) => (k || "").trim())
    .filter(Boolean);
  return keys.map((apiKey, i) => ({
    label: `gemini#${i + 1}`,
    providerKey:
      SLOT_PROVIDER_KEYS[i] ?? (`gemini${i + 1}` as ImageProviderName),
    apiKey,
  }));
}

export function isGeminiConfigured(): boolean {
  return geminiSlots().length > 0;
}

function slotBudget(slot: GeminiSlot): {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
} {
  const limit = env.DAILY_GEMINI_LIMIT;
  if (limit <= 0) {
    return { ok: true, used: 0, limit: 0, remaining: 999 };
  }
  // Borrow provider usage table for a soft daily count (date+provider).
  const b = getProviderImageBudget(slot.providerKey, limit);
  return { ok: b.remaining > 0, ...b };
}

/**
 * Aggregated budget across all configured keys.
 * ok = at least one key still has soft budget remaining.
 */
export function canUseGeminiToday(): {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
  slots: number;
} {
  const slots = geminiSlots();
  if (!slots.length) {
    return { ok: false, used: 0, limit: 0, remaining: 0, slots: 0 };
  }
  const budgets = slots.map(slotBudget);
  const used = budgets.reduce((s, b) => s + b.used, 0);
  const remaining = budgets.reduce((s, b) => s + Math.max(0, b.remaining), 0);
  const limit =
    env.DAILY_GEMINI_LIMIT > 0 ? env.DAILY_GEMINI_LIMIT * slots.length : 0;
  return {
    ok: limit === 0 || remaining > 0,
    used,
    limit,
    remaining,
    slots: slots.length,
  };
}

function extractText(json: unknown): string {
  const obj = json as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    error?: { message?: string };
  };
  if (obj.error?.message) {
    throw new Error(obj.error.message);
  }
  const parts = obj.candidates?.[0]?.content?.parts;
  if (!parts?.length) {
    throw new Error(
      "Gemini empty response: " + JSON.stringify(json).slice(0, 200),
    );
  }
  const text = parts
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) {
    throw new Error("Gemini returned empty text parts");
  }
  return text;
}

/**
 * Text generation: user prompt + optional system role.
 * Tries configured Gemini keys in daily-rotated order until one succeeds.
 */
export async function generateText(
  prompt: string,
  systemPrompt?: string,
): Promise<string> {
  const slots = geminiSlots();
  if (!slots.length) {
    throw new Error("GEMINI_API_KEY missing");
  }

  const ordered = orderSlotsForDailyRotation(
    slots,
    (s) => slotBudget(s).remaining,
    "text",
  );
  console.log(
    `[text] keys=${slots.length} order=${formatRotationOrder(ordered, (label) => {
      const slot = ordered.find((s) => s.label === label);
      return slot ? slotBudget(slot).remaining : 0;
    })}`,
  );

  let lastErr: unknown;
  let tried = 0;
  for (const slot of ordered) {
    const budget = slotBudget(slot);
    if (!budget.ok) {
      console.warn(
        `[text] ${slot.label} soft daily limit ${budget.used}/${budget.limit} (UTC) — next key`,
      );
      continue;
    }
    tried += 1;
    try {
      const text = await geminiGenerate(slot.apiKey, prompt, systemPrompt);
      if (env.DAILY_GEMINI_LIMIT > 0) {
        const used = incrementProviderImageUsage(slot.providerKey, 1);
        if (used % 10 === 0 || used === 1) {
          console.log(
            `[gemini] ${slot.label} soft daily usage ${used}/${env.DAILY_GEMINI_LIMIT} (UTC)`,
          );
        }
      }
      return text;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[text] ${slot.label} failed → next key: ${msg.slice(0, 180)}`,
      );
    }
  }

  if (tried === 0) {
    throw new Error(
      `Gemini soft daily limit exhausted on all ${slots.length} key(s) ` +
        `(${env.DAILY_GEMINI_LIMIT}/key UTC) — resets at 00:00 UTC`,
    );
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr || "Gemini text generation failed"));
}

/**
 * generateContent with optional system instruction (single key).
 */
async function geminiGenerate(
  apiKey: string,
  prompt: string,
  systemPrompt?: string,
): Promise<string> {
  const model = (env.GEMINI_MODEL || "gemini-flash-lite-latest").replace(
    /^models\//,
    "",
  );
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 4096,
    },
  };
  if (systemPrompt?.trim()) {
    body.system_instruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  console.log(
    `[gemini] model=${model} promptLen=${prompt.length} sys=${systemPrompt ? systemPrompt.length : 0}`,
  );

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
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
    throw new Error(`Gemini HTTP ${res.status}: ${msg}`);
  }

  return extractText(json);
}

/** Startup/dry-run budget report (mirrors image provider budget logs). */
export function logGeminiTextBudget(): void {
  const slots = geminiSlots();
  if (!slots.length) {
    console.log("[AI] Gemini text: not configured (set GEMINI_API_KEY)");
    return;
  }
  for (const slot of slots) {
    const b = slotBudget(slot);
    console.log(
      `[AI] Gemini text ${slot.label}: ${b.used}/${b.limit || "∞"} remaining=${b.remaining}`,
    );
  }
}

/** Usage snapshot for the DRY_RUN pipeline result dump. */
export function getGeminiTextUsage(): {
  keys: number;
  used: number;
  limit: number;
  remaining: number;
  model: string;
} {
  const agg = canUseGeminiToday();
  return {
    keys: agg.slots,
    used: agg.used,
    limit: agg.limit,
    remaining: agg.remaining,
    model: env.GEMINI_MODEL || "gemini-flash-lite-latest",
  };
}
