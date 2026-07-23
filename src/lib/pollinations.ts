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

/** Cache public URL for brand face so we do not re-upload every generation. */
let faceUrlCache: { key: string; url: string; until: number } | null = null;
const FACE_URL_TTL_MS = 6 * 60 * 60 * 1000;

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

export type PollinationsFaceRef = {
  path?: string;
  mimeType?: string;
  base64?: string;
  buffer?: Buffer;
};

export type PollinationsImageOptions = {
  /** Brand face for identity (image= URL / multipart). */
  face?: PollinationsFaceRef | null;
};

/**
 * Models known to accept Pollinations `image=` reference (identity / img2img).
 * @see https://github.com/pollinations/pollinations APIDOCS — kontext, gptimage, nanobanana
 */
function faceModelCandidates(primary: string): string[] {
  const out: string[] = [];
  const push = (m: string) => {
    const t = m.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(primary);
  push("kontext");
  push("gptimage");
  push("nanobanana");
  push("gpt-image-2");
  return out;
}

/**
 * Host face.jpg publicly (Catbox/Litterbox/…) so Pollinations can fetch it.
 * Falls back to data: URL if all hosts fail (some gateways accept it).
 */
async function resolveFaceImageUrl(
  face: PollinationsFaceRef,
): Promise<{ url: string; via: string }> {
  const pathKey = face.path || "";
  let mtime = 0;
  if (pathKey) {
    try {
      const { default: fs } = await import("fs");
      mtime = fs.statSync(pathKey).mtimeMs;
    } catch {
      /* ignore */
    }
  }
  const cacheKey = `${pathKey}|${mtime}|${face.base64?.slice(0, 32) || ""}`;
  if (
    faceUrlCache &&
    faceUrlCache.key === cacheKey &&
    faceUrlCache.until > Date.now()
  ) {
    return { url: faceUrlCache.url, via: "cache" };
  }

  if (pathKey) {
    const { ensurePublicImageUrl } = await import("./imageHost.js");
    const hosted = await ensurePublicImageUrl(pathKey, {
      prefer: ["catbox", "0x0", "litterbox", "imgbb"],
    });
    if (hosted.url) {
      faceUrlCache = {
        key: cacheKey,
        url: hosted.url,
        until: Date.now() + FACE_URL_TTL_MS,
      };
      return { url: hosted.url, via: hosted.host || "host" };
    }
    console.warn(
      `[pollinations-image] face host failed: ${hosted.error?.slice(0, 160)}`,
    );
  }

  // data: URI fallback (works on some Pollinations gateways; not all)
  if (face.base64) {
    const mime = face.mimeType || "image/jpeg";
    const dataUrl = `data:${mime};base64,${face.base64}`;
    return { url: dataUrl, via: "data-uri" };
  }
  if (face.buffer?.length) {
    const mime = face.mimeType || "image/jpeg";
    const dataUrl = `data:${mime};base64,${face.buffer.toString("base64")}`;
    return { url: dataUrl, via: "data-uri" };
  }

  throw new Error(
    "Pollinations face: cannot host face.jpg (need public URL or base64)",
  );
}

function validateImageBuffer(
  buf: Buffer,
  ctype: string,
  model: string,
): Buffer {
  if (buf.length < 500) {
    const peek = buf.toString("utf8").slice(0, 200);
    throw new Error(
      `Pollinations image too small (${buf.length}b) model=${model} content-type=${ctype} body=${peek}`,
    );
  }
  if (ctype.includes("json") || ctype.includes("text")) {
    throw new Error(
      `Pollinations image returned non-image (${ctype}) model=${model}: ${buf.toString("utf8").slice(0, 200)}`,
    );
  }
  return buf;
}

async function fetchImageGet(
  prompt: string,
  model: string,
  width: number,
  height: number,
  imageUrl?: string,
): Promise<Buffer> {
  const params = new URLSearchParams({
    model,
    width: String(width),
    height: String(height),
    nologo: "true",
    enhance: "false",
    key: env.POLLINATIONS_API_KEY,
  });
  if (imageUrl) {
    params.set("image", imageUrl);
  }
  const url =
    `${baseUrl()}/image/${encodeURIComponent(prompt)}?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders({ Accept: "image/*" }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status}: ${errBody.slice(0, 220) || response.statusText}`,
    );
  }

  const ctype = (response.headers.get("content-type") || "").toLowerCase();
  const buf = Buffer.from(await response.arrayBuffer());
  return validateImageBuffer(buf, ctype, model);
}

/**
 * Multipart POST — some Pollinations models accept file upload as reference.
 * Tries OpenAI-style /v1/images/edits and generic form POST.
 */
