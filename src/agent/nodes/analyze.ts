import { StateAnnotation, GraphUpdate } from "../state.js";
import { pollinationsText } from "../../lib/pollinations.js";
import { roles, buildAnalyzeUserPrompt } from "../prompts.js";
import { markArticleSeen } from "../../db.js";
import {
  parseAnalystFit,
  scoreBrandFit,
} from "../../lib/brandFit.js";

export async function analyze(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    const current = state.current;
    if (!current) {
      return { errors: ["analyze: no current article"] };
    }

    // Re-check with full body (title-only filter may have passed weak snippets)
    const local = scoreBrandFit({
      title: current.title,
      url: current.url,
      text: current.rawText,
    });
    if (!local.ok) {
      console.warn(
        `[analyze] REJECT local brand-fit: ${current.title.slice(0, 60)} — ${local.reason}`,
      );
      try {
        markArticleSeen(
          current.url,
          current.title,
          "brand-reject",
          local.reason.slice(0, 32),
        );
      } catch {
        /* ignore */
      }
      return {
        current: null,
        errors: [`analyze: brand-reject ${local.reason}`],
      };
    }

    console.log(`[analyze] ${current.title.slice(0, 60)}... (local score=${local.score})`);
    const result = await pollinationsText(
      buildAnalyzeUserPrompt({
        title: current.title,
        rawText: current.rawText,
        url: current.url,
      }),
      roles.analyst,
    );
    const summary = result.trim();
    console.log(`[analyze] done:\n${summary.slice(0, 400)}`);

    const fit = parseAnalystFit(summary);
    // Reject hard no; for qisman require strong local score
    if (fit === "yoq" || (fit === "qisman" && local.score < 5)) {
      console.warn(
        `[analyze] REJECT analyst FIT=${fit} score=${local.score}: ${current.title.slice(0, 60)}`,
      );
      try {
        markArticleSeen(
          current.url,
          current.title,
          "brand-reject",
          `fit-${fit}`.slice(0, 32),
        );
      } catch {
        /* ignore */
      }
      return {
        current: null,
        errors: [`analyze: FIT=${fit} rejected`],
      };
    }

    return {
      current: { ...current, summary },
    };
  } catch (error) {
    return {
      errors: [`analyze error: ${String(error)}`],
    };
  }
}
