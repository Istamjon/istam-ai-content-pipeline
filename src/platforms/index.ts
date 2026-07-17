import { Platform } from "../agent/state.js";
import { publishToTelegram } from "./telegram.js";
import { publishToLinkedIn } from "./linkedin.js";
import { publishToFacebook } from "./facebook.js";
import { publishToInstagram } from "./instagram.js";
import { publishToX } from "./x.js";
import { publishToThreads } from "./threads.js";
import { publishToBlogger } from "./blogger.js";

export type MediaKind = "image" | "video" | "none";

/**
 * Publish formatted text (+ optional media) to one platform.
 * mediaKind=video: Telegram/Facebook/Instagram Reels/Threads when possible;
 * LinkedIn: not supported for video (caller should skip; returns error if called).
 * X / Blogger: text-only fallback for video.
 */
export type PublishPayload = {
  text: string;
  /** Threads multi-post chain */
  parts?: string[];
  /** Optional prebuilt media caption (Telegram) */
  caption?: string;
};

export async function publishToPlatform(
  platform: Platform,
  text: string,
  imagePath?: string,
  mediaKind: MediaKind = "image",
  extra?: Pick<PublishPayload, "parts" | "caption">,
): Promise<{ success: boolean; error?: string }> {
  const media = mediaKind === "none" ? undefined : imagePath;
  const kind = mediaKind === "video" ? "video" : "image";

  switch (platform) {
    case "telegram":
      return publishToTelegram(text, media, kind, extra?.caption);
    case "linkedin":
      if (mediaKind === "video") {
        return {
          success: false,
          error: "LinkedIn video not supported — skip",
        };
      }
      return publishToLinkedIn(text, media);
    case "facebook":
      return publishToFacebook(text, media, kind);
    case "instagram":
      if (mediaKind === "none" || !media) {
        return { success: false, error: "Instagram requires an image or video" };
      }
      return publishToInstagram(text, media, kind);
    case "x":
      if (mediaKind === "video") {
        console.warn("[publish] X: video not supported — text only");
        return publishToX(text, undefined);
      }
      return publishToX(text, media);
    case "threads":
      return publishToThreads(text, media, kind, extra?.parts);
    case "blogger":
      if (mediaKind === "video") {
        return publishToBlogger(text, undefined);
      }
      return publishToBlogger(text, media);
    default:
      return { success: false, error: `Unknown platform: ${platform}` };
  }
}
