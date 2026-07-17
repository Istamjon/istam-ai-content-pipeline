import { StateAnnotation, GraphUpdate } from "../state.js";
import {
  buildPremiumImagePrompt,
  type ImageVisualPreset,
  type ImageCompositionHook,
} from "../../config/imagePrompt.js";
import { isBrandFaceConfigured } from "../../lib/brandFace.js";

/**
 * Builds premium scroll-stopping social-cover image prompt.
 * Person (face identity + rotated pose) + Uzbek HEADING + topic tech visual.
 * No IO logo. Heading prefers rewritten Uzbek hook, not English RSS title.
 * Env: IMAGE_PRESET=…  IMAGE_COMPOSITION=…  IMAGE_POSE=…
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

    console.log(
      `[generateImagePrompt] preset=${preset} composition=${composition} pose=${pose} faceRef=${faceRef} heading="${heading.slice(0, 48)}" len=${imagePrompt.length} topic=${current.title.slice(0, 60)}`,
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
