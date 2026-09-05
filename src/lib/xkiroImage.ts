/**
 * xKiro Image API — async job-based text-to-image.
 * Multi-MODEL waterfall: tries each model in order; on limit/failure → next model.
 * Multi-KEY rotation: multiple API keys per model.
 *
 * Model priority order (all free tier):
 *   1. sensenova/sensenova-u1.5-lite     — confirmed working
 *   2. sensenova/sensenova-6.8-flash-lite
 *   3. minimax/minimax-m3:free
 *   4. qwen/qwen3.8-max:free
 *
 * Flow:
 *   POST /v1/images/generations → 202 { id }
 *   GET  /v1/images/generations/{id} → { status: 'succeeded', data: [{ url }] }
 *
 * @see https://docs.xkiro.com/api/images/
 */
import { env } from "../config/env.js";
import {
  getProviderImageBudget,
  incrementProviderImageUsage,
  utcToday,
  type ImageProviderName,
} from "../db.js";

const XKIRO_BASE = "https://api.xkiro.com/v1";

/** Free image models — tried in order. Override with XKIRO_IMAGE_MODELS env var. */
const DEFAULT_MODEL_WATERFALL = [
  "sensenova/sensenova-u1.5-lite",
  "sensenova/sensenova-6.8-flash-lite",
  "minimax/minimax-m3:free",
  "qwen/qwen3.8-max:free",
] as const;

/** Valid sizes for xKiro image generation. */
const VALID_SIZES = new Set([
  "256x256",
  "512x512",
  "1024x1024",
  "1024x1792",
  "1792x1024",
]);

export type XkiroKeySlot = {
  label: string;
  apiKey: string;
  providerKey: ImageProviderName;
};

/** Keys temporarily skipped after quota/auth failures. */
const exhaustedKeys = new Map<string, number>();
const EXHAUSTED_KEY_TTL_MS = 45 * 60 * 1000;

/** Models temporarily skipped (server errors or no image capability). */
const exhaustedModels = new Map<string, number>();
const EXHAUSTED_MODEL_TTL_MS = 30 * 60 * 1000;

function pruneExhausted(): void {
  const now = Date.now();
  for (const [k, until] of exhaustedKeys) {
    if (until <= now) exhaustedKeys.delete(k);
  }
  for (const [m, until] of exhaustedModels) {
    if (until <= now) exhaustedModels.delete(m);
  }
}

function isKeyExhausted(apiKey: string): boolean {
  pruneExhausted();
  const until = exhaustedKeys.get(apiKey);
  if (!until) return false;
  if (until <= Date.now()) { exhaustedKeys.delete(apiKey); return false; }
  return true;
}

function isModelExhausted(model: string): boolean {
  const until = exhaustedModels.get(model);
  if (!until) return false;
  if (until <= Date.now()) { exhaustedModels.delete(model); return false; }
  return true;
}

function markKeyExhausted(slot: XkiroKeySlot, reason: string): void {
  exhaustedKeys.set(slot.apiKey, Date.now() + EXHAUSTED_KEY_TTL_MS);
  console.warn(
    `[xkiro] key ${slot.label} paused ~${Math.round(EXHAUSTED_KEY_TTL_MS / 60_000)}m: ${reason.slice(0, 120)}`,
  );
}

function markModelExhausted(model: string, reason: string): void {
  exhaustedModels.set(model, Date.now() + EXHAUSTED_MODEL_TTL_MS);
  console.warn(
    `[xkiro] model "${model.split("/").pop()}" paused ~${Math.round(EXHAUSTED_MODEL_TTL_MS / 60_000)}m: ${reason.slice(0, 120)}`,
  );
}

