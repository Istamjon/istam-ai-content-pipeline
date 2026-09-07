/**
 * Image generation waterfall — brand face identity first, workflow fallback last.
 *
 * ════════════════════════════════════════════════════════════════════
 *  PROVIDER CAPABILITIES (face.jpg bilan ishlash)
 * ════════════════════════════════════════════════════════════════════
 *
 *  1) UnoRouter — gpt-image-2:free      ✅ FACE.JPG (/images/edits multipart)
 *     • Edit API: face.jpg → multipart FormData → identity-preserving image
 *     • Fallback within: /images/generations (prompt-guided, no image ref)
 *     • Kamchilik: free tier = 1 req/min → model cooling 60s after 429
 *     • Muammo: edit API ba'zan 400/422 qaytaradi (model versiyasiga bog'liq)
 *
 *  2) Nano Banana — Gemini image models  ✅ FACE.JPG (multimodal inlineData)
 *     • face.jpg → base64 → inlineData part in generateContent
 *     • Models: gemini-2.5-flash-image → gemini-3.1-flash-image → ...
 *     • Kamchilik: Gemini free tier juda past image quota (≈4/key/kun)
 *     • Muammo: 429 RESOURCE_EXHAUSTED tez yetadi; ba'zan model 404
 *
 *  3) Skywork — theme-gateway SSE       ✅ FACE.JPG (/api/sse/image/update)
 *     • face.jpg → base64 → source_images → SSE streaming response
 *     • Kamchilik: credit asosida (to'ldirish kerak), bepul emas
 *     • Muammo: SSE ba'zan "no file_url" bilan tugaydi; SERVICE_ERROR mumkin
 *
 *  4) xKiro — sensenova-u1.5-lite       ❌ FACE.JPG YO'Q (workflow/sxema only)
 *     • Faqat text-to-image: mavzuga mos workflow diagramlar, arxitektura sxemalar
 *     • Face.jpg bilan HARAKAT QILINMAYDI — bu absolute last resort
 *     • gpt-image edit API xKiro-da paid model talab qiladi → ishlatilmaydi
 *     • workflowPrompt/schematicPrompt bilan chaqiriladi (topic-aware diagram)
 *
 * ════════════════════════════════════════════════════════════════════
 *  FALLBACK CHAIN
 * ════════════════════════════════════════════════════════════════════
 *  face.jpg bor → UnoRouter(edit) → NanoBanana(multimodal) → Skywork(edit) → xKiro(workflow)
 *  face.jpg yo'q → UnoRouter(prompt) → NanoBanana(prompt) → Skywork(prompt) → xKiro(workflow)
 *
 *  xKiro FAQAT 1-3 hammasi muvaffaqiyatsiz bo'lgandagina ishga tushadi.
 *  xKiro workflow diagramida insonlar bo'lmaydi — faqat mavzuga mos sxema.
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

/**
 * Providers that attempt brand face identity (edit API or multimodal inlineData).
 * xKiro intentionally excluded — workflow diagrams only, never human faces.
 */
const IDENTITY_PROVIDERS = new Set<ImageProviderUsed>([
  "unorouter",
  "nanobanana",
  "skywork",
]);

