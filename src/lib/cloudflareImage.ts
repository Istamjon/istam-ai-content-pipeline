/**
 * Cloudflare Workers AI — text-to-image only (no Pollinations).
 * Multi-account rotation: each Cloudflare account has its own free Neurons pool.
 * Primary: FLUX.2-dev (multipart)
 * @see https://developers.cloudflare.com/workers-ai/models/flux-2-dev/
 */
import { env } from "../config/env.js";
import {
  getProviderImageBudget,
  incrementProviderImageUsage,
} from "../db.js";
import {
  ensureCloudflareAccounts,
  getCloudflareAccountsSync,
  type CloudflareAccountSlot,
} from "./cloudflareAccounts.js";

export type { CloudflareAccountSlot };
export { getCloudflareAccountsSync as getCloudflareAccounts };

export function isCloudflareImageConfigured(): boolean {
  return getCloudflareAccountsSync().length > 0 || Boolean(env.CLOUDFLARE_API_TOKEN);
}

export function canGenerateImageToday(): {
  ok: boolean;
  used: number;
  limit: number;
  remaining: number;
  accounts: Array<{
    label: string;
    used: number;
    limit: number;
    remaining: number;
  }>;
} {
  const accounts = getCloudflareAccountsSync();
  const perLimit = env.DAILY_IMAGE_LIMIT;
  const totalCap = env.DAILY_IMAGE_TOTAL;
  const detail = accounts.map((a) => {
    const b = getProviderImageBudget(a.providerKey, perLimit);
    return {
      label: a.label,
      used: b.used,
      limit: b.limit,
      remaining: b.remaining,
    };
  });
  const used = detail.reduce((s, d) => s + d.used, 0);
  // Global soft cap (e.g. 10/day) + sum of per-account remaining
  const limit = totalCap > 0 ? totalCap : perLimit * Math.max(1, accounts.length || 1);
  const remainingByAccounts = detail.reduce((s, d) => s + d.remaining, 0);
  const remainingByTotal = Math.max(0, limit - used);
  const remaining = Math.min(remainingByAccounts, remainingByTotal);
  return {
    ok: remaining > 0 && accounts.length > 0,
    used,
    limit,
    remaining,
    accounts: detail,
  };
}

function isFlux2(model: string): boolean {
  return /flux-2/i.test(model);
}

function isRouteError(msg: string): boolean {
  return /could not route|AiError|timeout|502|503|504|overloaded|capacity|limit|neuron/i.test(
    msg,
  );
}

