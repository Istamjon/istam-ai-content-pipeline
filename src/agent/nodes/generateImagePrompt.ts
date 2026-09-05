import { StateAnnotation, GraphUpdate } from "../state.js";
import {
  buildPremiumImagePrompt,
  buildSchematicImagePrompt,
  type ImageVisualPreset,
  type ImageCompositionHook,
} from "../../config/imagePrompt.js";
import { isBrandFaceConfigured } from "../../lib/brandFace.js";

/**
 * Builds premium scroll-stopping social-cover image prompt.
 * Person (face identity + rotated pose) + Uzbek HEADING + topic tech visual.
 * Also builds a schematicPrompt (strictly no humans / pure tech architecture)
 * for fallback when face identity is unavailable or cannot be identified.
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
    const forcePose = process.env.IMAGE_POSE;
    const faceRef = isBrandFaceConfigured();

    const {
      prompt: imagePrompt,
      preset,
      composition,
      pose,
      heading,
    } = buildPremiumImagePrompt(current.title, topicHint, {
      preset: forcePreset,
      composition: forceComposition,
      pose: forcePose,
      rewritten: current.rewritten,
      faceRef,
    });

    const { prompt: schematicPrompt } = buildSchematicImagePrompt(
      current.title,
      topicHint,
      {
        preset: forcePreset,
        composition: forceComposition,
        heading,
        rewritten: current.rewritten,
      },
    );

    console.log(
      `[generateImagePrompt] preset=${preset} composition=${composition} pose=${pose} faceRef=${faceRef} heading="${heading.slice(0, 48)}" len=${imagePrompt.length} topic=${current.title.slice(0, 60)}`,
    );

    return {
      current: { ...current, imagePrompt, schematicPrompt },
    };
  } catch (error) {
    return {
      errors: [`generateImagePrompt error: ${String(error)}`],
    };
  }
}
