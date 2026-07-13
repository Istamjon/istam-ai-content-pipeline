import { loadTokens, saveTokens } from "../tokenStore.js";
import type { AuthCredentials, OAuthProvider, StoredTokens } from "../types.js";

const SCOPES = ["https://www.googleapis.com/auth/blogger"].join(" ");

function redirectUri(): string {
  return (
    process.env.BLOGGER_REDIRECT_URI ||
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3000/auth/blogger/callback"
  );
}

export const bloggerProvider: OAuthProvider = {
  id: "blogger",
  displayName: "Blogger",
  callbackPath: "/auth/blogger/callback",

  isConfigured() {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID || process.env.BLOGGER_ACCESS_TOKEN,
    );
  },

  isReady() {
    return this.getCredentials() !== null;
  },

  getCredentials(): AuthCredentials | null {
    const t = loadTokens("blogger");
    const accessToken =
      t?.accessToken || process.env.BLOGGER_ACCESS_TOKEN || "";
    const userId = t?.userId || process.env.BLOGGER_BLOG_ID || "";
    if (!accessToken) return null;
    return {
      accessToken,
      userId,
      extra: {
        refreshToken: t?.refreshToken || process.env.BLOGGER_REFRESH_TOKEN || "",
      },
    };
  },

  getAuthorizationUrl(state: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    if (!clientId) return null;
    return (
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(state)}`
    );
  },

  async exchangeCode(code: string): Promise<StoredTokens> {
    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
    if (!clientId || !clientSecret) {
      throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET required");
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!tokenJson.access_token) {
      throw new Error(
        `Blogger/Google token failed: ${tokenJson.error || tokenRes.status} ${tokenJson.error_description || ""}`,
      );
    }

    // Resolve first blog id
    let blogId = process.env.BLOGGER_BLOG_ID || "";
    if (!blogId) {
      const blogsRes = await fetch(
        "https://www.googleapis.com/blogger/v3/users/self/blogs",
        { headers: { Authorization: `Bearer ${tokenJson.access_token}` } },
      );
      if (blogsRes.ok) {
        const blogs = (await blogsRes.json()) as {
          items?: Array<{ id: string; name: string }>;
        };
        if (blogs.items?.length) {
          blogId = blogs.items[0].id;
          console.log("[blogger] Using blog:", blogs.items[0].name, blogId);
        }
      }
    }

    const tokens: StoredTokens = {
      platform: "blogger",
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      userId: blogId,
      obtainedAt: Date.now(),
      expiresIn: tokenJson.expires_in,
      scopes: SCOPES,
    };
    saveTokens(tokens);
    return tokens;
  },

  setupHelp() {
    return [
      "Google Cloud Console → OAuth 2.0 Client",
      `  Redirect: ${redirectUri()}`,
      "  Enable Blogger API",
      "  Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, optional BLOGGER_BLOG_ID",
      "  Run: npm run auth -- blogger",
    ].join("\n");
  },
};
