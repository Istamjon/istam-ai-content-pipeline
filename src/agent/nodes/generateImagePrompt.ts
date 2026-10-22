import { StateAnnotation, GraphUpdate } from "../state.js";
import {
  buildPremiumImagePrompt,
  buildSchematicImagePrompt,
  buildWorkflowImagePrompt,
  buildEngagingImagePrompt,
  type ImageVisualPreset,
  type ImageCompositionHook,
} from "../../config/imagePrompt.js";
import { env } from "../../config/env.js";
import { isBrandFaceConfigured } from "../../lib/brandFace.js";
import { generateCatchyCoverHeading } from "../../lib/coverHeading.js";
import { describeError } from "../../lib/errText.js";

/**
 * Builds premium scroll-stopping social-cover image prompt.
 * Person (face identity + rotated pose) + Catchy Uzbek HEADING + topic tech visual.
 * Also builds a schematicPrompt and dedicated workflowPrompt (strictly no humans /
 * pure tech architecture workflow diagrams) for xKiro and humanless fallbacks.
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

    // AI-generated catchy cover heading ("cover darajasida")
    const catchyHeading = await generateCatchyCoverHeading({
      title: current.title,
      summary: topicHint,
      rewritten: current.rewritten,
    });

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
      heading: catchyHeading,
      rewritten: current.rewritten,
      faceRef,
    });

    const { prompt: schematicPrompt } = buildSchematicImagePrompt(
      current.title,
      topicHint,
      {
        preset: forcePreset || "workflow",
        composition: forceComposition,
        heading,
        rewritten: current.rewritten,
      },
    );

    const { prompt: workflowPrompt } = buildWorkflowImagePrompt(
      current.title,
      topicHint,
      {
        composition: forceComposition,
        heading,
        rewritten: current.rewritten,
      },
    );

    // xKiro never receives face.jpg, so it gets a mode-aware cover prompt of its
    // own: an editorial scene, a physical metaphor, or (a minority of the time)
    // the flat diagram above. Building it here rather than inside the provider
    // keeps the prompt deterministic per article and testable without network.
    const {
      prompt: xkiroPrompt,
      mode: xkiroMode,
      marks: xkiroMarks,
    } = buildEngagingImagePrompt(current.title, topicHint, {
      heading,
      rewritten: current.rewritten,
      mode:
        env.XKIRO_VISUAL_MODE === "auto" ? undefined : env.XKIRO_VISUAL_MODE,
    });

    console.log(
      `[generateImagePrompt] preset=${preset} composition=${composition} pose=${pose} faceRef=${faceRef} xkiro=${xkiroMode} marks=[${xkiroMarks.join(", ") || "none"}] heading="${heading.slice(0, 48)}" len=${imagePrompt.length} topic=${current.title.slice(0, 60)}`,
    );

    return {
      current: {
        ...current,
        imagePrompt,
        schematicPrompt,
        workflowPrompt,
        xkiroPrompt,
      },
    };
  } catch (error) {
    return {
      errors: [`generateImagePrompt error: ${describeError(error)}`],
    };
  }
}
