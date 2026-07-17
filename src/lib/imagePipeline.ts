/**
 * Image generation waterfall:
 *   1) Nano Banana (Gemini image — best when quota allows; face ref supported)
 *   2) Skywork Image API (face ref → edit API)
 *   3) Pollinations gpt-image-2
 *   4) Cloudflare multi-account free FLUX
 *   5) AI Horde
 */
import { env } from "../config/env.js";
import {
  cloudflareImage,
  isCloudflareImageConfigured,
  canGenerateImageToday,
  logImageBudget,
} from "./cloudflareImage.js";
import {
  hordeImage,
  isHordeConfigured,
  canUseHordeToday,
} from "./hordeImage.js";
import {
  nanoBananaImage,
  isNanoBananaConfigured,
  canUseNanoBananaToday,
  logNanoBananaBudgets,
} from "./nanoBananaImage.js";
import {
  pollinationsImage,
  isPollinationsImageConfigured,
  canUsePollinationsImageToday,
  logPollinationsImageBudget,
} from "./pollinations.js";
import {
  skyworkImage,
  isSkyworkConfigured,
  canUseSkyworkToday,
  logSkyworkBudget,
} from "./skyworkImage.js";
import { loadBrandFace, logBrandFace } from "./brandFace.js";
import { getProviderImageBudget } from "../db.js";

export type ImageProviderUsed =
  | "nanobanana"
  | "skywork"
  | "pollinations"
  | "cloudflare"
  | "horde";

export async function generateImageBuffer(
  prompt: string,
): Promise<{ buffer: Buffer; provider: ImageProviderUsed }> {
  const errors: string[] = [];
  const face = loadBrandFace();
  if (face) {
    console.log(
      `[imagePipeline] brand face ref: ${face.path} (${face.buffer.length} bytes) — Nano/Skywork identity`,
    );
  }

  // 1) Nano Banana (Gemini native image + optional face)
  if (isNanoBananaConfigured() && canUseNanoBananaToday().ok) {
    try {
      const buffer = await nanoBananaImage(prompt, { face });
      return { buffer, provider: "nanobanana" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`nanobanana: ${msg}`);
      console.warn(
        "[imagePipeline] Nano Banana failed → Skywork:",
        msg.slice(0, 200),
      );
    }
  } else if (isNanoBananaConfigured()) {
    const b = canUseNanoBananaToday();
    errors.push(`nanobanana: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] Nano Banana daily budget ${b.used}/${b.limit} → Skywork`,
    );
  } else {
    console.warn("[imagePipeline] Nano Banana not configured → Skywork");
  }

  // 2) Skywork (after Nano Banana fails / no quota)
  if (isSkyworkConfigured() && canUseSkyworkToday().ok) {
    try {
      const buffer = await skyworkImage(prompt, { face });
      return { buffer, provider: "skywork" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`skywork: ${msg}`);
      console.warn(
        "[imagePipeline] Skywork failed → Pollinations gpt-image-2:",
        msg.slice(0, 200),
      );
    }
  } else if (isSkyworkConfigured()) {
    const b = canUseSkyworkToday();
    errors.push(`skywork: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] Skywork daily budget ${b.used}/${b.limit} → Pollinations`,
    );
  } else {
    console.warn(
      "[imagePipeline] Skywork not configured (SKYWORK_API_KEY) → Pollinations",
    );
  }

  // 3) Pollinations gpt-image-2 (no face ref API — prompt only)
  if (isPollinationsImageConfigured() && canUsePollinationsImageToday().ok) {
    try {
      const buffer = await pollinationsImage(prompt);
      return { buffer, provider: "pollinations" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`pollinations: ${msg}`);
      console.warn(
        "[imagePipeline] Pollinations gpt-image-2 failed → Cloudflare:",
        msg.slice(0, 200),
      );
    }
  } else if (isPollinationsImageConfigured()) {
    const b = canUsePollinationsImageToday();
    errors.push(`pollinations: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] Pollinations image budget ${b.used}/${b.limit} → Cloudflare`,
    );
  }

  // 4) Cloudflare (cf1 → cf2 → cf3)
  if (isCloudflareImageConfigured() && canGenerateImageToday().ok) {
    try {
      const buffer = await cloudflareImage(prompt);
      return { buffer, provider: "cloudflare" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`cloudflare: ${msg}`);
      console.warn(
        "[imagePipeline] Cloudflare failed → Horde:",
        msg.slice(0, 200),
      );
    }
  } else if (isCloudflareImageConfigured()) {
    const b = canGenerateImageToday();
    errors.push(`cloudflare: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] Cloudflare daily budget exhausted ${b.used}/${b.limit} → Horde`,
    );
  }

  // 5) AI Horde
  if (isHordeConfigured() && canUseHordeToday().ok) {
    try {
      const buffer = await hordeImage(prompt);
      return { buffer, provider: "horde" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`horde: ${msg}`);
      console.warn("[imagePipeline] horde failed:", msg.slice(0, 200));
    }
  } else if (isHordeConfigured()) {
    const b = canUseHordeToday();
    errors.push(`horde: budget ${b.used}/${b.limit}`);
  }

  throw new Error(
    `All image providers failed/exhausted:\n- ${errors.join("\n- ")}`,
  );
}

export function logAllImageBudgets(): void {
  logBrandFace();
  logNanoBananaBudgets();
  logSkyworkBudget();
  logPollinationsImageBudget();
  logImageBudget();
  if (isHordeConfigured()) {
    const b = getProviderImageBudget("horde", env.DAILY_HORDE_LIMIT);
    console.log(
      `[AI] HORDE budget today (UTC): ${b.used}/${b.limit} remaining=${b.remaining}`,
    );
  } else {
    console.log("[AI] HORDE: not configured");
  }
}
