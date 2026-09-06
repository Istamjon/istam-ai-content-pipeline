/**
 * UnoRouter Image API — primary text-to-image provider with multi-model fallback.
 * Waterfall order:
 *   1. gpt-image-2:free             — primary user-requested model
 *   2. gpt-image-2                  — standard gpt-image-2
 *   3. glm-image-1:free             — GLM free image model
 *   4. sensenova-6.8-flash-lite:free— SenseNova free image model
 *   5. cogview-4-250304:free        — CogView free image model
 *
 * Supports brand face identity preservation via /images/edits (multipart) or
 * prompt-guided visual identity.
 *
 * On rate limit (429 / 1 req/min) or busy errors, immediately cascades to next model
 * and if all models are exhausted, gracefully cascades to Nano Banana.
 */
import { env } from "../config/env.js";
import {
  getProviderImageBudget,
  incrementProviderImageUsage,
  utcToday,
} from "../db.js";
import type { BrandFaceRef } from "./brandFace.js";

const DEFAULT_MODELS = [
  "gpt-image-2:free",
  "gpt-image-2",
  "glm-image-1:free",
  "sensenova-6.8-flash-lite:free",
  "cogview-4-250304:free",
] as const;

/** Models temporarily paused after rate limit (429) or busy errors */
const exhaustedModels = new Map<string, number>();
const EXHAUSTED_MODEL_TTL_MS = 60 * 1000; // 60s per UnoRouter free tier rules

function pruneExhaustedModels(): void {
  const now = Date.now();
  for (const [model, until] of exhaustedModels) {
    if (until <= now) exhaustedModels.delete(model);
  }
}

function isModelExhausted(model: string): boolean {
  pruneExhaustedModels();
  const until = exhaustedModels.get(model);
  if (!until) return false;
  if (until <= Date.now()) {
    exhaustedModels.delete(model);
    return false;
  }
  return true;
}

function markModelExhausted(model: string, reason: string): void {
  exhaustedModels.set(model, Date.now() + EXHAUSTED_MODEL_TTL_MS);
  console.warn(
    `[unorouter] model "${model}" paused ~60s: ${reason.slice(0, 140)}`,
  );
}

export function isUnorouterConfigured(): boolean {
  const key = (process.env.UNOROUTER_API_KEY || env.UNOROUTER_API_KEY || "").trim();
  return Boolean(key);
}

export function canUseUnorouterToday(): {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
} {
  if (!isUnorouterConfigured()) {
    return { ok: false, used: 0, limit: 0, remaining: 0 };
  }
  const limit = env.DAILY_UNOROUTER_LIMIT;
  if (limit <= 0) {
    return { ok: true, used: 0, limit: 0, remaining: 999 };
  }
  const b = getProviderImageBudget("unorouter", limit);
  return { ok: b.remaining > 0, used: b.used, limit: b.limit, remaining: b.remaining };
}

function resolveModelList(): string[] {
  const custom = (env.UNOROUTER_FALLBACK_MODELS || "")
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const primary = (env.UNOROUTER_IMAGE_MODEL || DEFAULT_MODELS[0]).trim();
  const set = new Set<string>([primary, ...custom, ...DEFAULT_MODELS]);
  return Array.from(set);
}

async function downloadImageBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) {
    throw new Error(`Download HTTP ${res.status}: ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength < 500) {
    throw new Error(`Image too small (${ab.byteLength} bytes)`);
  }
  return Buffer.from(ab);
}

/**
 * Attempt /v1/images/edits with brand face reference image (multipart).
 */
async function tryEditGeneration(
  model: string,
  prompt: string,
  face: BrandFaceRef,
): Promise<Buffer | null> {
  try {
    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(face.buffer)], { type: face.mimeType || "image/jpeg" }),
      "face.jpg",
    );
    form.append("prompt", prompt);
    form.append("model", model);
    form.append("size", "1024x1024");

    const res = await fetch(`${env.UNOROUTER_BASE_URL}/images/edits`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.UNOROUTER_API_KEY}`,
      },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };

    const item = data.data?.[0];
    if (item?.b64_json) {
      return Buffer.from(item.b64_json, "base64");
    }
    if (item?.url) {
      return await downloadImageBuffer(item.url);
    }
  } catch {
    // Fail quietly and fall back to standard text-to-image
  }
  return null;
}

/**
 * Standard /v1/images/generations call.
 */
