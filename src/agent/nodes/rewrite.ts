import { StateAnnotation, GraphUpdate } from "../state.js";
import { generateText } from "../../lib/geminiText.js";
import { roles, buildRewriteUserPrompt } from "../prompts.js";
import { stripSourceIntros } from "../../lib/contentClean.js";
import { ensureFactsSection } from "../../lib/factsFromBrief.js";
import {
  repairTruncation,
  stripUnsupportedNumbers,
} from "../../lib/draftRepair.js";

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
    const result = await generateText(
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
    if (rewritten.length > 2000) {
      const cut = rewritten.slice(0, 1900);
      const lastStop = Math.max(
        cut.lastIndexOf("."),
        cut.lastIndexOf("!"),
        cut.lastIndexOf("?"),
        cut.lastIndexOf("…"),
        cut.lastIndexOf("\n"),
      );
      rewritten = (lastStop > 600 ? cut.slice(0, lastStop + 1) : cut).trim();
    }
    rewritten = rewritten
      .replace(/^(Here is|Quyida|Mana)\b[\s\S]*?:\s*/i, "")
      .trim();
    // Structure is preserved here ON PURPOSE.
    //
    // `cleanPostBody` flattens markdown — headings, emphasis, links — because
    // LinkedIn/X/Threads render those markers literally. But that is a
    // PER-PLATFORM rendering concern, and `formatOne` already applies
    // `cleanPostBody` to the body for every plain-text platform. Doing it here
    // instead destroyed the structure permanently: this runs BEFORE the
    // canonical document is stored, so the Telegram rich renderer never received
    // a heading or a list to render, and `markdownToRichHtml` only ever saw
    // already-flattened text.
    //
    // This step removes source-intro noise only ("Yangi X maqolasi:", a stale
    // "Manba:" line) and keeps the author's structure for the renderers.
    rewritten = stripSourceIntros(rewritten);
    // E: guarantee 3–5 source-grounded "Asosiy faktlar" bullets when FACTS exist
    rewritten = ensureFactsSection(rewritten, current.summary, 5);
    rewritten = stripSourceIntros(rewritten);
    // Auto-repair: complete ending + drop invented % not in source/brief
    rewritten = repairTruncation(rewritten);
    const sourcePool = `${current.rawText || ""}\n${current.translated || ""}\n${current.summary || ""}\n${current.title || ""}`;
    rewritten = stripUnsupportedNumbers(rewritten, sourcePool);
    rewritten = repairTruncation(rewritten);
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
