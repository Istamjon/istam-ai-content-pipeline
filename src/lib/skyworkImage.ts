/**
 * Skywork Image API — text-to-image via theme-gateway SSE.
 * Multi-key rotation: on credits/429/auth fail → next key.
 * @see https://github.com/SkyworkAI/Skywork-Skills (skywork-design)
 */
import { env } from "../config/env.js";
import {
  getProviderImageBudget,
  incrementProviderImageUsage,
  type ImageProviderName,
} from "../db.js";

const DEFAULT_GATEWAY = "https://api-tools.skywork.ai/theme-gateway";

const VALID_ASPECT = new Set([
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
]);

export type SkyworkKeySlot = {
  label: string;
  apiKey: string;
  providerKey: ImageProviderName;
};

/**
 * Keys temporarily skipped after credits/429/auth failures.
 * Map: apiKey → exhausted-until epoch ms.
 */
const exhaustedKeys = new Map<string, number>();
let exhaustedDayKey = "";
/** Temporary ban after credit/quota/auth (not forever for the process life). */
const EXHAUSTED_TTL_MS = 45 * 60 * 1000;

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function pruneExhaustedKeys(): void {
  const day = utcDayKey();
  if (exhaustedDayKey !== day) {
    exhaustedKeys.clear();
    exhaustedDayKey = day;
    return;
  }
  const now = Date.now();
  for (const [key, until] of exhaustedKeys) {
    if (until <= now) exhaustedKeys.delete(key);
  }
}

function isKeyExhausted(apiKey: string): boolean {
  pruneExhaustedKeys();
  const until = exhaustedKeys.get(apiKey);
  if (until === undefined) return false;
  if (until <= Date.now()) {
    exhaustedKeys.delete(apiKey);
    return false;
  }
  return true;
}

function markKeyExhausted(slot: SkyworkKeySlot, reason: string): void {
  pruneExhaustedKeys();
  const until = Date.now() + EXHAUSTED_TTL_MS;
  exhaustedKeys.set(slot.apiKey, until);
  const mins = Math.round(EXHAUSTED_TTL_MS / 60_000);
  console.warn(
    `[skywork] ${slot.label} paused ~${mins}m (until ${new Date(until).toISOString()}): ${reason.slice(0, 140)}`,
  );
}

function parseExtraKeysFromEnv(): string[] {
  const blob = [process.env.SKYWORK_API_KEYS || ""]
    .join(",")
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return blob;
}

/** Soft-budget provider id: skywork, skywork2, … or skywork_<suffix>. */
function skyworkProviderKey(index: number, apiKey: string): ImageProviderName {
  if (index === 0) return "skywork";
  if (index === 1) return "skywork2";
  if (index === 2) return "skywork3";
  if (index === 3) return "skywork4";
  if (index === 4) return "skywork5";
  const suffix =
    apiKey.slice(-8).replace(/[^a-zA-Z0-9]/g, "") || String(index + 1);
  return `skywork_${suffix}`;
}

/**
 * All Skywork keys for image rotation.
 * Order: SKYWORK_API_KEY → KEY_2…KEY_5 → comma-list SKYWORK_API_KEYS (deduped).
 */
export function getSkyworkKeySlots(): SkyworkKeySlot[] {
  const ordered: string[] = [];
  const push = (k: string) => {
    const t = k.trim();
    if (!t) return;
    if (ordered.includes(t)) return;
    ordered.push(t);
  };

  push(env.SKYWORK_API_KEY);
  push(env.SKYWORK_API_KEY_2);
  push(env.SKYWORK_API_KEY_3);
  push(env.SKYWORK_API_KEY_4);
  push(env.SKYWORK_API_KEY_5);
  for (const k of parseExtraKeysFromEnv()) push(k);

  return ordered.map((apiKey, i) => ({
    label: `sw${i + 1}`,
    apiKey,
    providerKey: skyworkProviderKey(i, apiKey),
  }));
}

export function isSkyworkConfigured(): boolean {
  return getSkyworkKeySlots().length > 0;
}

export function canUseSkyworkToday(): {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
  keys: number;
} {
  const slots = getSkyworkKeySlots();
  if (slots.length === 0) {
    return { ok: false, used: 0, limit: 0, remaining: 0, keys: 0 };
  }
  const perKey = env.DAILY_SKYWORK_LIMIT;
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
  const seen = new Set<string>();
  for (const s of slots) {
    if (seen.has(s.providerKey)) continue;
    seen.add(s.providerKey);
    const b = getProviderImageBudget(s.providerKey, perKey);
    used += b.used;
    remaining += b.remaining;
  }
  const limit = perKey * seen.size;
  return { ok: remaining > 0, used, limit, remaining, keys: slots.length };
}