function isNeuronQuotaError(msg: string): boolean {
  return /neuron|4006|free allocation|daily free|upgrade to.*workers paid/i.test(
    msg,
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function decodeBase64Image(json: {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: { image?: string } | string;
  image?: string;
}): Buffer {
  if (json.success === false) {
    const msg =
      json.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      JSON.stringify(json).slice(0, 400);
    throw new Error(msg);
  }
  const b64 =
    (typeof json.result === "object" && json.result && "image" in json.result
      ? json.result.image
      : undefined) ||
    json.image ||
    (typeof json.result === "string" ? json.result : undefined);

  if (!b64 || typeof b64 !== "string") {
    throw new Error(
      "Cloudflare image response missing base64: " +
        JSON.stringify(json).slice(0, 300),
    );
  }
  return Buffer.from(b64, "base64");
}

async function runFlux2(
  accountId: string,
  token: string,
  model: string,
  prompt: string,
  width: number,
  height: number,
  steps: number,
): Promise<Buffer> {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(width));
  form.append("height", String(height));
  form.append("steps", String(steps));

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  console.log(
    `[cloudflare-image] try model=${model} ${width}x${height} steps=${steps} promptLen=${prompt.length}`,
  );

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(300_000),
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("image/")) {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  const json = (await res.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { image?: string } | string;
    image?: string;
  };

  if (!res.ok || json.success === false) {
    const msg =
      json.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return decodeBase64Image(json);
}

async function runFlux1Schnell(
  accountId: string,
  token: string,
  prompt: string,
  steps: number,
): Promise<Buffer> {
  const model = "@cf/black-forest-labs/flux-1-schnell";
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
  console.log(
    `[cloudflare-image] fallback model=${model} steps=${steps} promptLen=${prompt.length}`,
  );

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: prompt.slice(0, 2048),
      steps: Math.min(8, Math.max(1, steps)),
      seed: Math.floor(Math.random() * 1_000_000),
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const json = (await res.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { image?: string } | string;
    image?: string;
  };

  if (!res.ok || json.success === false) {
    const msg =
      json.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return decodeBase64Image(json);
}

function markAccountExhausted(
  slot: CloudflareAccountSlot,
  reason: string,
): void {
  const b = getProviderImageBudget(slot.providerKey, env.DAILY_IMAGE_LIMIT);
  if (b.remaining <= 0) return;
  incrementProviderImageUsage(slot.providerKey, b.remaining);
  console.warn(
    `[cloudflare-image] ${slot.label} marked exhausted for today (${reason.slice(0, 100)})`,
  );
}

/**
 * Prefer account with most remaining soft budget (true rotation).
 */
function orderSlotsForRotation(
  slots: CloudflareAccountSlot[],
): CloudflareAccountSlot[] {
  return [...slots].sort((a, b) => {
    const ra = getProviderImageBudget(a.providerKey, env.DAILY_IMAGE_LIMIT)
      .remaining;
    const rb = getProviderImageBudget(b.providerKey, env.DAILY_IMAGE_LIMIT)
      .remaining;
    if (rb !== ra) return rb - ra;
    return a.label.localeCompare(b.label);
  });
}

async function generateWithAccount(
  slot: CloudflareAccountSlot,
  prompt: string,
  nearGlobalLimit: boolean,
): Promise<Buffer> {
  const primaryModel =
    env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-2-dev";
  const fullPrompt = prompt.trim().slice(0, 2200);
  const shortPrompt = prompt.trim().slice(0, 1600);
  const wantW = env.IMAGE_WIDTH || 1024;
  const wantH = env.IMAGE_HEIGHT || 1024;
  const wantSteps = Math.min(50, Math.max(1, env.CLOUDFLARE_IMAGE_STEPS || 15));
  const accountBudget = getProviderImageBudget(
    slot.providerKey,
    env.DAILY_IMAGE_LIMIT,
  );
  const nearLimit = nearGlobalLimit || accountBudget.remaining <= 1;

  const attempts: Array<{
    model: "flux2" | "schnell";
    w: number;
    h: number;
    steps: number;
    prompt: string;
  }> = [];

  if (isFlux2(primaryModel)) {
    attempts.push({
      model: "flux2",
      w: wantW,
      h: wantH,
      steps: wantSteps,
      prompt: fullPrompt,
    });
    if (!nearLimit) {
      attempts.push({
        model: "flux2",
        w: Math.min(wantW, 1024),
        h: Math.min(wantH, 1024),
        steps: Math.min(wantSteps, 12),
        prompt: shortPrompt,
      });
    }
  }

  if (!nearLimit) {
    attempts.push({
      model: "schnell",
      w: 1024,
      h: 1024,
      steps: 6,
      prompt: shortPrompt,
    });
  }

  let lastErr: unknown;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const maxRetry = nearLimit ? 1 : 2;
    for (let retry = 0; retry < maxRetry; retry++) {
      try {
        let buf: Buffer;
        if (a.model === "flux2") {
          buf = await runFlux2(
            slot.accountId,
            slot.token,
            primaryModel,
            a.prompt,
            a.w,
            a.h,
            a.steps,
          );
          console.log(
            `[cloudflare-image] OK ${slot.label} flux2 ${a.w}x${a.h} steps=${a.steps} bytes=${buf.length}`,
          );
        } else {
          buf = await runFlux1Schnell(
            slot.accountId,
            slot.token,
            a.prompt,
            a.steps,
          );
          console.log(
            `[cloudflare-image] OK ${slot.label} schnell steps=${a.steps} bytes=${buf.length}`,
          );
        }
        const used = incrementProviderImageUsage(slot.providerKey, 1);
        console.log(
          `[cloudflare-image] ${slot.label} daily ${used}/${env.DAILY_IMAGE_LIMIT} (UTC)`,
        );
        return buf;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `[cloudflare-image] ${slot.label} attempt ${i + 1}/${attempts.length} retry=${retry}: ${msg.slice(0, 220)}`,
        );
        if (isNeuronQuotaError(msg)) {
          markAccountExhausted(slot, msg);
          throw e;
        }
        if (isRouteError(msg) && retry < maxRetry - 1) {
          await sleep(3000 * (retry + 1));
          continue;
        }
        break;
      }
    }
  }

  throw new Error(
    `${slot.label} failed: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/**
 * Generate image via Cloudflare Workers AI with multi-account rotation.
 * Resolves Account IDs if needed, then picks account with most remaining budget.
 * Failover: cfA → cfB → cfC → throw (pipeline falls to AI Horde).
 */
export async function cloudflareImage(prompt: string): Promise<Buffer> {
  const slots = await ensureCloudflareAccounts();
  if (slots.length === 0) {
    throw new Error(
      "No Cloudflare accounts ready. Set CLOUDFLARE_ACCOUNT_ID + TOKEN (and optional _2 / _3). " +
        "For auto-ID: token needs Account Settings: Read.",
    );
  }

  const budget = canGenerateImageToday();
  if (!budget.ok) {
    throw new Error(
      `Daily CF image limit reached (${budget.used}/${budget.limit} total across ${slots.length} account(s)). Resets 00:00 UTC.`,
    );
  }

  const errors: string[] = [];
  const nearGlobal = budget.remaining <= 1;
  const ordered = orderSlotsForRotation(slots);

  for (const slot of ordered) {
    // Re-check total cap mid-loop
    if (!canGenerateImageToday().ok) {
      errors.push("total daily CF cap reached");
      break;
    }
    const ab = getProviderImageBudget(slot.providerKey, env.DAILY_IMAGE_LIMIT);
    if (ab.remaining <= 0) {
      console.warn(
        `[cloudflare-image] skip ${slot.label}: soft budget ${ab.used}/${ab.limit}`,
      );
      continue;
    }
    try {
      console.log(
        `[cloudflare-image] using ${slot.label} account=…${slot.accountId.slice(-6)} budget=${ab.used}/${ab.limit}`,
      );
      return await generateWithAccount(slot, prompt, nearGlobal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${slot.label}: ${msg}`);
      console.warn(
        `[cloudflare-image] ${slot.label} failed → next account: ${msg.slice(0, 200)}`,
      );
    }
  }

  throw new Error(
    `All Cloudflare accounts failed/exhausted:\n- ${errors.join("\n- ")}`,
  );
}

