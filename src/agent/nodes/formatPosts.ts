import { StateAnnotation, GraphUpdate } from "../state.js";
import { buildAndSaveCanonical } from "../../canonical/buildCanonical.js";
import { formatAllFromCanonical } from "../../canonical/formatFromCanonical.js";
import { generateText } from "../../lib/geminiText.js";
import { roles, buildEnglishPostUserPrompt } from "../prompts.js";
import { cleanPostBody } from "../../lib/contentClean.js";
import { describeError } from "../../lib/errText.js";

/**
 * English-body attempts per run.
 *
 * `generateText` already rotates across every Gemini key, so one attempt is
 * several calls deep. A 503 ("high demand") is transient and the next attempt a
 * few seconds later normally succeeds; the point of the outer loop is that a
 * blip no longer costs the run its LinkedIn and Threads slots.
 */
const EN_ATTEMPTS = 3;
/** Backoff between attempts: attempt n waits n × this. */
const EN_RETRY_DELAY_MS = 4_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function formatPosts(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    const current = state.current;
    if (!current || !current.rewritten) {
      return { errors: ["formatPosts: no rewritten content for canonical"] };
    }

    // 1) Generate English version of the approved post for LinkedIn & Threads.
    //
    // LinkedIn and Threads are English-only surfaces. This used to make ONE
    // attempt and, on any failure, quietly fall back to the Uzbek master body —
    // so a single transient Gemini 503 published Uzbek to LinkedIn with no
    // visible error. It now retries, treats an empty result as a failure, and
    // records the failure instead of hiding it.
    let bodyEn = current.rewrittenEn?.trim() || undefined;
    if (!bodyEn && current.rewritten) {
      const enPrompt = buildEnglishPostUserPrompt({
        title: current.title,
        uzbekPost: current.rewritten,
        sourceContext: current.rawText,
      });
      for (let attempt = 1; attempt <= EN_ATTEMPTS; attempt += 1) {
        try {
          console.log(
            `[formatPosts] generating English post for LinkedIn & Threads (attempt ${attempt}/${EN_ATTEMPTS})...`,
          );
          const enResult = await generateText(enPrompt, roles.englishWriter);
          const cleaned = cleanPostBody(enResult).trim();
          // An empty body is a failure, not a success of length 0. The old code
          // assigned it straight to `bodyEn` and let the silent fallback hide it.
          if (!cleaned) {
            throw new Error("English writer returned an empty body");
          }
          bodyEn = cleaned;
          console.log(
            `[formatPosts] English post generated: ${bodyEn.length} chars`,
          );
          break;
        } catch (err) {
          console.warn(
            `[formatPosts] English post attempt ${attempt}/${EN_ATTEMPTS} failed: ${describeError(err)}`,
          );
          if (attempt < EN_ATTEMPTS) await sleep(EN_RETRY_DELAY_MS * attempt);
        }
      }
    }

    // 2) Save / update master Canonical Content (source of truth)
    const canonical = buildAndSaveCanonical(current, {
      summary: current.summary,
      bodyEn,
    });

    // 3) Format all platforms. LinkedIn & Threads are English-only: without a
    //    bodyEn they come back null and the publish layer marks them `skipped`.
    //    Posting the Uzbek master there instead is a language defect, not a
    //    graceful degradation.
    const formatted = formatAllFromCanonical(canonical);
    // Keep cache in sync on disk (already saved inside buildAndSaveCanonical with derived)
    void canonical.derived;

    const enMissing = !canonical.bodyEn;
    if (enMissing) {
      console.warn(
        "[formatPosts] NO ENGLISH BODY — LinkedIn and Threads are SKIPPED for this run. " +
          "They are English-only surfaces; the Uzbek master is not a substitute.",
      );
    }

    const nonNull = Object.entries(formatted).filter(([, v]) => v?.text).length;
    console.log(
      `[formatPosts] from canonical id=${canonical.id} v${canonical.version} platforms=${nonNull} (en=${!enMissing})`,
    );
    console.log(
      "[formatPosts] LinkedIn (English) preview:\n",
      (formatted.linkedin?.text || "(none — English body unavailable)").slice(
        0,
        200,
      ) + "...",
    );
    console.log(
      "[formatPosts] Telegram (Uzbek) preview:\n",
      (formatted.telegram?.caption || formatted.telegram?.text || "").slice(0, 200) + "...",
    );

    return {
      formatted,
      canonical,
      current: {
        ...current,
        rewritten: canonical.body,
        rewrittenEn: canonical.bodyEn,
        imagePath: canonical.imagePath || current.imagePath,
      },
      // Surface the skip in the run summary. Without this the run reported
      // `errors: []` while LinkedIn and Threads silently got nothing.
      ...(enMissing
        ? {
            errors: [
              "formatPosts: English body unavailable after " +
                `${EN_ATTEMPTS} attempts — LinkedIn and Threads skipped ` +
                "(English-only surfaces, never posted in Uzbek)",
            ],
          }
        : {}),
    };
  } catch (error) {
    return {
      errors: [`formatPosts/canonical error: ${describeError(error)}`],
    };
  }
}
