import { StateAnnotation, GraphUpdate } from "../state.js";
import {
  buildPremiumImagePrompt,
  type ImageVisualPreset,
} from "../../config/imagePrompt.js";

/**
 * Builds premium editorial hero image prompt (story-driven production scenes).
 * Template in config/imagePrompt.ts — topic inject only (no LLM).
 * Presets: workflow | infrastructure | engineering (legacy: graph|abstract|systems).
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

    // Optional: IMAGE_PRESET=workflow|infrastructure|engineering
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