function canUseKeySlot(slot: SkyworkKeySlot): boolean {
  if (isKeyExhausted(slot.apiKey)) return false;
  const perKey = env.DAILY_SKYWORK_LIMIT;
  if (perKey <= 0) return true;
  const b = getProviderImageBudget(slot.providerKey, perKey);
  return b.remaining > 0;
}

function gatewayBase(): string {
  return (env.SKYWORK_GATEWAY_URL || DEFAULT_GATEWAY).replace(/\/$/, "");
}

function resolveAspectRatio(): string | undefined {
  const raw = (env.SKYWORK_ASPECT_RATIO || "1:1").trim();
  if (!raw || raw === "auto") return undefined;
  return VALID_ASPECT.has(raw) ? raw : "1:1";
}

function resolveResolution(): "1K" | "2K" | "4K" {
  const r = (env.SKYWORK_RESOLUTION || "1K").toUpperCase();
  if (r === "2K" || r === "4K" || r === "1K") return r;
  return "1K";
}

function parseSseChunk(
  text: string,
): Array<{ event: string; data: Record<string, unknown> }> {
  const out: Array<{ event: string; data: Record<string, unknown> }> = [];
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = "message";
    let dataRaw = "";
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataRaw += line.slice(5).trim();
    }
    if (!dataRaw) continue;
    try {
      const data = JSON.parse(dataRaw) as Record<string, unknown>;
      out.push({ event, data: data && typeof data === "object" ? data : {} });
    } catch {
      out.push({ event, data: { message: dataRaw } });
    }
  }
  return out;
}

