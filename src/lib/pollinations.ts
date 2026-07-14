import { env } from "../config/env.js";
import {
  getAiDailyUsage,
  getProviderImageBudget,
  incrementAiDailyUsage,
  incrementProviderImageUsage,
} from "../db.js";
import {
  canUseGeminiToday,
  geminiText,
  isGeminiConfigured,
} from "./geminiText.js";

/**
 * Text + image via Pollinations.
 *
 * - TEXT: Gemini Free (primary) → Pollinations openai-fast
 * - IMAGE: gpt-image-2 (waterfall after Nano Banana)
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

const POLLINATIONS_IMAGE_PROVIDER = "pollinations";

export function isPollinationsImageConfigured(): boolean {
  return Boolean(env.POLLINATIONS_API_KEY);
}

export function canUsePollinationsImageToday(): {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
} {
  const limit = env.DAILY_POLLINATIONS_IMAGE_LIMIT;
  if (limit <= 0) {
    return { ok: true, used: 0, limit: 0, remaining: 999 };
  }
  const b = getProviderImageBudget(POLLINATIONS_IMAGE_PROVIDER, limit);
  return { ok: b.remaining > 0, used: b.used, limit: b.limit, remaining: b.remaining };
}

/**
 * Pollinations text-to-image (default model: gpt-image-2).
 * Used in the image waterfall right after Nano Banana fails.
 * @see https://gen.pollinations.ai/image/{prompt}?model=gpt-image-2
 */
export async function pollinationsImage(prompt: string): Promise<Buffer> {
  if (!env.POLLINATIONS_API_KEY) {
    throw new Error(
      "POLLINATIONS_API_KEY required for gpt-image-2. Get a key at https://enter.pollinations.ai",
    );
  }

  const budget = canUsePollinationsImageToday();
  if (!budget.ok) {
    throw new Error(
      `Pollinations image daily limit ${budget.used}/${budget.limit} (UTC)`,
    );
  }

  const model = env.POLLINATIONS_IMAGE_MODEL || "gpt-image-2";
  const width = Math.min(2048, Math.max(256, env.IMAGE_WIDTH || 1024));
  const height = Math.min(2048, Math.max(256, env.IMAGE_HEIGHT || 1024));
  const safePrompt = prompt.trim().slice(0, 2000);
  if (!safePrompt) throw new Error("Pollinations image: empty prompt");

  // GET /image/{prompt}?model=&width=&height=&key=
  const params = new URLSearchParams({
    model,
    width: String(width),
    height: String(height),
    nologo: "true",
    enhance: "false",
    key: env.POLLINATIONS_API_KEY,
  });
  const url =
    `${baseUrl()}/image/${encodeURIComponent(safePrompt)}?${params.toString()}`;

  console.log(
    `[pollinations-image] model=${model} ${width}x${height} promptLen=${safePrompt.length} budget=${budget.used}/${budget.limit || "∞"}`,
  );

  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders({ Accept: "image/*" }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(
      `Pollinations image failed: ${response.status} ${response.statusText} ${errBody.slice(0, 220)}`,
    );
  }

  const ctype = (response.headers.get("content-type") || "").toLowerCase();
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length < 500) {
    const peek = buf.toString("utf8").slice(0, 200);
    throw new Error(
      `Pollinations image too small (${buf.length}b) content-type=${ctype} body=${peek}`,
    );
  }
  // Reject JSON error payloads disguised as 200
  if (ctype.includes("json") || ctype.includes("text")) {
    throw new Error(
      `Pollinations image returned non-image (${ctype}): ${buf.toString("utf8").slice(0, 200)}`,
    );
  }

  trackRequest();
  const used = incrementProviderImageUsage(POLLINATIONS_IMAGE_PROVIDER, 1);
  console.log(
    `[pollinations-image] OK model=${model} bytes=${buf.length} daily=${used}/${budget.limit || "∞"}`,
  );
  return buf;
}

export function logPollinationsImageBudget(): void {
  if (!isPollinationsImageConfigured()) {
    console.log("[AI] POLLINATIONS image: not configured (set POLLINATIONS_API_KEY)");
    return;
  }
  const b = canUsePollinationsImageToday();
  console.log(
    `[AI] POLLINATIONS image (${env.POLLINATIONS_IMAGE_MODEL}): ${b.used}/${b.limit || "∞"} remaining=${b.remaining}`,
  );
}

/** Usage snapshot — text=Gemini|Pollinations, image waterfall includes gpt-image-2 */
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
    imageProvider: "nanobanana→pollinations→cloudflare→horde",
    imageModel: env.POLLINATIONS_IMAGE_MODEL || "gpt-image-2",
  };
}
