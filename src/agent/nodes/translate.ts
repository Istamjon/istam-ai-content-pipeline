import { StateAnnotation, GraphUpdate } from "../state.js";
import { pollinationsText } from "../../lib/pollinations.js";
import { roles, buildTranslateUserPrompt } from "../prompts.js";

export async function translate(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    const current = state.current;
    if (!current) {
      return { errors: ["translate: no current article"] };
    }

    const result = await pollinationsText(
      buildTranslateUserPrompt(current.rawText),
      roles.translator,
    );
    const translated = result.trim();

    return {
      current: { ...current, translated },
    };
  } catch (error) {
    return {
      errors: [`translate error: ${String(error)}`],
    };
  }
}