export function logImageBudget(): void {
  const b = canGenerateImageToday();
  const n = getCloudflareAccountsSync().length;
  console.log(
    `[AI] CF IMAGE total today (UTC): ${b.used}/${b.limit} used, remaining=${b.remaining} accounts=${n} (per-acct max ${env.DAILY_IMAGE_LIMIT})`,
  );
  for (const a of b.accounts) {
    console.log(
      `[AI]   ${a.label}: ${a.used}/${a.limit} remaining=${a.remaining}`,
    );
  }
  if (env.CLOUDFLARE_API_TOKEN_2 && !env.CLOUDFLARE_ACCOUNT_ID_2) {
    const sync = getCloudflareAccountsSync().some((s) => s.label === "cf2");
    if (!sync) {
      console.warn(
        "[AI] CF cf2: token set but Account ID missing — set CLOUDFLARE_ACCOUNT_ID_2 or recreate token with Account Settings: Read",
      );
    }
  }
  if (env.CLOUDFLARE_API_TOKEN_3 && !env.CLOUDFLARE_ACCOUNT_ID_3) {
    const sync = getCloudflareAccountsSync().some((s) => s.label === "cf3");
    if (!sync) {
      console.warn(
        "[AI] CF cf3: token set but Account ID missing — set CLOUDFLARE_ACCOUNT_ID_3 or recreate token with Account Settings: Read",
      );
    }
  }
}

/** Call once at process start to resolve Account IDs. */
export async function initCloudflareAccounts(): Promise<void> {
  await ensureCloudflareAccounts();
}
