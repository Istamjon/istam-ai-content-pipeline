import { StateAnnotation, GraphUpdate } from "../state.js";
import { buildAndSaveCanonical } from "../../canonical/buildCanonical.js";
import { formatAllFromCanonical } from "../../canonical/formatFromCanonical.js";
import { generateText } from "../../lib/geminiText.js";
import { roles, buildEnglishPostUserPrompt } from "../prompts.js";
import { cleanPostBody } from "../../lib/contentClean.js";

export async function formatPosts(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    const current = state.current;
    if (!current || !current.rewritten) {
      return { errors: ["formatPosts: no rewritten content for canonical"] };
    }

    // 1) Generate English version of the approved post for LinkedIn & Threads
    let bodyEn = current.rewrittenEn;
    if (!bodyEn && current.rewritten) {
      try {
        console.log(
          `[formatPosts] generating English post for LinkedIn & Threads...`,
        );
        const enResult = await generateText(
          buildEnglishPostUserPrompt({
            title: current.title,
            uzbekPost: current.rewritten,
            sourceContext: current.rawText,
          }),
          roles.englishWriter,
        );
        bodyEn = cleanPostBody(enResult);
        console.log(
          `[formatPosts] English post generated: ${bodyEn.length} chars`,
        );
      } catch (err) {
        console.warn(
          `[formatPosts] English post generation failed, falling back to master body: ${String(err)}`,
        );
        bodyEn = undefined;
      }
    }

    // 2) Save / update master Canonical Content (source of truth)
    const canonical = buildAndSaveCanonical(current, {
      summary: current.summary,
      bodyEn,
    });

    // 3) Format all platforms (LinkedIn & Threads use bodyEn; others use Uzbek body)
    const formatted = formatAllFromCanonical(canonical);
    // Keep cache in sync on disk (already saved inside buildAndSaveCanonical with derived)
    void canonical.derived;

    const nonNull = Object.entries(formatted).filter(([, v]) => v?.text).length;
    console.log(
      `[formatPosts] from canonical id=${canonical.id} v${canonical.version} platforms=${nonNull} (en=${Boolean(canonical.bodyEn)})`,
    );
    console.log(
      "[formatPosts] LinkedIn (English) preview:\n",
      (formatted.linkedin?.text || "").slice(0, 200) + "...",
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
    };
  } catch (error) {
    return {
      errors: [`formatPosts/canonical error: ${String(error)}`],
    };
  }
}