async function generateOnce(
  model: string,
  prompt: string,
): Promise<Buffer> {
  const body: Record<string, unknown> = {
    model,
    prompt: prompt.slice(0, 3000),
    size: "1024x1024",
    n: 1,
  };

  const res = await fetch(`${env.UNOROUTER_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.UNOROUTER_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const raw = await res.text();
  let json: {
    data?: Array<{ url?: string; b64_json?: string }>;
    error?: { message?: string; code?: string; type?: string };
  } = {};

  try {
    json = JSON.parse(raw);
  } catch {
    // raw text
  }

  if (!res.ok) {
    const msg = json.error?.message || raw.slice(0, 250);
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }

  const item = json.data?.[0];
  if (item?.b64_json) {
    return Buffer.from(item.b64_json, "base64");
  }
  if (item?.url) {
    return await downloadImageBuffer(item.url);
  }

  throw new Error(`No image data in response: ${raw.slice(0, 200)}`);
}

/**
 * Attempt /v1/chat/completions fallback if model emits image URLs in chat response.
 */
async function tryChatGeneration(
  model: string,
  prompt: string,
): Promise<Buffer | null> {
  try {
    const res = await fetch(`${env.UNOROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.UNOROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: `Generate an image: ${prompt.slice(0, 2000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content || "";
    const match =
      content.match(/https?:\/\/[^\s\)\"\']+\.(?:png|jpg|jpeg|webp)/i) ||
      content.match(/\!\[.*?\]\((https?:\/\/[^\)]+)\)/i);
    const url = match ? match[1] || match[0] : null;
    if (url) {
      return await downloadImageBuffer(url);
    }
  } catch {
    // Fail quietly
  }
  return null;
}

export type UnorouterImageOptions = {
  face?: BrandFaceRef | null;
  schematicPrompt?: string;
  workflowPrompt?: string;
};

/**
 * Generate image using UnoRouter with gpt-image-2:free and automatic fallbacks.
 */
export async function unorouterImage(
  prompt: string,
  options?: UnorouterImageOptions,
): Promise<Buffer> {
  if (!isUnorouterConfigured()) {
    throw new Error("UnoRouter: UNOROUTER_API_KEY is not set");
  }

  const budget = canUseUnorouterToday();
  if (!budget.ok) {
    throw new Error(
      `UnoRouter daily budget reached (${budget.used}/${budget.limit})`,
    );
  }

  const allModels = resolveModelList();
  const usableModels = allModels.filter((m) => !isModelExhausted(m));

  console.log(
    `[unorouter] generate day=${utcToday()} models=[${usableModels.join(" → ")}] ` +
      `budget=${budget.used}/${budget.limit || "∞"}` +
      (options?.face ? " (with brand face)" : ""),
  );

  if (usableModels.length === 0) {
    throw new Error(
      `UnoRouter: all models temporarily paused (rate limits/cooling down)`,
    );
  }

  let lastErr: unknown;

  for (const model of usableModels) {
    console.log(`[unorouter] trying model "${model}"...`);

    // 1) If brand face reference is provided, try edit mode first
    if (options?.face?.buffer && (model.includes("gpt-image") || model.includes("edit"))) {
      const editBuf = await tryEditGeneration(model, prompt, options.face);
      if (editBuf) {
        const used = incrementProviderImageUsage("unorouter", 1);
        console.log(
          `[unorouter] OK edit model=${model} bytes=${editBuf.length} daily=${used}/${budget.limit || "∞"}`,
        );
        return editBuf;
      }
    }

    // 2) Standard generations mode
    try {
      const buf = await generateOnce(model, prompt);
      const used = incrementProviderImageUsage("unorouter", 1);
      console.log(
        `[unorouter] OK model=${model} bytes=${buf.length} daily=${used}/${budget.limit || "∞"}`,
      );
      return buf;
    } catch (e) {
      // 3) Try chat/completions fallback if model returns image markdown/url
      const chatBuf = await tryChatGeneration(model, prompt);
      if (chatBuf) {
        const used = incrementProviderImageUsage("unorouter", 1);
        console.log(
          `[unorouter] OK chat-endpoint model=${model} bytes=${chatBuf.length} daily=${used}/${budget.limit || "∞"}`,
        );
        return chatBuf;
      }

      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[unorouter] model "${model}" failed: ${msg.slice(0, 200)}`);

      // Rate limit or busy -> pause this model for 60s and try next
      if (/429|rate limit|busy|retry in|too many requests|quota|insufficient/i.test(msg)) {
        markModelExhausted(model, msg);
        continue;
      }

      // 5xx / temporary error -> pause model briefly and continue
      if (/HTTP 5\d\d|invalid api type|timeout|request_failed/i.test(msg)) {
        markModelExhausted(model, msg);
        continue;
      }
    }
  }

  throw new Error(
    `UnoRouter: all models failed: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

export function logUnorouterBudget(): void {
  if (!isUnorouterConfigured()) {
    console.log("[AI] UNOROUTER: not configured (set UNOROUTER_API_KEY)");
    return;
  }
  const total = canUseUnorouterToday();
  const models = resolveModelList();
  console.log(
    `[AI] UNOROUTER total today (UTC): ${total.used}/${total.limit || "∞"} remaining=${total.remaining} ` +
      `primary=${env.UNOROUTER_IMAGE_MODEL} models=[${models.join(", ")}]`,
  );
  for (const m of models) {
    if (isModelExhausted(m)) console.log(`[AI]   model "${m}" [paused-60s]`);
  }
}
