/**
 * Image generation waterfall:
 *   1) Nano Banana (Gemini native image — face ref supported)
 *   2) Skywork Image API (face ref → edit API)
 *   3) xKiro Image API (free SenseNova model — no face support)
 *
 * Providers 1 & 2 support brand face identity.
 * Provider 3 (xKiro) is text-only (no face ref) — used as last resort.
 * If all fail/exhausted → publish is skipped.
 */
import { env } from "../config/env.js";
import {
  nanoBananaImage,
  isNanoBananaConfigured,
  canUseNanoBananaToday,
  logNanoBananaBudgets,
} from "./nanoBananaImage.js";
import {
  skyworkImage,
  isSkyworkConfigured,
  canUseSkyworkToday,
  logSkyworkBudget,
} from "./skyworkImage.js";
import {
  xkiroImage,
  isXkiroConfigured,
  canUseXkiroToday,
  logXkiroBudget,
} from "./xkiroImage.js";
import { loadBrandFace, logBrandFace } from "./brandFace.js";

export type ImageProviderUsed = "nanobanana" | "skywork" | "xkiro";

/** Providers that apply brand face (multimodal or image= ref). */
const IDENTITY_PROVIDERS = new Set<ImageProviderUsed>(["nanobanana", "skywork", "xkiro"]);

export async function generateImageBuffer(
  prompt: string,
): Promise<{ buffer: Buffer; provider: ImageProviderUsed }> {
  const errors: string[] = [];
  const face = await loadBrandFace();
  const requireIdentity = Boolean(face) && env.REQUIRE_BRAND_FACE;

  if (face) {
    console.log(
      `[imagePipeline] brand face ref: ${face.path} (${face.buffer.length} bytes` +
        `${face.prepared ? ", prepared" : ""}) — identity: Nano Banana + Skywork + xKiro`,
    );
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
        "[imagePipeline] Skywork failed → xKiro:",
        msg.slice(0, 200),
      );
    }
  } else if (isSkyworkConfigured()) {
    const b = canUseSkyworkToday();
    errors.push(`skywork: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] Skywork daily budget ${b.used}/${b.limit} → xKiro`,
    );
  } else {
    console.warn("[imagePipeline] Skywork not configured → xKiro");
  }

  // 3) xKiro (supports face via gpt-image edits, with text-to-image fallback)
  if (isXkiroConfigured() && canUseXkiroToday().ok) {
    try {
      const buffer = await xkiroImage(prompt, { face });
      return { buffer, provider: "xkiro" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`xkiro: ${msg}`);
      console.warn(
        "[imagePipeline] xKiro failed — all providers exhausted:",
        msg.slice(0, 200),
      );
    }
  } else if (isXkiroConfigured()) {
    const b = canUseXkiroToday();
    errors.push(`xkiro: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] xKiro daily budget ${b.used}/${b.limit} — all providers exhausted`,
    );
  } else {
    console.warn("[imagePipeline] xKiro not configured (XKIRO_API_KEY)");
  }

  const nb = isNanoBananaConfigured() ? canUseNanoBananaToday() : null;
  const sw = isSkyworkConfigured() ? canUseSkyworkToday() : null;
  const xk = isXkiroConfigured() ? canUseXkiroToday() : null;
  throw new Error(
    `All image providers failed/exhausted${requireIdentity ? " (REQUIRE_BRAND_FACE=true)" : ""}.\n` +
      `Budgets: nanobanana=${nb ? `${nb.used}/${nb.limit} rem=${nb.remaining}` : "off"} ` +
      `skywork=${sw ? `${sw.used}/${sw.limit} rem=${sw.remaining}` : "off"} ` +
      `xkiro=${xk ? `${xk.used}/${xk.limit} rem=${xk.remaining}` : "off"}\n` +
      `Fix: wait for UTC day reset / top up keys.\n` +
      `- ${errors.join("\n- ")}`,
  );
}

export function logAllImageBudgets(): void {
  logBrandFace();
  console.log(
    `[AI] REQUIRE_BRAND_FACE: ${env.REQUIRE_BRAND_FACE} ` +
      `(identity: Nano Banana + Skywork — both support face.jpg)`,
  );
  logNanoBananaBudgets();
  logSkyworkBudget();
  logXkiroBudget();
}

/** Exposed for tests / docs. */
export function providerSupportsFaceIdentity(
  provider: ImageProviderUsed,
): boolean {
  return IDENTITY_PROVIDERS.has(provider);
}


