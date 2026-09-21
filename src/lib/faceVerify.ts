/**
 * Brand-face verification — "does the generated cover actually contain the owner's face?"
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  WHY THIS EXISTS
 * ────────────────────────────────────────────────────────────────────────────
 * Before this module, the pipeline never checked its own output. It sent
 * face.jpg to an image model as a *reference*, asked nicely in the prompt to
 * preserve the identity, and then published whatever came back. Nothing looked
 * at the result:
 *
 *   • qualityCheck.ts inspects TEXT only — a single mention of "image" in a comment.
 *   • publish.ts checks only that the file exists (fs.existsSync).
 *
 * That is why two providers could silently drop the brand face for months
 * (see audit/BRAND-FACE-DIAGNOSIS.md, Sabab 1, 2 and 5) — a generic stranger was
 * published as the brand owner and every automated check said "fine".
 *
 * This module closes the loop with a Gemini vision pass: the reference photo and
 * the generated cover are shown to the model together and it must answer whether
 * the SAME individual appears. On failure the image is rejected and
 * imagePipeline cascades to the next identity provider.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  FAILURE POLICY (deliberate, documented)
 * ────────────────────────────────────────────────────────────────────────────
 *   • Verification RUNS and says "different person" (or confidence below
 *     FACE_VERIFY_MIN_CONFIDENCE) → ok=false → the image is REJECTED.
 *   • Verification CANNOT run (no Gemini key, soft quota reached, network error,
 *     unparseable model output) → skipped=true, ok=true → the image is ACCEPTED
 *     with a loud warning.
 *
 * The second case is intentionally non-blocking: this pass is a safety net on top
 * of the primary mechanism (face.jpg + identity prompt), not the mechanism itself.
 * Blocking all publishing whenever the free Gemini quota runs out would turn a
 * quality guard into an outage. The warning makes the gap visible in the logs.
 *
 * Quota is tracked in its own bucket ("faceverify") so verification can never
 * starve article text generation, which shares the same Gemini keys.
 */
import { env } from "../config/env.js";
import {
  getProviderImageBudget,
  incrementProviderImageUsage,
} from "../db.js";
import type { BrandFaceRef } from "./brandFace.js";

/** Separate soft-budget bucket so verification never eats the text quota. */
const VERIFY_BUCKET = "faceverify";

export type FaceVerifyResult = {
  /** Accept the image? false = rejected, cascade to the next provider. */
  ok: boolean;
  /** What the vision model decided (meaningless when skipped). */
  samePerson: boolean;
  /** 0–1, as reported by the model. */
  confidence: number;
  reason: string;
  model: string;
  /** true = verification could not run; the image was accepted unverified. */
  skipped: boolean;
};

/** Gemini keys in priority order (same keys as text/image, deduped). */
function visionKeys(): string[] {
  return [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3]
    .map((k) => (k || "").trim())
    .filter(Boolean)
    .filter((k, i, arr) => arr.indexOf(k) === i);
}

/** True when a verification pass could actually run right now. */
export function isFaceVerifyAvailable(): boolean {
  if (!env.FACE_VERIFY) return false;
  if (visionKeys().length === 0) return false;
  const limit = env.DAILY_FACEVERIFY_LIMIT;
  if (limit <= 0) return true; // unlimited soft cap
  return getProviderImageBudget(VERIFY_BUCKET, limit).remaining > 0;
}

/**
 * Strict identity-check instruction. Written to be conservative about what counts
 * as "the same person": stable facial structure yes, scene styling no.
 */
const VERIFY_PROMPT = [
  `You are a strict identity checker for a personal-brand social media cover.`,
  `Image 1 is the REFERENCE photo of the brand owner (face.jpg).`,
  `Image 2 is a GENERATED cover image.`,
  `Decide whether the SAME individual appears in image 2.`,
  `Compare: face shape, jawline, nose, eyes, eyebrows, hairline, and facial hair.`,
  `Ignore: pose, clothing, lighting, background, camera angle, and reasonable age differences.`,
  `If image 2 contains no clear human face at all, set same_person to false and confidence to 0.`,
  `Return ONLY the JSON object. No prose, no markdown fences.`,
].join(" ");

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    same_person: { type: "boolean" },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["same_person", "confidence", "reason"],
} as const;

type ParsedVerdict = {
  samePerson: boolean;
  confidence: number;
  reason: string;
};

/**
 * Pull the verdict out of the model response.
 * Tolerates ```json fences and stray prose; returns null when nothing usable is
 * found (caller then treats the pass as "skipped", never as a rejection).
 */
function parseVerdict(raw: string): ParsedVerdict | null {
  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      obj = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  const o = obj as {
    same_person?: unknown;
    samePerson?: unknown;
    confidence?: unknown;
    reason?: unknown;
  };
  const sameRaw = o.same_person ?? o.samePerson;
  if (typeof sameRaw !== "boolean") return null;

  let confidence = typeof o.confidence === "number" ? o.confidence : 0.5;
  if (!Number.isFinite(confidence)) confidence = 0.5;
  // Models occasionally answer 0–100 instead of 0–1.
  if (confidence > 1) confidence = confidence / 100;
  confidence = Math.min(1, Math.max(0, confidence));

  return {
    samePerson: sameRaw,
    confidence,
    reason: typeof o.reason === "string" ? o.reason.slice(0, 300) : "",
  };
}

