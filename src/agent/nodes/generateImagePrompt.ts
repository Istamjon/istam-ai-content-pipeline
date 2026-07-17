import { StateAnnotation, GraphUpdate } from "../state.js";
import {
  buildPremiumImagePrompt,
  type ImageVisualPreset,
  type ImageCompositionHook,
} from "../../config/imagePrompt.js";

/**
 * Builds premium scroll-stopping social-cover image prompt.
 * Includes: professional PERSON + HEADING text + brand LOGO + topic tech visual.
 * Template in config/imagePrompt.ts — topic inject only (no LLM).
 * Env: IMAGE_PRESET=…  IMAGE_COMPOSITION=…
 */
export async function generateImagePrompt(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    const current = state.current;
    if (!current) {
      return { errors: ["generateImagePrompt: no current article"] };
    }

    const topicHint =
      current.summary
        ?.replace(/^FIT:.*$/gim, "")
        .replace(/^TYPE:.*$/gim, "")
        .replace(/^NOTES:.*$/gim, "")
        .replace(/^FACTS:[\s\S]*?(?=\n[A-Z]+:|$)/gim, "")
        .replace(/SUMMARY:\s*/i, "")
        .trim()
        .slice(0, 320) || current.rewritten?.slice(0, 240);

    const forcePreset = process.env.IMAGE_PRESET as
      | ImageVisualPreset
      | undefined;
    const forceComposition = process.env.IMAGE_COMPOSITION as
      | ImageCompositionHook
      | undefined;

    const {
      prompt: imagePrompt,
      preset,
      composition,
      heading,
    } = buildPremiumImagePrompt(current.title, topicHint, {
      preset: forcePreset,
      composition: forceComposition,
    });

    console.log(
      `[generateImagePrompt] preset=${preset} composition=${composition} heading="${heading.slice(0, 48)}" len=${imagePrompt.length} topic=${current.title.slice(0, 60)}`,
    );

    return {
      current: { ...current, imagePrompt },
    };
  } catch (error) {
    return {
      errors: [`generateImagePrompt error: ${String(error)}`],
    };
  }
}
