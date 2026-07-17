import { bloggerProvider } from "../oauth/providers/blogger.js";
import {
  resolveBloggerBlogId,
  getKnownBloggerBlogId,
} from "../lib/bloggerBlogId.js";

/**
 * Publish an HTML post to Blogger.
 * Blog id is auto-resolved from BLOGGER_URL / public feed / OAuth — no manual id needed.
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

    let blogId =
      (creds.userId || "").trim() ||
      getKnownBloggerBlogId() ||
      "";
    if (!blogId) {
      const resolved = await resolveBloggerBlogId({
        accessToken: creds.accessToken,
        persist: true,
      });
      blogId = resolved?.blogId || "";
      if (resolved) {
        console.log(
          `[blogger] resolved blogId=${blogId} via ${resolved.source}` +
            (resolved.url ? ` url=${resolved.url}` : ""),
        );
      }
    }
    if (!blogId) {
      return {
        success: false,
        error:
          "Could not resolve BLOGGER_BLOG_ID (set BLOGGER_URL or re-run npm run auth -- blogger)",
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
      // Stale id → re-resolve once and retry
      if (response.status === 404 || /notFound|Not Found/i.test(err)) {
        const resolved = await resolveBloggerBlogId({
          accessToken: creds.accessToken,
          forceRefresh: true,
          persist: true,
        });
        if (resolved?.blogId && resolved.blogId !== blogId) {
          console.log(
            `[blogger] retry with re-resolved blogId=${resolved.blogId} (${resolved.source})`,
          );
          const retry = await fetch(
            `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(resolved.blogId)}/posts/`,
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
          if (retry.ok) return { success: true };
          const err2 = await retry.text();
          return {
            success: false,
            error: `Blogger API ${retry.status}: ${err2.slice(0, 300)}`,
          };
        }
      }
      return { success: false, error: `Blogger API ${response.status}: ${err.slice(0, 300)}` };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
