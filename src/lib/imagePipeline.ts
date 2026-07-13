/**
 * Image generation waterfall:
 *   1) Nano Banana (Gemini image — best text-in-image when quota allows)
 *   2) Cloudflare multi-account free FLUX
 *   3) AI Horde
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
import { getProviderImageBudget } from "../db.js";

export type ImageProviderUsed = "nanobanana" | "cloudflare" | "horde";

export async function generateImageBuffer(
  prompt: string,
): Promise<{ buffer: Buffer; provider: ImageProviderUsed }> {
  const errors: string[] = [];

  // 1) Nano Banana (Gemini native image)
  if (isNanoBananaConfigured() && canUseNanoBananaToday().ok) {
    try {
      const buffer = await nanoBananaImage(prompt);
      return { buffer, provider: "nanobanana" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`nanobanana: ${msg}`);
      console.warn(
        "[imagePipeline] Nano Banana failed → Cloudflare:",
        msg.slice(0, 200),
      );
    }
  } else if (isNanoBananaConfigured()) {
    const b = canUseNanoBananaToday();
    errors.push(`nanobanana: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] Nano Banana daily budget ${b.used}/${b.limit} → Cloudflare`,
    );
  }

  // 2) Cloudflare (cf1 → cf2 → cf3)
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

  // 3) AI Horde
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
  logNanoBananaBudgets();
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