async function fetchImageMultipart(
  prompt: string,
  model: string,
  width: number,
  height: number,
  face: PollinationsFaceRef,
): Promise<Buffer> {
  const bytes =
    face.buffer ||
    (face.base64 ? Buffer.from(face.base64, "base64") : null);
  if (!bytes?.length && !face.path) {
    throw new Error("multipart face: no buffer/path");
  }

  let fileBytes: Buffer;
  let filename = "face.jpg";
  const mime = face.mimeType || "image/jpeg";
  if (face.path) {
    const { default: fs } = await import("fs");
    const { default: path } = await import("path");
    fileBytes = fs.readFileSync(face.path);
    filename = path.basename(face.path) || filename;
  } else {
    fileBytes = bytes!;
  }

  const endpoints = [
    `${baseUrl()}/v1/images/edits`,
    `${baseUrl()}/v1/images/generations`,
    `${baseUrl()}/image`,
  ];

  let lastErr: Error | null = null;
  for (const endpoint of endpoints) {
    try {
      // Fresh FormData per attempt (body stream can only be consumed once)
      const blob = new Blob([new Uint8Array(fileBytes)], { type: mime });
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("model", model);
      form.append("size", `${width}x${height}`);
      form.append("nologo", "true");
      form.append("image", blob, filename);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: authHeaders({ Accept: "image/*,application/json" }),
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      const ctype = (response.headers.get("content-type") || "").toLowerCase();
      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        throw new Error(
          `HTTP ${response.status} ${endpoint}: ${errBody.slice(0, 180)}`,
        );
      }
      if (ctype.includes("json")) {
        const json = (await response.json()) as {
          data?: Array<{ b64_json?: string; url?: string }>;
        };
        const first = json.data?.[0];
        if (first?.b64_json) {
          return Buffer.from(first.b64_json, "base64");
        }
        if (first?.url) {
          const imgRes = await fetch(first.url, {
            signal: AbortSignal.timeout(120_000),
          });
          if (!imgRes.ok) throw new Error(`download ${imgRes.status}`);
          const buf = Buffer.from(await imgRes.arrayBuffer());
          return validateImageBuffer(
            buf,
            imgRes.headers.get("content-type") || "image/*",
            model,
          );
        }
        throw new Error("JSON response missing image data");
      }
      const buf = Buffer.from(await response.arrayBuffer());
      return validateImageBuffer(buf, ctype, model);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.warn(
        `[pollinations-image] multipart ${endpoint} failed: ${lastErr.message.slice(0, 140)}`,
      );
    }
  }
  throw lastErr || new Error("multipart face failed");
}

/**
 * Pollinations image generation.
 * - Text-only: default model (gpt-image-2)
 * - With face: host face.jpg → `image=` query (kontext / gptimage / nanobanana)
 *   so identity can be preserved when Nano/Skywork are exhausted.
 * @see https://gen.pollinations.ai/image/{prompt}?model=kontext&image=…
 */
export async function pollinationsImage(
  prompt: string,
  options?: PollinationsImageOptions,
): Promise<Buffer> {
  if (!env.POLLINATIONS_API_KEY) {
    throw new Error(
      "POLLINATIONS_API_KEY required for images. Get a key at https://enter.pollinations.ai",
    );
  }

  const budget = canUsePollinationsImageToday();
  if (!budget.ok) {
    throw new Error(
      `Pollinations image daily limit ${budget.used}/${budget.limit} (UTC)`,
    );
  }

  const width = Math.min(2048, Math.max(256, env.IMAGE_WIDTH || 1024));
  const height = Math.min(2048, Math.max(256, env.IMAGE_HEIGHT || 1024));
  const safePrompt = prompt.trim().slice(0, 2000);
  if (!safePrompt) throw new Error("Pollinations image: empty prompt");

  const face = options?.face;
  let faceImageUrl: string | undefined;
  let faceVia = "";

  if (face?.path || face?.base64 || face?.buffer) {
    try {
      const resolved = await resolveFaceImageUrl(face);
      faceImageUrl = resolved.url;
      faceVia = resolved.via;
      console.log(
        `[pollinations-image] faceRef=yes via=${faceVia} url=${faceImageUrl.slice(0, 72)}…`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[pollinations-image] face.jpg host failed (Litterbox/Catbox/…): ${msg.slice(0, 180)}`,
      );
      // Do not fall back to text-only — that invents a random face (breaks brand identity).
      // Pipeline will try multipart next, then next provider / fail if REQUIRE_BRAND_FACE.
      throw new Error(
        `Pollinations face identity unavailable (could not host face.jpg for image= URL): ${msg}`,
      );
    }
  }

  const models = faceImageUrl
    ? faceModelCandidates(env.POLLINATIONS_FACE_MODEL || "kontext")
    : [env.POLLINATIONS_IMAGE_MODEL || "gpt-image-2"];

  let lastErr: unknown;
  for (const model of models) {
    try {
      console.log(
        `[pollinations-image] model=${model} ${width}x${height} promptLen=${safePrompt.length} ` +
          `budget=${budget.used}/${budget.limit || "∞"}` +
          (faceImageUrl ? ` faceRef=yes(${faceVia})` : ""),
      );
      const buf = await fetchImageGet(
        safePrompt,
        model,
        width,
        height,
        faceImageUrl,
      );
      trackRequest();
      const used = incrementProviderImageUsage(POLLINATIONS_IMAGE_PROVIDER, 1);
      console.log(
        `[pollinations-image] OK model=${model} bytes=${buf.length} daily=${used}/${budget.limit || "∞"}` +
          (faceImageUrl ? " faceRef=yes" : ""),
      );
      return buf;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[pollinations-image] model=${model} failed: ${msg.slice(0, 200)}`,
      );
    }
  }

  // Last resort for face: multipart upload of local file
  if (face && (face.path || face.buffer || face.base64)) {
    for (const model of faceModelCandidates(
      env.POLLINATIONS_FACE_MODEL || "kontext",
    ).slice(0, 3)) {
      try {
        console.log(`[pollinations-image] multipart face model=${model}`);
        const buf = await fetchImageMultipart(
          safePrompt,
          model,
          width,
          height,
          face,
        );
        trackRequest();
        const used = incrementProviderImageUsage(POLLINATIONS_IMAGE_PROVIDER, 1);
        console.log(
          `[pollinations-image] OK multipart model=${model} bytes=${buf.length} daily=${used}/${budget.limit || "∞"} faceRef=yes`,
        );
        return buf;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `[pollinations-image] multipart model=${model}: ${msg.slice(0, 160)}`,
        );
      }
    }
  }

  throw new Error(
    `Pollinations image failed: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
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
    imageProvider: "nanobanana→skywork→pollinations→cloudflare→horde",
    imageModel: env.POLLINATIONS_IMAGE_MODEL || "gpt-image-2",
  };
}
