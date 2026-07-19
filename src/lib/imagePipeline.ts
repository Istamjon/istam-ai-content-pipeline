/**
 * Image generation waterfall:
 *   1) Nano Banana (Gemini image — face ref supported)
 *   2) Skywork Image API (face ref → edit API)
 *   3) Pollinations (face via image= URL when face.jpg present)
 *   4) Cloudflare multi-account free FLUX  ← NO face image
 *   5) AI Horde                            ← NO face image
 *
 * Identity (face.jpg): Nano Banana, Skywork, Pollinations (hosted face URL).
 * When REQUIRE_BRAND_FACE=true, CF/Horde are skipped (cannot receive face).
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

/** Providers that can apply brand face (multimodal or image= ref). */
const IDENTITY_PROVIDERS = new Set<ImageProviderUsed>([
  "nanobanana",
  "skywork",
  "pollinations",
]);

export async function generateImageBuffer(
  prompt: string,
): Promise<{ buffer: Buffer; provider: ImageProviderUsed }> {
  const errors: string[] = [];
  const face = await loadBrandFace();
  const requireIdentity = Boolean(face) && env.REQUIRE_BRAND_FACE;

  if (face) {
    console.log(
      `[imagePipeline] brand face ref: ${face.path} (${face.buffer.length} bytes` +
        `${face.prepared ? ", prepared" : ""}) — identity: Nano/Skywork/Pollinations`,
    );
    if (requireIdentity) {
      console.log(
        "[imagePipeline] REQUIRE_BRAND_FACE=true → skip CF/Horde (no face API)",
      );
    }
  } else {
    console.warn(
      "[imagePipeline] no brand face — text-only person (set data/brand/face.jpg)",
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

  // 2) Skywork
  if (isSkyworkConfigured() && canUseSkyworkToday().ok) {
    try {
      const buffer = await skyworkImage(prompt, { face });
      return { buffer, provider: "skywork" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`skywork: ${msg}`);
      console.warn(
        "[imagePipeline] Skywork failed → Pollinations:",
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

  // 3) Pollinations (face via public URL + image= when face.jpg present)
  if (isPollinationsImageConfigured() && canUsePollinationsImageToday().ok) {
    try {
      if (face) {
        console.log(
          "[imagePipeline] Pollinations: faceRef attempt (image= URL / multipart)",
        );
      }
      const buffer = await pollinationsImage(prompt, { face });
      return { buffer, provider: "pollinations" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`pollinations: ${msg}`);
      console.warn(
        "[imagePipeline] Pollinations failed → " +
          (requireIdentity ? "stop (identity required)" : "Cloudflare:"),
        msg.slice(0, 200),
      );
    }
  } else if (isPollinationsImageConfigured()) {
    const b = canUsePollinationsImageToday();
    errors.push(`pollinations: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] Pollinations image budget ${b.used}/${b.limit} → ` +
        (requireIdentity ? "stop (identity required)" : "Cloudflare"),
    );
  }

  // Identity-only mode: do not invent a stranger on text-only CF/Horde.
  if (requireIdentity) {
    throw new Error(
      `Brand face identity required (face.jpg present, REQUIRE_BRAND_FACE=true) ` +
        `but Nano Banana + Skywork + Pollinations failed/exhausted. ` +
        `Cloudflare/Horde cannot receive face.jpg.\n` +
        `Fix: top up Gemini/Skywork/Pollinations or set REQUIRE_BRAND_FACE=false.\n` +
        `- ${errors.join("\n- ")}`,
    );
  }

  // 4) Cloudflare (cf1 → cf2 → cf3)
  if (isCloudflareImageConfigured() && canGenerateImageToday().ok) {
    try {
      console.warn(
        "[imagePipeline] Cloudflare: text-only — cannot apply face.jpg identity",
      );
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
      console.warn(
        "[imagePipeline] Horde: text-only — cannot apply face.jpg identity",
      );
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
  console.log(
    `[AI] REQUIRE_BRAND_FACE: ${env.REQUIRE_BRAND_FACE} ` +
      `(identity: Nano Banana + Skywork + Pollinations; skip CF/Horde when face present)`,
  );
  console.log(
    `[AI] POLLINATIONS face model: ${env.POLLINATIONS_FACE_MODEL || "kontext"} ` +
      `(text model: ${env.POLLINATIONS_IMAGE_MODEL || "gpt-image-2"})`,
  );
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

/** Exposed for tests / docs. */
export function providerSupportsFaceIdentity(
  provider: ImageProviderUsed,
): boolean {
  return IDENTITY_PROVIDERS.has(provider);
}
