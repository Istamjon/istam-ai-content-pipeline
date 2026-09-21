/**
 * Single source of truth for the brand person's identity wording.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  WHY THIS MODULE EXISTS
 * ────────────────────────────────────────────────────────────────────────────
 * The identity sentence ("clean-shaven Uzbek man, mid-30s, NO beard …") used to
 * be copy-pasted into FOUR modules:
 *   - config/imagePrompt.ts      (3 separate copies)
 *   - lib/unorouterImage.ts
 *   - lib/xkiroImage.ts
 *   - lib/skyworkImage.ts
 *
 * Two things went wrong because of that:
 *   1. DRIFT — editing one copy left the others contradicting each other.
 *   2. STALENESS — the pipeline does NOT detect faces (see
 *      audit/BRAND-FACE-DIAGNOSIS.md, Sabab 5). The ONLY identity signals the
 *      model receives are face.jpg itself and this text. If the real appearance
 *      changes (you grow a beard), every stale copy actively FIGHTS the
 *      reference photo and confuses the model.
 *
 * Keep it here, keep it single, make it env-overridable:
 *   BRAND_IDENTITY_DESCRIPTION="Uzbek man in his late 30s, short beard, ..."
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  HOW TO USE
 * ────────────────────────────────────────────────────────────────────────────
 *   identityCore()        → "Uzbek man in his mid-30s, completely clean-shaven…"
 *   noFacialHairClause()  → "strictly NO beard, NO mustache, NO goatee…"
 *   identityClause()      → identityCore() + noFacialHairClause()  (most common)
 *   likenessClause()      → "EXACT LIKENESS TO face.jpg — <identityClause()>"
 *   antiPoseClause()      → "Do NOT copy face.jpg pose, hands, crop, clothes…"
 */
import { env } from "./env.js";

/** Fallback used when BRAND_IDENTITY_DESCRIPTION is unset. */
const DEFAULT_IDENTITY =
  "Uzbek man in his mid-30s, completely clean-shaven, short dark textured hair with neat faded sides, dark brown eyes";

/**
 * Negative facial-hair wording. Facial hair is the single most common drift
 * between a reference photo and a generated cover, so it is spelled out
 * negatively (what NOT to draw) as well as positively.
 */
const NO_FACIAL_HAIR =
  "strictly NO beard, NO mustache, NO goatee, smooth clean jawline and cheeks";

/**
 * The person's appearance. Prefers the env override so a real-world change
 * (beard, haircut, age) can be applied with an .env edit and no redeploy of code.
 */
export function identityCore(): string {
  const custom = (env.BRAND_IDENTITY_DESCRIPTION || "").trim();
  return custom || DEFAULT_IDENTITY;
}

/** "strictly NO beard, NO mustache, NO goatee, smooth clean jawline and cheeks" */
export function noFacialHairClause(): string {
  return NO_FACIAL_HAIR;
}

/**
 * The workhorse: appearance + explicit facial-hair negatives.
 * This is what should be pasted into any prompt that must preserve the face.
 */
export function identityClause(): string {
  return `${identityCore()}, ${NO_FACIAL_HAIR}`;
}

/**
 * Strongest form, for edit / image-to-image prompts where face.jpg is actually
 * attached. The model is told the likeness is mandatory, not decorative.
 */
export function likenessClause(): string {
  return `EXACT LIKENESS TO face.jpg — the SAME person: ${identityClause()}`;
}

/**
 * The complement: identity must be preserved, but nothing ELSE from the
 * reference photo may be cloned. Without this the model tends to copy the
 * reference pose, crop, hands and background, producing near-duplicate covers.
 */
export function antiPoseClause(): string {
  return "Do NOT copy face.jpg pose, hands, crop, clothing, or background — identity only, new pose and scene.";
}

/** One-line summary for startup logs (never log the full prompt). */
export function describeIdentity(): string {
  return `identity="${identityCore().slice(0, 72)}${identityCore().length > 72 ? "…" : ""}" source=${
    (env.BRAND_IDENTITY_DESCRIPTION || "").trim() ? "env" : "default"
  }`;
}

/**
 * True when the configured identity describes a person with NO facial hair.
 *
 * WHY THIS EXISTS — negative prompts must not contradict the positive one.
 * Every cover prompt ends with a "Hard avoid: beard, goatee, mustache…" list.
 * If someone sets BRAND_IDENTITY_DESCRIPTION to describe a beard, that avoid
 * list would tell the model to erase the very feature they asked for. Gating it
 * on this flag keeps the two halves of the prompt consistent.
 */
export function facialHairForbidden(): boolean {
  return !/\b(beard|stubble|goatee|mustache|moustache|facial\s*hair)\b/i.test(
    identityCore(),
  );
}

/**
 * Facial-hair terms for the negative prompt, or "" when the person is meant to
 * have facial hair (see facialHairForbidden). Safe to interpolate directly.
 */
export function facialHairAvoidTerms(): string {
  return facialHairForbidden()
    ? "beard, facial hair, goatee, mustache, stubble beard, "
    : "";
}
