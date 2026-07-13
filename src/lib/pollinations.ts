import { env } from "../config/env.js";
import { getAiDailyUsage, incrementAiDailyUsage } from "../db.js";
import {
  canUseGeminiToday,
  geminiText,
  isGeminiConfigured,
} from "./geminiText.js";

/**
 * Text generation entrypoint for the agent pipeline.
 *
 * - Primary: Google Gemini Free Tier (if GEMINI_API_KEY set)
 * - Fallback: Pollinations (openai-fast)
 * - Images: Cloudflare / AI Horde only (not here)
 */

const FREE_TEXT_MODELS = new Set([
  "openai-fast",
  "openai",
  "gpt-5.4-mini",
  "gpt-5-nano",
  "gpt-5.4-nano",
]);

function baseUrl(): string {
  return env.POLLINATIONS_BASE_URL.replace(/\/$/, "");
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (env.POLLINATIONS_API_KEY) {
    headers.Authorization = `Bearer ${env.POLLINATIONS_API_KEY}`;
  }
  return headers;
}

function resolveTextModel(): string {
  const model = env.POLLINATIONS_TEXT_MODEL || "openai-fast";
  if (!FREE_TEXT_MODELS.has(model)) {
    console.warn(
      `[pollinations] Text model "${model}" may not be free-tier; using openai-fast`,
    );
    return "openai-fast";
  }
  return model;
}

function assertWithinDailyLimit(): void {
  const used = getAiDailyUsage();
  const limit = env.POLLINATIONS_DAILY_REQUEST_LIMIT;
  if (used >= limit) {
    throw new Error(
      `Pollinations daily free limit reached (${used}/${limit}). Try again tomorrow.`,
    );
  }
  if (used >= limit * 0.9) {
    console.warn(
      `[pollinations] Daily usage high: ${used}/${limit} (${Math.round((used / limit) * 100)}%)`,
    );
  }
}

function trackRequest(): void {
  const count = incrementAiDailyUsage(1);
  if (count % 100 === 0) {
    console.log(
      `[pollinations] Daily text AI requests: ${count}/${env.POLLINATIONS_DAILY_REQUEST_LIMIT}`,
    );
  }
}

function extractTextFromResponse(data: unknown, rawText: string): string {
  if (typeof data === "string" && data.trim()) {
    return data;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (typeof obj.text === "string" && obj.text.trim()) {
      return obj.text;
    }
    const choices = obj.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const choice = choices[0] as Record<string, unknown>;
      const message = choice.message as Record<string, unknown> | undefined;
      if (message) {
        if (typeof message.content === "string") {
          return message.content;
        }
        if (Array.isArray(message.content)) {
          const parts = message.content as Array<string | { text?: string }>;
          return parts
            .map((p) => (typeof p === "string" ? p : p.text || ""))
            .join("")
            .trim();
        }
      }
      if (typeof choice.text === "string") {
        return choice.text;
      }
    }
    if (typeof obj.content === "string" && obj.content.trim()) {
      return obj.content;
    }
    if (typeof obj.response === "string" && obj.response.trim()) {
      return obj.response;
    }
  }
  if (rawText.trim()) {
    return rawText;
  }
  throw new Error("Pollinations text API returned empty text");
}

async function pollinationsOnly(
  prompt: string,
  systemPrompt?: string,
): Promise<string> {
  assertWithinDailyLimit();

  if (!env.POLLINATIONS_API_KEY) {
    throw new Error(
      "POLLINATIONS_API_KEY is required for text fallback. Create a key at https://enter.pollinations.ai",
    );
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const model = resolveTextModel();
  const url = `${baseUrl()}/v1/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  trackRequest();

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(
      `Pollinations text API failed: ${response.status} ${response.statusText} ${errBody.slice(0, 200)}`,
    );
  }

  const rawText = await response.text();
  let data: unknown = rawText;
  try {
    data = JSON.parse(rawText);
  } catch {
    // plain text is fine
  }

  return extractTextFromResponse(data, rawText).trim();
}

/**
 * Text generation: user prompt + optional system role.
 * Used by analyze, rewrite, quality, translate.
 * Order: Gemini Free → Pollinations (unless TEXT_PROVIDER forces one).
 */
export async function pollinationsText(
  prompt: string,
  systemPrompt?: string,
): Promise<string> {
  const mode = env.TEXT_PROVIDER || "auto";
  const wantGemini =
    mode === "gemini" ||
    (mode === "auto" && isGeminiConfigured() && canUseGeminiToday().ok);
  const wantPollinations = mode === "pollinations" || mode === "auto";

  if (wantGemini && isGeminiConfigured()) {
    try {
      return await geminiText(prompt, systemPrompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (mode === "gemini") throw e;
      console.warn(
        `[text] Gemini failed → Pollinations: ${msg.slice(0, 180)}`,
      );
    }
  }

  if (wantPollinations || mode === "pollinations") {
    return pollinationsOnly(prompt, systemPrompt);
  }

  throw new Error(
    "No text provider available. Set GEMINI_API_KEY and/or POLLINATIONS_API_KEY",
  );
}

/**
 * @deprecated Images use Cloudflare FLUX.2-dev only. Never call for production.
 */
export async function pollinationsImage(_prompt: string): Promise<Buffer> {
  throw new Error(
    "pollinationsImage disabled. Images = Cloudflare FLUX.2-dev (lib/cloudflareImage.ts)",
  );
}

/** Usage snapshot — text=Gemini|Pollinations, image=Cloudflare */
export function getPollinationsUsage(): {
  used: number;
  limit: number;
  remaining: number;
  textModel: string;
  imageProvider: string;
  imageModel: string;
  textProvider: string;
} {
  const used = getAiDailyUsage();
  const limit = env.POLLINATIONS_DAILY_REQUEST_LIMIT;
  const geminiOn = isGeminiConfigured() && (env.TEXT_PROVIDER || "auto") !== "pollinations";
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    textModel: geminiOn
      ? `gemini:${env.GEMINI_MODEL}`
      : resolveTextModel(),
    textProvider: geminiOn ? "gemini→pollinations" : "pollinations",
    imageProvider: "cloudflare",
    imageModel: env.CLOUDFLARE_IMAGE_MODEL,
  };
}
