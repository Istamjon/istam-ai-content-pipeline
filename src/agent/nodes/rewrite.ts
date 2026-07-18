import { StateAnnotation, GraphUpdate } from "../state.js";
import { pollinationsText } from "../../lib/pollinations.js";
import { roles, buildRewriteUserPrompt } from "../prompts.js";
import { cleanPostBody } from "../../lib/contentClean.js";
import { ensureFactsSection } from "../../lib/factsFromBrief.js";

export async function rewrite(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    const current = state.current;
    if (!current) {
      return {
        errors: ["rewrite: no current article"],
        retryCount: state.retryCount + 1,
      };
    }

    console.log(
      `[rewrite] attempt ${state.retryCount + 1} — ${current.title.slice(0, 50)}...`,
    );
    const result = await pollinationsText(
      buildRewriteUserPrompt({
        title: current.title,
        sourceUrl: current.url,
        body: current.translated || current.rawText,
        summary: current.summary,
        feedback: state.quality?.issues?.length
          ? state.quality.issues
          : undefined,
      }),
      roles.writer,
    );
    // Soft-trim runaway generations; never append Manba/source footer
    let rewritten = result.trim();
    rewritten = rewritten
      .replace(/\n*\s*(Manba|Source|URL)\s*:\s*\S+/gi, "")
      .replace(/\n*https?:\/\/\S+\s*$/gi, "")
      .trim();
    if (rewritten.length > 2200) {
      const cut = rewritten.slice(0, 2100);
      const lastStop = Math.max(
        cut.lastIndexOf("."),
        cut.lastIndexOf("!"),
        cut.lastIndexOf("?"),
        cut.lastIndexOf("\n"),
      );
      rewritten = (lastStop > 800 ? cut.slice(0, lastStop + 1) : cut).trim();
    }
    rewritten = rewritten
      .replace(/^(Here is|Quyida|Mana)\b[\s\S]*?:\s*/i, "")
      .trim();
    rewritten = cleanPostBody(rewritten);
    // E: guarantee 3–5 source-grounded "Asosiy faktlar" bullets when FACTS exist
    rewritten = ensureFactsSection(rewritten, current.summary, 5);
    // Facts from brief may carry markdown; clean once more
    rewritten = cleanPostBody(rewritten);
    console.log(`[rewrite] length=${rewritten.length} chars`);

    return {
      current: { ...current, rewritten },
      retryCount: state.retryCount + 1,
    };
  } catch (error) {
    return {
      errors: [`rewrite error: ${String(error)}`],
      retryCount: state.retryCount + 1,
    };
  }
}
