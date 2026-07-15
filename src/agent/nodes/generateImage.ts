import { StateAnnotation, GraphUpdate } from "../state.js";
import { generateImageBuffer, logAllImageBudgets } from "../../lib/imagePipeline.js";
import { cleanupOldLocalImages } from "../../lib/imageHost.js";
import { markArticleSeen } from "../../db.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const imagesDir = path.resolve(__dirname, "../../../data/images");

function ensureImagesDir(): void {
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }
}

/**
 * Generate post image:
 *   Nano Banana → Pollinations gpt-image-2 → Cloudflare → AI Horde.
 * On total failure → no imagePath → graph skips publish.
 */
export async function generateImage(
  state: typeof StateAnnotation.State,
): Promise<GraphUpdate> {
  try {
    const current = state.current;
    if (!current || !current.imagePrompt) {
      return {
        errors: ["generateImage: no image prompt"],
        current: state.current
          ? { ...state.current, imagePath: undefined }
          : state.current,
      };
    }

    ensureImagesDir();
    cleanupOldLocalImages(imagesDir, 24 * 60 * 60 * 1000);
    logAllImageBudgets();

    const { buffer, provider } = await generateImageBuffer(current.imagePrompt);
    const ext =
      provider === "horde"
        ? "webp"
        : provider === "nanobanana" || provider === "pollinations"
          ? "png"
          : "jpg";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filepath = path.join(imagesDir, filename);
    fs.writeFileSync(filepath, buffer);

    console.log(
      `[generateImage] OK provider=${provider} file=${filepath} bytes=${buffer.length}`,
    );

    return {
      current: { ...current, imagePath: filepath },
    };
  } catch (error) {
    console.warn(
      "[generateImage] all providers failed — will NOT publish without image",
    );
    const current = state.current;
    if (current?.url) {
      try {
        markArticleSeen(
          current.url,
          current.title,
          "image-failed",
          "image-failed",
        );
      } catch {
        // ignore
      }
    }
    return {
      errors: [`generateImage error: ${String(error)}`],
      current: current
        ? { ...current, imagePath: undefined }
        : current,
    };
  }
}