function parseExtraKeys(): string[] {
  return (process.env.XKIRO_API_KEYS || "")
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function xkiroProviderKey(index: number): ImageProviderName {
  if (index === 0) return "xkiro";
  if (index === 1) return "xkiro2";
  if (index === 2) return "xkiro3";
  if (index === 3) return "xkiro4";
  return `xkiro${index + 1}` as ImageProviderName;
}

export function getXkiroKeySlots(): XkiroKeySlot[] {
  const ordered: string[] = [];
  const push = (k: string) => {
    const t = k.trim();
    if (!t || ordered.includes(t)) return;
    ordered.push(t);
  };
  push(env.XKIRO_API_KEY);
  push(env.XKIRO_API_KEY_2);
  push(env.XKIRO_API_KEY_3);
  for (const k of parseExtraKeys()) push(k);
  return ordered.map((apiKey, i) => ({
    label: `xk${i + 1}`,
    apiKey,
    providerKey: xkiroProviderKey(i),
  }));
}

/**
 * Resolve model waterfall from env.
 * XKIRO_IMAGE_MODELS=m1,m2,...  → explicit waterfall
 * XKIRO_IMAGE_MODEL=m1          → m1 first, then defaults
 * (nothing)                     → DEFAULT_MODEL_WATERFALL
 */
function resolveModelWaterfall(): string[] {
  const multi = (process.env.XKIRO_IMAGE_MODELS || "")
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (multi.length > 0) return multi;

  const single = env.XKIRO_IMAGE_MODEL?.trim();
  if (single) {
    const rest = DEFAULT_MODEL_WATERFALL.filter((m) => m !== single);
    return [single, ...rest];
  }
  return [...DEFAULT_MODEL_WATERFALL];
}

export function isXkiroConfigured(): boolean {
  return getXkiroKeySlots().length > 0;
}

export function canUseXkiroToday(): {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
  keys: number;
} {
  const slots = getXkiroKeySlots();
  if (slots.length === 0) {
    return { ok: false, used: 0, limit: 0, remaining: 0, keys: 0 };
  }
  const perKey = env.DAILY_XKIRO_LIMIT;
  if (perKey <= 0) {
    return { ok: true, used: 0, limit: 0, remaining: 999, keys: slots.length };
  }
  let used = 0;
  let remaining = 0;
  const seen = new Set<string>();
  for (const s of slots) {
    if (seen.has(s.providerKey)) continue;
    seen.add(s.providerKey);
    const b = getProviderImageBudget(s.providerKey, perKey);
    used += b.used;
    remaining += b.remaining;
  }
  return { ok: remaining > 0, used, limit: perKey * seen.size, remaining, keys: slots.length };
}

function resolveSize(): string {
  const raw = (env.XKIRO_IMAGE_SIZE || "1024x1024").trim();
  return VALID_SIZES.has(raw) ? raw : "1024x1024";
}

function isRotatableKeyFailure(msg: string): boolean {
  return /insufficient|credit|quota|429|rate limit|RESOURCE_EXHAUSTED|billing|401|403|unauthorized|forbidden|top up|wallet|balance|permission/i.test(msg);
}

function isRotatableModelFailure(msg: string): boolean {
  return /not_found|does not exist|not support|cannot.*image|invalid.*model|model.*invalid|unsupported|model.*not|not.*model|not an image|text only/i.test(
    msg,
  );
}

function isTransientFailure(msg: string): boolean {
  return /timeout|ECONNRESET|ENOTFOUND|fetch failed|HTTP 5\d\d|network|aborted|UND_ERR/i.test(msg);
}

/** Create async image job → returns job ID. */
async function createJob(
  slot: XkiroKeySlot,
  model: string,
  prompt: string,
  size: string,
): Promise<string> {
  const res = await fetch(`${XKIRO_BASE}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${slot.apiKey}`,
    },
    body: JSON.stringify({ model, prompt, n: 1, size }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 400)}`);
  }

  const job = (await res.json()) as { id?: string };
  if (!job.id) {
    throw new Error(`No job ID: ${JSON.stringify(job).slice(0, 200)}`);
  }
  return job.id;
}

/** Poll GET /v1/images/generations/{id} until succeeded/failed. Max ~3 min. */
async function pollJob(
  slot: XkiroKeySlot,
  jobId: string,
  modelShort: string,
): Promise<string> {
  const maxAttempts = 36; // 3 minutes (36 × 5s)

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5_000));

    const res = await fetch(`${XKIRO_BASE}/images/generations/${jobId}`, {
      headers: { Authorization: `Bearer ${slot.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Poll HTTP ${res.status}: ${t.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      status?: string;
      data?: Array<{ url?: string }>;
      error?: unknown;
    };

    if (i % 3 === 0) {
      console.log(
        `[xkiro] ${slot.label}/${modelShort} poll ${i + 1}/${maxAttempts} status=${data.status ?? "?"}`,
      );
    }

    if (data.status === "completed" || data.status === "succeeded") {
      const url = data.data?.[0]?.url;
      if (url) return url;
      // URL may arrive on next tick — continue polling briefly
      continue;
    }
    if (data.status === "failed") {
      throw new Error(`Job failed: ${JSON.stringify(data.error ?? data).slice(0, 200)}`);
    }
  }
  throw new Error(`xKiro job ${jobId} timed out after ${(36 * 5000) / 1000}s`);
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  if (ab.byteLength < 500) throw new Error(`Image too small: ${ab.byteLength}b`);
  return Buffer.from(ab);
}

