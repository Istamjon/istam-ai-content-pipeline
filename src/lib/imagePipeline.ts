/**
 * Image generation waterfall:
 *   1) Nano Banana (Gemini native image — face ref supported)
 *   2) Skywork Image API (face ref → edit API)
 *
 * Both providers support brand face identity (face.jpg multimodal / edit API).
 * If both fail/exhausted → publish is skipped (no text-only fallback to protect identity).
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
import { loadBrandFace, logBrandFace } from "./brandFace.js";

export type ImageProviderUsed = "nanobanana" | "skywork";

/** Providers that apply brand face (multimodal or image= ref). Both support identity. */
const IDENTITY_PROVIDERS = new Set<ImageProviderUsed>(["nanobanana", "skywork"]);

export async function generateImageBuffer(
  prompt: string,
): Promise<{ buffer: Buffer; provider: ImageProviderUsed }> {
  const errors: string[] = [];
  const face = await loadBrandFace();
  const requireIdentity = Boolean(face) && env.REQUIRE_BRAND_FACE;

  if (face) {
    console.log(
      `[imagePipeline] brand face ref: ${face.path} (${face.buffer.length} bytes` +
        `${face.prepared ? ", prepared" : ""}) — identity: Nano Banana + Skywork`,
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
        "[imagePipeline] Skywork failed — both providers exhausted:",
        msg.slice(0, 200),
      );
    }
  } else if (isSkyworkConfigured()) {
    const b = canUseSkyworkToday();
    errors.push(`skywork: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] Skywork daily budget ${b.used}/${b.limit} — both providers exhausted`,
    );
  } else {
    console.warn(
      "[imagePipeline] Skywork not configured (SKYWORK_API_KEY) — both providers unavailable",
    );
  }

  const nb = isNanoBananaConfigured() ? canUseNanoBananaToday() : null;
  const sw = isSkyworkConfigured() ? canUseSkyworkToday() : null;
  throw new Error(
    `Nano Banana + Skywork failed/exhausted${requireIdentity ? " (REQUIRE_BRAND_FACE=true)" : ""}.\n` +
      `Budgets: nanobanana=${nb ? `${nb.used}/${nb.limit} rem=${nb.remaining} keys=${nb.keys}` : "off"} ` +
      `skywork=${sw ? `${sw.used}/${sw.limit} rem=${sw.remaining} keys=${sw.keys}` : "off"}\n` +
      `Fix: wait for UTC day reset / top up Gemini·Skywork keys.\n` +
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
}

/** Exposed for tests / docs. */
export function providerSupportsFaceIdentity(
  provider: ImageProviderUsed,
): boolean {
  return IDENTITY_PROVIDERS.has(provider);
}
