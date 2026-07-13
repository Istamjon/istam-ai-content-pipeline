import { env } from "../config/env.js";
import fs from "fs";
import path from "path";
import { facebookProvider } from "../oauth/providers/facebook.js";

export async function publishToFacebook(
  text: string,
  imagePath?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const oauth = facebookProvider.getCredentials();
    const token = oauth?.accessToken || env.FACEBOOK_PAGE_TOKEN || "";
    const pageId = String(oauth?.userId || env.FACEBOOK_PAGE_ID || "").trim();
    if (!token || !pageId || pageId === "0") {
      return {
        success: false,
        error: "Facebook not authorized. Run: npm run auth:facebook",
      };
    }

    // Photo post from local file (native multipart — works with Node fetch)
    if (imagePath && fs.existsSync(imagePath) && !/^https?:\/\//i.test(imagePath)) {
      const buf = fs.readFileSync(imagePath);
      const ext = path.extname(imagePath).toLowerCase();
      const type =
        ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".webp"
            ? "image/webp"
            : ext === ".gif"
              ? "image/gif"
              : "image/png";
      const form = new FormData();
      form.append("source", new Blob([buf], { type }), path.basename(imagePath));
      form.append("message", text);
      form.append("access_token", token);

      const response = await fetch(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/photos`,
        {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(90_000),
        },
      );

      const data = (await response.json()) as {
        id?: string;
        post_id?: string;
        error?: { message: string };
      };
      if (data.error) {
        // Fallback: text-only if photo fails
        console.warn("[facebook] Photo post failed, trying text feed:", data.error.message);
      } else if (data.id || data.post_id) {
        return { success: true };
      }
    }

    if (imagePath?.startsWith("http")) {
      const response = await fetch(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/photos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: imagePath,
            message: text,
            access_token: token,
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      const data = (await response.json()) as { id?: string; error?: { message: string } };
      if (data.error) {
        return { success: false, error: data.error.message };
      }
      return { success: true };
    }

    const response = await fetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/feed`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, access_token: token }),
        signal: AbortSignal.timeout(60_000),
      },
    );

    const data = (await response.json()) as { id?: string; error?: { message: string } };
    if (data.error) {
      return { success: false, error: data.error.message };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