export type GenerateImageBufferOptions = {
  /** Humanless schematic prompt (used when face is missing for providers 1-3). */
  schematicPrompt?: string;
  /** Strict workflow diagram prompt (used exclusively for xKiro last-resort). */
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

  // ── Brand face status log ──────────────────────────────────────────
  if (face) {
    console.log(
      `[imagePipeline] brand face: ${face.path} (${face.buffer.length} bytes` +
        `${face.prepared ? ", prepared/downscaled" : ""})` +
        ` — chain: UnoRouter(edit) → NanoBanana(multimodal) → Skywork(edit) → xKiro(workflow-only)`,
    );
  } else {
    console.warn(
      "[imagePipeline] brand face NOT found — providers use text-only prompt; xKiro will generate workflow diagram",
    );
  }

  // When face is absent, use humanless schematic prompt for providers 1–3 as well
  const identityPrompt = face ? prompt : (schematicPrompt || prompt);

  // ══════════════════════════════════════════════════════════════════
  // 1) UnoRouter — gpt-image-2:free
  //    ✅ face.jpg: /images/edits multipart FormData
  //    Fallback within: /images/generations (prompt-only)
  //    Kamchilik: 1 req/min free tier; edit API 400/422 ba'zan
  // ══════════════════════════════════════════════════════════════════
  if (isUnorouterConfigured() && canUseUnorouterToday().ok) {
    console.log(
      `[imagePipeline] → 1) UnoRouter gpt-image-2:free${face ? " + edit API face.jpg" : ""}`,
    );
    try {
      const buffer = await unorouterImage(identityPrompt, {
        face,
        schematicPrompt,
        workflowPrompt,
      });
      return { buffer, provider: "unorouter" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`unorouter: ${msg}`);
      console.warn(
        `[imagePipeline] UnoRouter FAILED → 2) Nano Banana | ${msg.slice(0, 200)}`,
      );
    }
  } else if (isUnorouterConfigured()) {
    const b = canUseUnorouterToday();
    errors.push(`unorouter: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] UnoRouter budget exhausted (${b.used}/${b.limit} rem=${b.remaining}) → 2) Nano Banana`,
    );
  } else {
    console.warn("[imagePipeline] UnoRouter not configured → 2) Nano Banana");
  }

  // ══════════════════════════════════════════════════════════════════
  // 2) Nano Banana — Gemini image models
  //    ✅ face.jpg: base64 inlineData in generateContent (multimodal)
  //    Kamchilik: ≈4 image/key/kun free quota, 429 tez yetadi
  // ══════════════════════════════════════════════════════════════════
  if (isNanoBananaConfigured() && canUseNanoBananaToday().ok) {
    console.log(
      `[imagePipeline] → 2) Nano Banana (Gemini${face ? " + multimodal face.jpg inlineData" : ""})`,
    );
    try {
      const buffer = await nanoBananaImage(identityPrompt, { face });
      return { buffer, provider: "nanobanana" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`nanobanana: ${msg}`);
      console.warn(
        `[imagePipeline] Nano Banana FAILED → 3) Skywork | ${msg.slice(0, 200)}`,
      );
    }
  } else if (isNanoBananaConfigured()) {
    const b = canUseNanoBananaToday();
    errors.push(`nanobanana: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] Nano Banana budget exhausted (${b.used}/${b.limit} rem=${b.remaining}) → 3) Skywork`,
    );
  } else {
    console.warn("[imagePipeline] Nano Banana not configured → 3) Skywork");
  }

  // ══════════════════════════════════════════════════════════════════
  // 3) Skywork — theme-gateway SSE
  //    ✅ face.jpg: base64 → source_images → /api/sse/image/update
  //    Kamchilik: credit asosida; SSE ba'zan "no file_url"
  // ══════════════════════════════════════════════════════════════════
  if (isSkyworkConfigured() && canUseSkyworkToday().ok) {
    console.log(
      `[imagePipeline] → 3) Skywork SSE${face ? " + edit API face.jpg source_images" : ""}`,
    );
    try {
      const buffer = await skyworkImage(identityPrompt, { face });
      return { buffer, provider: "skywork" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`skywork: ${msg}`);
      console.warn(
        `[imagePipeline] Skywork FAILED → 4) xKiro LAST RESORT (workflow only) | ${msg.slice(0, 200)}`,
      );
    }
  } else if (isSkyworkConfigured()) {
    const b = canUseSkyworkToday();
    errors.push(`skywork: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] Skywork budget exhausted (${b.used}/${b.limit} rem=${b.remaining}) → 4) xKiro last resort`,
    );
  } else {
    console.warn("[imagePipeline] Skywork not configured → 4) xKiro last resort");
  }

  // ══════════════════════════════════════════════════════════════════
  // 4) xKiro — ABSOLUTE LAST RESORT
  //    ❌ face.jpg ISHLATILMAYDI — model free tier image edit qilmaydi
  //    ✅ Mavzuga mos workflow/sxema diagram (topic-aware, no humans)
  //    Muammo: async job — 3+ daqiqa kutish mumkin
  // ══════════════════════════════════════════════════════════════════
  if (isXkiroConfigured() && canUseXkiroToday().ok) {
    const xkiroPrompt = workflowPrompt || schematicPrompt || prompt;
    console.warn(
      `[imagePipeline] → 4) xKiro LAST RESORT — workflow diagram (NO face.jpg). ` +
        `All identity providers failed/exhausted. Prompt mode: ${
          workflowPrompt ? "workflowPrompt" : schematicPrompt ? "schematicPrompt" : "main prompt"
        }`,
    );
    try {
      const buffer = await xkiroImage(xkiroPrompt, {
        face: null,                  // ← NO face ref: xKiro = workflow diagrams only
        workflowPrompt: xkiroPrompt, // ← Forces topic-aware workflow diagram mode
      });
      return { buffer, provider: "xkiro" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`xkiro: ${msg}`);
      console.warn(
        `[imagePipeline] xKiro FAILED — ALL providers exhausted: ${msg.slice(0, 200)}`,
      );
    }
  } else if (isXkiroConfigured()) {
    const b = canUseXkiroToday();
    errors.push(`xkiro: budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] xKiro budget exhausted (${b.used}/${b.limit}) — ALL providers exhausted`,
    );
  } else {
    console.warn("[imagePipeline] xKiro not configured (XKIRO_API_KEY) — ALL providers exhausted");
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
    `[AI] REQUIRE_BRAND_FACE: ${env.REQUIRE_BRAND_FACE} | ` +
      `Face chain: 1)UnoRouter(edit) → 2)NanoBanana(multimodal) → 3)Skywork(edit) | ` +
      `Last resort: 4)xKiro(workflow diagram, NO face)`,
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
