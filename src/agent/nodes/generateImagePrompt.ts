import { StateAnnotation, GraphUpdate } from "../state.js";
import {
  buildPremiumImagePrompt,
  type ImageVisualPreset,
} from "../../config/imagePrompt.js";

/**
 * Builds structured premium image prompt (3 visual presets for feed variety).
 * Template in config/imagePrompt.ts — topic inject only (no LLM).
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
        .slice(0, 220) || current.rewritten?.slice(0, 180);

    // Optional: IMAGE_PRESET=graph|abstract|systems (no office)
    const force = process.env.IMAGE_PRESET as ImageVisualPreset | undefined;
    const { prompt: imagePrompt, preset } = buildPremiumImagePrompt(
      current.title,
      topicHint,
      { preset: force },
    );

    console.log(
      `[generateImagePrompt] preset=${preset} len=${imagePrompt.length} topic=${current.title.slice(0, 60)}`,
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