async function readSseResponse(
  res: Response,
  label: string,
): Promise<{ fileUrl?: string; error?: string }> {
  if (!res.body) {
    const t = await res.text();
    return { error: `empty body: ${t.slice(0, 200)}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let fileUrl: string | undefined;
  let lastError: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lastSep = buf.lastIndexOf("\n\n");
    if (lastSep === -1) continue;
    const complete = buf.slice(0, lastSep + 2);
    buf = buf.slice(lastSep + 2);

    for (const { event, data } of parseSseChunk(complete)) {
      if (event === "progress") {
        const pct = data.percentage ?? data.percent ?? "";
        const msg = String(data.message || "").slice(0, 80);
        if (pct !== "" || msg) {
          console.log(`[skywork] ${label} progress ${pct}% ${msg}`.trim());
        }
      } else if (event === "success") {
        const url =
          (data.file_url as string) ||
          (data.fileUrl as string) ||
          (data.url as string) ||
          "";
        if (url) fileUrl = url;
      } else if (event === "error") {
        lastError = String(
          data.message || data.error || JSON.stringify(data),
        ).slice(0, 400);
      }
    }
  }

  if (buf.trim()) {
    for (const { event, data } of parseSseChunk(buf + "\n\n")) {
      if (event === "success") {
        const url =
          (data.file_url as string) ||
          (data.fileUrl as string) ||
          (data.url as string) ||
          "";
        if (url) fileUrl = url;
      } else if (event === "error") {
        lastError = String(
          data.message || data.error || JSON.stringify(data),
        ).slice(0, 400);
      }
    }
  }

  if (lastError && !fileUrl) return { error: lastError };
  if (!fileUrl) return { error: lastError || "no file_url in SSE success" };
  return { fileUrl };
}

async function downloadToBuffer(fileUrl: string): Promise<Buffer> {
  const res = await fetch(fileUrl, {
    method: "GET",
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`Skywork download HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength < 500) {
    throw new Error(`Skywork download too small (${ab.byteLength} bytes)`);
  }
  return Buffer.from(ab);
}

function isRotatableFailure(msg: string): boolean {
  return /insufficient|credit|quota|benefit|429|rate limit|RESOURCE_EXHAUSTED|billing|401|403|INVALID_TOKEN|NO_TOKEN|unauthorized|forbidden|top up/i.test(
    msg,
  );
}

export type SkyworkImageOptions = {
  face?: { mimeType: string; base64: string; path?: string } | null;
};

async function generateOnceWithKey(
  slot: SkyworkKeySlot,
  prompt: string,
  aspect: string | undefined,
  resolution: "1K" | "2K" | "4K",
  face?: { mimeType: string; base64: string } | null,
): Promise<Buffer> {
  const base = gatewayBase();
  let url: string;
  let body: Record<string, unknown>;

  if (face?.base64) {
    // Image edit / identity preserve via source_images
    url = `${base}/api/sse/image/update`;
    const operation: Record<string, unknown> = {
      action: "edit",
      prompt,
      source_images: [
        {
          base64: face.base64,
          mime_type: face.mimeType || "image/jpeg",
        },
      ],
      resolution,
    };
    if (aspect) operation.aspect_ratio = aspect;
    body = {
      file_id: "from-local",
      operations: [operation],
      source_platform: env.SKYWORK_SOURCE_PLATFORM || "",
    };
  } else {
    url = `${base}/api/sse/image/create`;
    body = {
      title: prompt.slice(0, 60),
      content: prompt,
      style: {} as Record<string, string>,
      options: { resolution },
      source_platform: env.SKYWORK_SOURCE_PLATFORM || "",
    };
    if (aspect) {
      (body.style as Record<string, string>).aspect_ratio = aspect;
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${slot.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const msg = errText.slice(0, 400) || res.statusText;
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }

  const { fileUrl, error } = await readSseResponse(res, slot.label);
  if (error && !fileUrl) {
    if (/insufficient|credit|benefit|quota|upgrade|top up/i.test(error)) {
      throw new Error(`credits: ${error}`);
    }
    throw new Error(`SSE: ${error}`);
  }
  if (!fileUrl) {
    throw new Error("no file_url in response");
  }

  return downloadToBuffer(fileUrl);
}

/**
 * Generate image via Skywork Image API with multi-key rotation.
 * On credits/429/auth → next key.
 * Optional face → edit API with source_images (identity preserve).
 */
export async function skyworkImage(
  prompt: string,
  options?: SkyworkImageOptions,
): Promise<Buffer> {
  const slots = getSkyworkKeySlots();
  if (slots.length === 0) {
    throw new Error(
      "No Skywork keys (set SKYWORK_API_KEY / SKYWORK_API_KEY_2 / …)",
    );
  }

  const budget = canUseSkyworkToday();
  if (!budget.ok) {
    throw new Error(
      `Skywork soft daily limit ${budget.used}/${budget.limit} across ${budget.keys} key(s)`,
    );
  }

  const safePrompt = prompt.trim().slice(0, 4000);
  if (!safePrompt) throw new Error("Skywork: empty prompt");

  const aspect = resolveAspectRatio();
  const resolution = resolveResolution();
  const face = options?.face;
  const usable = slots.filter(canUseKeySlot);

  console.log(
    `[skywork] generate keys=${usable.map((s) => s.label).join("→") || "none"} ` +
      `resolution=${resolution} aspect=${aspect || "auto"} promptLen=${safePrompt.length} ` +
      `budget=${budget.used}/${budget.limit || "∞"}` +
      (face ? " faceRef=yes(edit)" : ""),
  );

  if (usable.length === 0) {
    throw new Error("Skywork: all keys exhausted or over soft budget");
  }

  let lastErr: unknown;
  for (const slot of usable) {
    console.log(
      `[skywork] trying ${slot.label} key=…${slot.apiKey.slice(-6)}`,
    );
    try {
      const buffer = await generateOnceWithKey(
        slot,
        safePrompt,
        aspect,
        resolution,
        face,
      );
      const used = incrementProviderImageUsage(slot.providerKey, 1);
      console.log(
        `[skywork] OK ${slot.label} bytes=${buffer.length} keyDaily=${used}/${env.DAILY_SKYWORK_LIMIT || "∞"}`,
      );
      return buffer;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[skywork] ${slot.label} failed: ${msg.slice(0, 220)}`,
      );
      if (isRotatableFailure(msg)) {
        markKeyExhausted(slot, msg);
        console.log(`[skywork] ${slot.label} → next key`);
        continue;
      }
      // Non-rotatable (network/parse) — still try next key once
      console.log(`[skywork] ${slot.label} non-quota error → try next key`);
      continue;
    }
  }

  throw new Error(
    `Skywork failed (all keys): ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

export function logSkyworkBudget(): void {
  const slots = getSkyworkKeySlots();
  if (slots.length === 0) {
    console.log(
      "[AI] SKYWORK: not configured (set SKYWORK_API_KEY / SKYWORK_API_KEY_2)",
    );
    return;
  }
  const total = canUseSkyworkToday();
  console.log(
    `[AI] SKYWORK total today (UTC): ${total.used}/${total.limit || "∞"} remaining=${total.remaining} keys=${total.keys} ` +
      `res=${env.SKYWORK_RESOLUTION || "1K"} aspect=${env.SKYWORK_ASPECT_RATIO || "1:1"}`,
  );
  const seen = new Set<string>();
  for (const s of slots) {
    if (seen.has(s.providerKey)) continue;
    seen.add(s.providerKey);
    const b = getProviderImageBudget(s.providerKey, env.DAILY_SKYWORK_LIMIT);
    const ex = isKeyExhausted(s.apiKey) ? " [paused-ttl]" : "";
    console.log(
      `[AI]   ${s.label}: ${b.used}/${b.limit || "∞"} remaining=${b.remaining} …${s.apiKey.slice(-6)}${ex}`,
    );
  }
}
