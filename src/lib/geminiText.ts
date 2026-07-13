/**
 * Google Gemini API — Free Tier text generation
 * @see https://ai.google.dev/gemini-api/docs
 */
import { env } from "../config/env.js";
import {
  getProviderImageBudget,
  incrementProviderImageUsage,
  type ImageProviderName,
} from "../db.js";

/** Reuse provider usage table with a dedicated name (text, not image). */
const GEMINI_USAGE_KEY = "gemini" as ImageProviderName;

export function isGeminiConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY?.trim());
}

export function canUseGeminiToday(): {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
} {
  if (!isGeminiConfigured()) {
    return { ok: false, used: 0, limit: 0, remaining: 0 };
  }
  const limit = env.DAILY_GEMINI_LIMIT;
  if (limit <= 0) {
    return { ok: true, used: 0, limit: 0, remaining: 999 };
  }
  // Borrow image_provider_usage for soft daily count (date+provider)
  const b = getProviderImageBudget(GEMINI_USAGE_KEY, limit);
  return { ok: b.remaining > 0, ...b };
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
 * generateContent with optional system instruction.
 */
export async function geminiText(
  prompt: string,
  systemPrompt?: string,
): Promise<string> {
  if (!isGeminiConfigured()) {
    throw new Error("GEMINI_API_KEY missing");
  }
  const budget = canUseGeminiToday();
  if (!budget.ok) {
    throw new Error(
      `Gemini soft daily limit ${budget.used}/${budget.limit} (UTC)`,
    );
  }

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
      "x-goog-api-key": env.GEMINI_API_KEY,
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

  const text = extractText(json);
  if (env.DAILY_GEMINI_LIMIT > 0) {
    const used = incrementProviderImageUsage(GEMINI_USAGE_KEY, 1);
    if (used % 10 === 0 || used === 1) {
      console.log(
        `[gemini] soft daily usage ${used}/${env.DAILY_GEMINI_LIMIT} (UTC)`,
      );
    }
  }
  return text;
}
