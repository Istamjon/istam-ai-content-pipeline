import { StateAnnotation, GraphUpdate } from "../state.js";
import { generateText } from "../../lib/geminiText.js";
import { roles, buildTranslateUserPrompt } from "../prompts.js";
import { describeError } from "../../lib/errText.js";

export async function translate(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    const current = state.current;
    if (!current) {
      return { errors: ["translate: no current article"] };
    }

    const result = await generateText(
      buildTranslateUserPrompt(current.rawText),
      roles.translator,
    );
    const translated = result.trim();

    return {
      current: { ...current, translated },
    };
  } catch (error) {
    return {
      errors: [`translate error: ${describeError(error)}`],
    };
  }
}
