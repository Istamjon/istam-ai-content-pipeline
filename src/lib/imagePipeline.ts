/**
 * Image generation waterfall:
 *   1) UnoRouter (gpt-image-2:free primary + multi-model fallback — brand face supported)
 *   2) Nano Banana (Gemini native image — face ref supported)
 *   3) Skywork Image API (face ref → edit API)
 *   4) xKiro Image API (free SenseNova model — pure workflow diagrams)
 *
 * Providers 1, 2 & 3 support brand face identity.
 * Provider 4 (xKiro) is strictly workflow diagrams (no humans) — used as last resort.
 * If all fail/exhausted → publish is skipped.
 */
import { env } from "../config/env.js";
import {
  unorouterImage,
  isUnorouterConfigured,
  canUseUnorouterToday,
  logUnorouterBudget,
} from "./unorouterImage.js";
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

export type ImageProviderUsed = "unorouter" | "nanobanana" | "skywork" | "xkiro";

/** Providers that apply brand face (multimodal, edit API, or identity-guided prompt). */
const IDENTITY_PROVIDERS = new Set<ImageProviderUsed>([
  "unorouter",
  "nanobanana",
  "skywork",
]);

export type GenerateImageBufferOptions = {
  schematicPrompt?: string;
  workflowPrompt?: string;
};

export async function generateImageBuffer(
  prompt: string,
  options?: GenerateImageBufferOptions,
): Promise<{ buffer: Buffer; provider: ImageProviderUsed }> {
  const errors: string[] = [];
  const face = await loadBrandFace();
  const requireIdentity = Boolean(face) && env.REQUIRE_BRAND_FACE;
  const schematicPrompt = options?.schematicPrompt;
  const workflowPrompt = options?.workflowPrompt;

  if (face) {
    console.log(
      `[imagePipeline] brand face ref: ${face.path} (${face.buffer.length} bytes` +
        `${face.prepared ? ", prepared" : ""}) — identity: UnoRouter + Nano Banana + Skywork`,
    );
  } else {
    console.warn(
      "[imagePipeline] no brand face configured — falling back to humanless schematic diagrams (odamsiz sxemalar)",
    );
  }

  // When no face is available, strictly use the humanless schematic prompt
  const effectivePrompt = face ? prompt : (schematicPrompt || prompt);

  // 1) UnoRouter (gpt-image-2:free primary + internal model fallbacks)
  if (isUnorouterConfigured() && canUseUnorouterToday().ok) {
    try {
      const buffer = await unorouterImage(effectivePrompt, {
        face,
        schematicPrompt,
        workflowPrompt,
      });
      return { buffer, provider: "unorouter" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`unorouter: ${msg}`);
      console.warn(
        "[imagePipeline] UnoRouter failed → Nano Banana:",
        msg.slice(0, 200),
      );
    }
  } else if (isUnorouterConfigured()) {
    const b = canUseUnorouterToday();
    errors.push(`unorouter: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] UnoRouter daily budget ${b.used}/${b.limit} → Nano Banana`,
    );
  } else {
    console.warn("[imagePipeline] UnoRouter not configured (UNOROUTER_API_KEY) → Nano Banana");
  }

  // 2) Nano Banana (Gemini native image + optional face)
  if (isNanoBananaConfigured() && canUseNanoBananaToday().ok) {
    try {
      const buffer = await nanoBananaImage(effectivePrompt, { face });
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

  // 3) Skywork
  if (isSkyworkConfigured() && canUseSkyworkToday().ok) {
    try {
      const buffer = await skyworkImage(effectivePrompt, { face });
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

  // 4) xKiro (strictly workflow style only — ZERO humans / ONLY workflow)
  if (isXkiroConfigured() && canUseXkiroToday().ok) {
    try {
      const targetWorkflowPrompt = workflowPrompt || schematicPrompt || prompt;
      const buffer = await xkiroImage(targetWorkflowPrompt, {
        face: null, // Strictly NO human face for xKiro: pure workflow diagrams only
        workflowPrompt: targetWorkflowPrompt,
      });
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

  const ur = isUnorouterConfigured() ? canUseUnorouterToday() : null;
  const nb = isNanoBananaConfigured() ? canUseNanoBananaToday() : null;
  const sw = isSkyworkConfigured() ? canUseSkyworkToday() : null;
  const xk = isXkiroConfigured() ? canUseXkiroToday() : null;
  throw new Error(
    `All image providers failed/exhausted${requireIdentity ? " (REQUIRE_BRAND_FACE=true)" : ""}.\n` +
      `Budgets: unorouter=${ur ? `${ur.used}/${ur.limit} rem=${ur.remaining}` : "off"} ` +
      `nanobanana=${nb ? `${nb.used}/${nb.limit} rem=${nb.remaining}` : "off"} ` +
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
      `(identity: UnoRouter + Nano Banana + Skywork — all support brand face; xKiro is strictly humanless workflow)`,
  );
  logUnorouterBudget();
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
