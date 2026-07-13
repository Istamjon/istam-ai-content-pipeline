/**
 * Nano Banana — Gemini native image generation
 * Better on-image text than FLUX free models.
 * @see https://ai.google.dev/gemini-api/docs/image-generation
 * @see https://aistudio.google.com/models/nano-banana
 */
import { env } from "../config/env.js";
import {
  getProviderImageBudget,
  incrementProviderImageUsage,
} from "../db.js";

const PROVIDER = "nanobanana" as const;

/** Prefer free/fast → pro fallback order when primary fails with 404 */
const MODEL_FALLBACKS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image",
  "gemini-3.1-flash-lite-image",
  "gemini-3-pro-image",
];

export function isNanoBananaConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY?.trim());
}

export function canUseNanoBananaToday(): {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
} {
  if (!isNanoBananaConfigured()) {
    return { ok: false, used: 0, limit: 0, remaining: 0 };
  }
  const limit = env.DAILY_NANOBANANA_LIMIT;
  if (limit <= 0) {
    return { ok: true, used: 0, limit: 0, remaining: 999 };
  }
  const b = getProviderImageBudget(PROVIDER, limit);
  return { ok: b.remaining > 0, ...b };
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
    const data =
      part.inlineData?.data ||
      part.inline_data?.data;
    if (data && data.length > 100) {
      return Buffer.from(data, "base64");
    }
  }
  throw new Error(
    "Nano Banana: no image in response " + JSON.stringify(json).slice(0, 280),
  );
}

async function generateOnce(
  model: string,
  prompt: string,
): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
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
        // Some models accept image size hints via config; ignore if unsupported
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
 * Tries primary model then free fallbacks.
 */
export async function nanoBananaImage(prompt: string): Promise<Buffer> {
  if (!isNanoBananaConfigured()) {
    throw new Error("GEMINI_API_KEY missing for Nano Banana");
  }
  const budget = canUseNanoBananaToday();
  if (!budget.ok) {
    throw new Error(
      `Nano Banana daily limit ${budget.used}/${budget.limit}`,
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
  console.log(
    `[nanobanana] generate models=[${models.slice(0, 3).join(",")}] promptLen=${safePrompt.length} budget=${budget.used}/${budget.limit}`,
  );

  let lastErr: unknown;
  for (const model of models) {
    try {
      const buf = await generateOnce(model, safePrompt);
      const used = incrementProviderImageUsage(PROVIDER, 1);
      console.log(
        `[nanobanana] OK model=${model} bytes=${buf.length} daily=${used}/${env.DAILY_NANOBANANA_LIMIT}`,
      );
      return buf;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[nanobanana] model=${model} failed: ${msg.slice(0, 200)}`,
      );
      // 429 / quota → stop trying more models (same key quota)
      if (/429|quota|rate limit|RESOURCE_EXHAUSTED/i.test(msg)) {
        break;
      }
    }
  }

  throw new Error(
    `Nano Banana failed: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}