/**
 * Generate image with xKiro — multi-MODEL + multi-KEY waterfall.
 *
 * Outer loop: models (sensenova → sensenova-lite → minimax → qwen).
 * Inner loop: API keys.
 *
 * On key quota/auth error  → pause key, try next key (same model).
 * On model not-found/unsupported → pause model, break to next model.
 * On transient/unknown error → try next key, then next model.
 */
export async function xkiroImage(prompt: string): Promise<Buffer> {
  const allSlots = getXkiroKeySlots();
  if (allSlots.length === 0) throw new Error("No xKiro keys (set XKIRO_API_KEY)");

  const budget = canUseXkiroToday();
  if (!budget.ok) {
    throw new Error(
      `xKiro daily limit ${budget.used}/${budget.limit} exhausted`,
    );
  }

  const safePrompt = prompt.trim().slice(0, 4000);
  if (!safePrompt) throw new Error("xKiro: empty prompt");

  const size = resolveSize();
  const models = resolveModelWaterfall();
  const perKey = env.DAILY_XKIRO_LIMIT;

  const usableSlots = allSlots.filter((s) => {
    if (isKeyExhausted(s.apiKey)) return false;
    return perKey <= 0 || getProviderImageBudget(s.providerKey, perKey).remaining > 0;
  });
  const usableModels = models.filter((m) => !isModelExhausted(m));

  console.log(
    `[xkiro] day=${utcToday()} models=[${usableModels.map((m) => m.split("/").pop()).join("→")}] ` +
      `keys=${usableSlots.length}/${allSlots.length} budget=${budget.used}/${budget.limit || "∞"}`,
  );

  if (usableSlots.length === 0) {
    throw new Error(`xKiro: all keys exhausted (${budget.used}/${budget.limit || "∞"})`);
  }
  if (usableModels.length === 0) {
    throw new Error("xKiro: all models temporarily paused");
  }

  let lastErr: unknown;

  for (const model of usableModels) {
    const modelShort = model.split("/").pop() ?? model;
    let modelBroken = false;

    for (const slot of usableSlots) {
      if (isKeyExhausted(slot.apiKey)) continue;

      console.log(`[xkiro] → model=${modelShort} key=${slot.label}`);
      try {
        const jobId = await createJob(slot, model, safePrompt, size);
        console.log(`[xkiro] job=${jobId}`);

        const imageUrl = await pollJob(slot, jobId, modelShort);
        const buffer = await downloadBuffer(imageUrl);

        const used = incrementProviderImageUsage(slot.providerKey, 1);
        console.log(
          `[xkiro] ✅ model=${modelShort} key=${slot.label} bytes=${buffer.length} daily=${used}/${perKey || "∞"}`,
        );
        return buffer;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[xkiro] ✗ ${slot.label}/${modelShort}: ${msg.slice(0, 180)}`);

        if (isRotatableKeyFailure(msg)) {
          markKeyExhausted(slot, msg);
          continue; // next key, same model
        }
        if (isRotatableModelFailure(msg)) {
          markModelExhausted(model, msg);
          modelBroken = true;
          break; // next model
        }
        // transient or unknown → try next key
        continue;
      }
    }

    if (modelBroken) continue; // model is bad → next model in waterfall
  }

  throw new Error(
    `xKiro: all models+keys failed (${utcToday()}): ${
      lastErr instanceof Error ? lastErr.message.slice(0, 200) : String(lastErr)
    }`,
  );
}

export function logXkiroBudget(): void {
  const slots = getXkiroKeySlots();
  if (slots.length === 0) {
    console.log("[AI] XKIRO: not configured (set XKIRO_API_KEY)");
    return;
  }
  const total = canUseXkiroToday();
  const models = resolveModelWaterfall();
  console.log(
    `[AI] XKIRO budget (UTC): ${total.used}/${total.limit || "∞"} remaining=${total.remaining} keys=${total.keys}`,
  );
  console.log(`[AI] XKIRO waterfall: [${models.map((m) => m.split("/").pop()).join(" → ")}]`);
  const seen = new Set<string>();
  for (const s of slots) {
    if (seen.has(s.providerKey)) continue;
    seen.add(s.providerKey);
    const b = getProviderImageBudget(s.providerKey, env.DAILY_XKIRO_LIMIT);
    const paused = isKeyExhausted(s.apiKey) ? " [paused]" : "";
    console.log(
      `[AI]   ${s.label}: ${b.used}/${b.limit || "∞"} remaining=${b.remaining} …${s.apiKey.slice(-6)}${paused}`,
    );
  }
  for (const m of models) {
    if (isModelExhausted(m)) console.log(`[AI]   model "${m.split("/").pop()}" [paused]`);
  }
}
