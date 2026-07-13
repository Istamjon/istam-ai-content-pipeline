import { Platform } from "../agent/state.js";
import { publishToTelegram } from "./telegram.js";
import { publishToLinkedIn } from "./linkedin.js";
import { publishToFacebook } from "./facebook.js";
import { publishToInstagram } from "./instagram.js";
import { publishToX } from "./x.js";
import { publishToThreads } from "./threads.js";
import { publishToBlogger } from "./blogger.js";

export async function publishToPlatform(
  platform: Platform,
  text: string,
  imagePath?: string,
): Promise<{ success: boolean; error?: string }> {
  switch (platform) {
    case "telegram":
      return publishToTelegram(text, imagePath);
    case "linkedin":
      return publishToLinkedIn(text, imagePath);
    case "facebook":
      return publishToFacebook(text, imagePath);
    case "instagram":
      return publishToInstagram(text, imagePath);
    case "x":
      return publishToX(text, imagePath);
    case "threads":
      return publishToThreads(text, imagePath);
    case "blogger":
      return publishToBlogger(text, imagePath);
    default:
      return { success: false, error: `Unknown platform: ${platform}` };
  }
}