function extractText(json: unknown): string {
  const obj = json as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };
  if (obj.error?.message) throw new Error(obj.error.message);
  const parts = obj.candidates?.[0]?.content?.parts;
  if (!parts?.length) throw new Error("empty response");
  return parts.map((p) => p.text || "").join("").trim();
}

/** Single-key vision call: reference + generated image + strict JSON verdict. */
async function verifyWithKey(
  apiKey: string,
  face: BrandFaceRef,
  generated: Buffer,
  generatedMime: string,
): Promise<ParsedVerdict> {
  const model = (env.GEMINI_VISION_MODEL || "gemini-2.5-flash").replace(
    /^models\//,
    "",
  );
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: VERIFY_PROMPT },
          { inlineData: { mimeType: face.mimeType, data: face.base64 } },
          {
            inlineData: {
              mimeType: generatedMime,
              data: generated.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 256,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  const raw = await res.text();
  let json: unknown = raw;
  try {
    json = JSON.parse(raw);
  } catch {
    /* keep raw for the error message */
  }

  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } })?.error?.message ||
      raw.slice(0, 200);
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }

  const verdict = parseVerdict(extractText(json));
  if (!verdict) throw new Error("unparseable verdict JSON");
  return verdict;
}

/**
 * Verify that `generated` contains the same person as the brand face reference.
 *
 * Never throws: infrastructure problems come back as `skipped: true, ok: true`
 * so a verification outage cannot halt publishing (see FAILURE POLICY above).
 */
export async function verifyBrandFace(params: {
  generated: Buffer;
  face: BrandFaceRef;
  generatedMime?: string;
}): Promise<FaceVerifyResult> {
  const model = env.GEMINI_VISION_MODEL || "gemini-2.5-flash";
  const base = { samePerson: false, confidence: 0, model, skipped: true };

  if (!env.FACE_VERIFY) {
    return { ...base, ok: true, reason: "FACE_VERIFY=false" };
  }

  const keys = visionKeys();
  if (keys.length === 0) {
    return { ...base, ok: true, reason: "no GEMINI_API_KEY for verification" };
  }

  const limit = env.DAILY_FACEVERIFY_LIMIT;
  if (limit > 0) {
    const b = getProviderImageBudget(VERIFY_BUCKET, limit);
    if (b.remaining <= 0) {
      return {
        ...base,
        ok: true,
        reason: `verification soft quota reached (${b.used}/${b.limit} UTC)`,
      };
    }
  }

  const generatedMime = params.generatedMime || "image/png";

  for (const apiKey of keys) {
    try {
      const verdict = await verifyWithKey(
        apiKey,
        params.face,
        params.generated,
        generatedMime,
      );
      if (limit > 0) incrementProviderImageUsage(VERIFY_BUCKET, 1);

      const ok =
        verdict.samePerson &&
        verdict.confidence >= env.FACE_VERIFY_MIN_CONFIDENCE;

      console.log(
        `[faceVerify] model=${model} same_person=${verdict.samePerson} ` +
          `confidence=${verdict.confidence.toFixed(2)} ` +
          `threshold=${env.FACE_VERIFY_MIN_CONFIDENCE} → ${ok ? "ACCEPT" : "REJECT"}` +
          (verdict.reason ? ` | ${verdict.reason}` : ""),
      );

      return {
        ok,
        samePerson: verdict.samePerson,
        confidence: verdict.confidence,
        reason: verdict.reason,
        model,
        skipped: false,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[faceVerify] key …${apiKey.slice(-6)} failed → next key: ${msg.slice(0, 160)}`,
      );
    }
  }

  return {
    ...base,
    ok: true,
    reason: "all verification keys failed (see warnings above)",
  };
}

/** Startup/dry-run report, mirroring the other provider budget logs. */
export function logFaceVerifyBudget(): void {
  if (!env.FACE_VERIFY) {
    console.log("[AI] FACE VERIFY: disabled (FACE_VERIFY=false)");
    return;
  }
  const keys = visionKeys().length;
  if (keys === 0) {
    console.log("[AI] FACE VERIFY: no GEMINI_API_KEY — covers accepted unverified");
    return;
  }
  const limit = env.DAILY_FACEVERIFY_LIMIT;
  const b = limit > 0 ? getProviderImageBudget(VERIFY_BUCKET, limit) : null;
  console.log(
    `[AI] FACE VERIFY: model=${env.GEMINI_VISION_MODEL} keys=${keys} ` +
      `budget=${b ? `${b.used}/${b.limit}` : "∞"} ` +
      `minConfidence=${env.FACE_VERIFY_MIN_CONFIDENCE}`,
  );
}
