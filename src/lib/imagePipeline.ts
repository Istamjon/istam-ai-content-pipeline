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
 *  4) xKiro — sensenova-u1.5-lite       ❌ FACE.JPG YO'Q (matn → kontentga mos cover)
 *     • Faqat text-to-image: face.jpg yo'q, shuning uchun brend portreti chizilmaydi
 *     • Buning o'rniga mavzuga mos, feed'da bosiladigan cover yaratadi
 *     • Rejimlar (buildEngagingImagePrompt): editorial scena / metafora / diagram
 *     • Rejimlar seed bo'yicha rotatsiya qilinadi — har post bir xil sxema emas
 *     • Face.jpg bilan HARAKAT QILINMAYDI — bu absolute last resort
 *
 * ════════════════════════════════════════════════════════════════════
 *  FALLBACK CHAIN
 * ════════════════════════════════════════════════════════════════════
 *  face.jpg bor → UnoRouter(edit) → NanoBanana(multimodal) → Skywork(edit) → xKiro(cover)
 *  face.jpg yo'q → UnoRouter(prompt) → NanoBanana(prompt) → Skywork(prompt) → xKiro(cover)
 *
 *  xKiro FAQAT 1-3 hammasi muvaffaqiyatsiz bo'lgandagina ishga tushadi.
 *  xKiro cover'ida taniladigan inson yuzi bo'lmaydi (silhouette/back-view
 *  mumkin) — face.jpg yo'qligi sababli. Qolgan hamma narsa mavzuga mos.
 *
 * ════════════════════════════════════════════════════════════════════
 *  FACE VERIFICATION (REQUIRE_BRAND_FACE=true bo'lganda)
 * ════════════════════════════════════════════════════════════════════
 *  Har bir identity provayder qaytargan rasm Gemini vision bilan TEKSHIRILADI
 *  (src/lib/faceVerify.ts): "face.jpg dagi odam shumi?"
 *
 *  O'tmasa → rasm RAD ETILADI va zanjir keyingi provayderga o'tadi. Bu
 *  "model itoat qildi degan umid"ni "majburiy shart"ga aylantiradi — Sabab 1/2
 *  kabi jimgina yo'qolishlar endi birinchi urinishdanoq ushlanadi.
 *
 *  xKiro tekshirilmaydi: unga face.jpg berilmaydi, tekshiradigan identity yo'q.
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
import {
  verifyBrandFace,
  logFaceVerifyBudget,
} from "./faceVerify.js";
import { describeError } from "./errText.js";

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
  /** Strict workflow diagram prompt (the `diagram` xKiro mode). */
  workflowPrompt?: string;
  /**
   * Mode-aware xKiro cover prompt (editorial scene / physical metaphor /
   * diagram), built by `buildEngagingImagePrompt`. Preferred over
   * `workflowPrompt` so the last-resort cover varies with the article instead of
   * repeating one flat flowchart.
   */
  xkiroPrompt?: string;
};

