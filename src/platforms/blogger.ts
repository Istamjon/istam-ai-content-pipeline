import { bloggerProvider } from "../oauth/providers/blogger.js";

/**
 * Publish an HTML post to Blogger.
 */
export async function publishToBlogger(
  text: string,
  _imagePath?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const creds = bloggerProvider.getCredentials();
    if (!creds?.accessToken) {
      return {
        success: false,
        error: "Blogger not authorized. Run: npm run auth -- blogger",
      };
    }
    const blogId = creds.userId || process.env.BLOGGER_BLOG_ID || "";
    if (!blogId) {
      return {
        success: false,
        error: "BLOGGER_BLOG_ID missing (set env or re-run auth after selecting a blog)",
      };
    }

    // Blogger body is HTML — convert simple newlines
    const html = `<p>${text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br/>")}</p>`;

    const title =
      text.split("\n").find((l) => l.trim().length > 0)?.slice(0, 80) ||
      "AI Engineering Post";

    const response = await fetch(
      `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind: "blogger#post",
          title,
          content: html,
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `Blogger API ${response.status}: ${err.slice(0, 300)}` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