export async function generateImageBuffer(
  prompt: string,
  options?: GenerateImageBufferOptions,
): Promise<{ buffer: Buffer; provider: ImageProviderUsed }> {
  const errors: string[] = [];
  /**
   * One entry per provider decision, in chain order.
   *
   * `image_provider_usage` counts SUCCESSES only (`incrementProviderImageUsage`
   * runs immediately before a provider returns its buffer), so a provider that
   * fails every single time is indistinguishable in the ledger from one that was
   * never called — both read `0`. A real run showed `UNOROUTER 0/15` and
   * `NANOBANANA 0/12` while Skywork, which was demonstrably attempted, also read
   * `0/20`; the ledger could not tell them apart and the surrounding log had
   * already scrolled past the evidence.
   *
   * So the decision trail is emitted as ONE line on every exit path. A single
   * line survives even a 15-line log tail, which is what the ops workflow used
   * to print.
   */
  const decisions: string[] = [];
  const face = await loadBrandFace();
  const requireIdentity = Boolean(face) && env.REQUIRE_BRAND_FACE;
  const schematicPrompt = options?.schematicPrompt;
  const workflowPrompt = options?.workflowPrompt;
  const xkiroPrompt = options?.xkiroPrompt;

  // ── Brand face status log ──────────────────────────────────────────
  if (face) {
    console.log(
      `[imagePipeline] brand face: ${face.path} (${face.buffer.length} bytes` +
        `${face.prepared ? ", prepared/downscaled" : ""})` +
        ` — chain: UnoRouter(edit) → NanoBanana(multimodal) → Skywork(edit) → xKiro(cover, no face)`,
    );
  } else {
    console.warn(
      "[imagePipeline] brand face NOT found — providers use text-only prompt; xKiro will generate workflow diagram",
    );
  }

  // When face is absent, use humanless schematic prompt for providers 1–3 as well
  const identityPrompt = face ? prompt : (schematicPrompt || prompt);

  // ── Face verification gate ─────────────────────────────────────────
  // Only meaningful when we are actually demanding identity: a face reference
  // exists AND REQUIRE_BRAND_FACE is on. xKiro is excluded by design (diagram).
  const verifyEnabled = requireIdentity && env.FACE_VERIFY;

  /** Emit the one-line decision trail. Must run on every exit path. */
  const logChain = (provider: ImageProviderUsed | "none"): void => {
    console.log(
      `[imagePipeline] chain: ${decisions.join(" ")} → ${provider}`,
    );
  };

  /**
   * Accept a provider's output only if it passes the vision check.
   * Throwing here is deliberate: the surrounding try/catch turns it into a
   * cascade to the next provider, exactly like an API failure.
   */
  const acceptIdentity = async (
    buffer: Buffer,
    provider: ImageProviderUsed,
  ): Promise<{ buffer: Buffer; provider: ImageProviderUsed }> => {
    if (!verifyEnabled || !face) {
      decisions.push(`${provider}=ok`);
      logChain(provider);
      return { buffer, provider };
    }

    const v = await verifyBrandFace({ generated: buffer, face });
    if (v.skipped) {
      decisions.push(`${provider}=ok(unverified)`);
      console.warn(
        `[imagePipeline] ${provider}: face verification SKIPPED (${v.reason}) — accepting unverified`,
      );
      logChain(provider);
      return { buffer, provider };
    }
    if (v.ok) {
      decisions.push(`${provider}=ok`);
      console.log(
        `[imagePipeline] ✅ ${provider}: brand face verified (confidence=${v.confidence.toFixed(2)})`,
      );
      logChain(provider);
      return { buffer, provider };
    }
    decisions.push(`${provider}=verify-failed`);
    throw new Error(
      `brand face verification FAILED on ${provider} ` +
        `(same_person=${v.samePerson}, confidence=${v.confidence.toFixed(2)} < ` +
        `${env.FACE_VERIFY_MIN_CONFIDENCE})${v.reason ? ` — ${v.reason}` : ""}`,
    );
  };

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
        // Identity required → let a failed face-edit cascade to Nano Banana
        // instead of UnoRouter silently returning a faceless image.
        requireFace: requireIdentity,
      });
      // Reject (and cascade) if the face did not actually survive generation.
      return await acceptIdentity(buffer, "unorouter");
    } catch (e) {
      const msg = describeError(e);
      errors.push(`unorouter: ${msg}`);
      decisions.push("unorouter=failed");
      console.warn(
        `[imagePipeline] UnoRouter FAILED → 2) Nano Banana | ${msg.slice(0, 200)}`,
      );
    }
  } else if (isUnorouterConfigured()) {
    const b = canUseUnorouterToday();
    errors.push(`unorouter: budget ${b.used}/${b.limit}`);
    decisions.push(`unorouter=budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] UnoRouter budget exhausted (${b.used}/${b.limit} rem=${b.remaining}) → 2) Nano Banana`,
    );
  } else {
    decisions.push("unorouter=not-configured");
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
      // Reject (and cascade) if the face did not actually survive generation.
      return await acceptIdentity(buffer, "nanobanana");
    } catch (e) {
      const msg = describeError(e);
      errors.push(`nanobanana: ${msg}`);
      decisions.push("nanobanana=failed");
      console.warn(
        `[imagePipeline] Nano Banana FAILED → 3) Skywork | ${msg.slice(0, 200)}`,
      );
    }
  } else if (isNanoBananaConfigured()) {
    const b = canUseNanoBananaToday();
    errors.push(`nanobanana: budget ${b.used}/${b.limit}`);
    decisions.push(`nanobanana=budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] Nano Banana budget exhausted (${b.used}/${b.limit} rem=${b.remaining}) → 3) Skywork`,
    );
  } else {
    decisions.push("nanobanana=not-configured");
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
      // Reject (and cascade) if the face did not actually survive generation.
      return await acceptIdentity(buffer, "skywork");
    } catch (e) {
      const msg = describeError(e);
      errors.push(`skywork: ${msg}`);
      decisions.push("skywork=failed");
      console.warn(
        `[imagePipeline] Skywork FAILED → 4) xKiro LAST RESORT (content cover, no face) | ${msg.slice(0, 200)}`,
      );
    }
  } else if (isSkyworkConfigured()) {
    const b = canUseSkyworkToday();
    errors.push(`skywork: budget ${b.used}/${b.limit}`);
    decisions.push(`skywork=budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] Skywork budget exhausted (${b.used}/${b.limit} rem=${b.remaining}) → 4) xKiro last resort`,
    );
  } else {
    decisions.push("skywork=not-configured");
    console.warn("[imagePipeline] Skywork not configured → 4) xKiro last resort");
  }

  // ══════════════════════════════════════════════════════════════════
  // 4) xKiro — ABSOLUTE LAST RESORT
  //    ❌ face.jpg ISHLATILMAYDI — model free tier image edit qilmaydi
  //    ✅ Mavzuga mos workflow/sxema diagram (topic-aware, no humans)
  //    Muammo: async job — 3+ daqiqa kutish mumkin
  // ══════════════════════════════════════════════════════════════════
  if (isXkiroConfigured() && canUseXkiroToday().ok) {
    // Prefer the mode-aware cover prompt (editorial scene / physical metaphor /
    // diagram) and fall back to the diagram prompt only when the node did not
    // build one — e.g. a caller that only has a schematic.
    const chosenXkiroPrompt =
      xkiroPrompt || workflowPrompt || schematicPrompt || prompt;
    const promptSource = xkiroPrompt
      ? "xkiroPrompt (content-matched cover)"
      : workflowPrompt
        ? "workflowPrompt (diagram)"
        : schematicPrompt
          ? "schematicPrompt (no humans)"
          : "main prompt";
    console.warn(
      `[imagePipeline] → 4) xKiro LAST RESORT — text-to-image, NO face.jpg. ` +
        `All identity providers failed/exhausted. Prompt: ${promptSource}`,
    );
    try {
      const buffer = await xkiroImage(chosenXkiroPrompt, {
        face: null, // ← no reference photo: xKiro renders a face-free cover
        xkiroPrompt: chosenXkiroPrompt,
      });
      // Deliberately NOT face-verified: xKiro never receives face.jpg, so there
      // is no identity to check — the cover is content-matched, not a portrait.
      decisions.push("xkiro=cover");
      logChain("xkiro");
      console.warn(
        "[imagePipeline] xKiro produced a face-free content cover — " +
          "post will publish without the brand portrait.",
      );
      return { buffer, provider: "xkiro" };
    } catch (e) {
      const msg = describeError(e);
      errors.push(`xkiro: ${msg}`);
      decisions.push("xkiro=failed");
      console.warn(
        `[imagePipeline] xKiro FAILED — ALL providers exhausted: ${msg.slice(0, 200)}`,
      );
    }
  } else if (isXkiroConfigured()) {
    const b = canUseXkiroToday();
    errors.push(`xkiro: budget ${b.used}/${b.limit}`);
    decisions.push(`xkiro=budget ${b.used}/${b.limit}`);
    console.warn(
      `[imagePipeline] xKiro budget exhausted (${b.used}/${b.limit}) — ALL providers exhausted`,
    );
  } else {
    decisions.push("xkiro=not-configured");
    console.warn("[imagePipeline] xKiro not configured (XKIRO_API_KEY) — ALL providers exhausted");
  }

  const ur = isUnorouterConfigured() ? canUseUnorouterToday() : null;
  const nb = isNanoBananaConfigured() ? canUseNanoBananaToday() : null;
  const sw = isSkyworkConfigured() ? canUseSkyworkToday() : null;
  const xk = isXkiroConfigured() ? canUseXkiroToday() : null;
  logChain("none");
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
      `Last resort: 4)xKiro(content-matched cover: editorial / metaphor / diagram, NO face)`,
  );
  logFaceVerifyBudget();
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
