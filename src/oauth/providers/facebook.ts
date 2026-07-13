import { env } from "../../config/env.js";
import { loadTokens, saveTokens } from "../tokenStore.js";
import type { AuthCredentials, OAuthProvider, StoredTokens } from "../types.js";

/**
 * Facebook Login → Page token (+ linked Instagram Business account).
 * One OAuth covers Facebook Page posts and Instagram Graph publish.
 */
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "public_profile",
].join(",");

function redirectUri(): string {
  return (
    process.env.FACEBOOK_REDIRECT_URI ||
    // Public HTTPS helper (same pattern as Threads) — no local server required
    "https://oauth.pstmn.io/v1/callback"
  );
}

export const facebookProvider: OAuthProvider = {
  id: "facebook",
  displayName: "Facebook",
  callbackPath: "/auth/facebook/callback",

  isConfigured() {
    return (
      Boolean(process.env.FACEBOOK_APP_ID || env.FACEBOOK_PAGE_TOKEN) &&
      Boolean(process.env.FACEBOOK_APP_SECRET || env.FACEBOOK_PAGE_TOKEN)
    );
  },

  isReady() {
    return this.getCredentials() !== null;
  },

  getCredentials(): AuthCredentials | null {
    const t = loadTokens("facebook");
    const accessToken = t?.accessToken || env.FACEBOOK_PAGE_TOKEN || "";
    const userId = t?.userId || env.FACEBOOK_PAGE_ID || "";
    if (!accessToken || !userId) return null;
    return { accessToken, userId, extra: t?.extra };
  },

  getAuthorizationUrl(state: string) {
    const appId = process.env.FACEBOOK_APP_ID || "";
    if (!appId) return null;
    return (
      `https://www.facebook.com/v19.0/dialog/oauth` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}` +
      `&state=${encodeURIComponent(state)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&response_type=code`
    );
  },

  async exchangeCode(code: string): Promise<StoredTokens> {
    const appId = process.env.FACEBOOK_APP_ID || "";
    const appSecret = process.env.FACEBOOK_APP_SECRET || "";
    if (!appId || !appSecret) {
      throw new Error("FACEBOOK_APP_ID and FACEBOOK_APP_SECRET required");
    }

    const cleanCode = code.replace(/#_$/, "").trim();

    // Short-lived user token
    const tokenUrl =
      `https://graph.facebook.com/v19.0/oauth/access_token` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&code=${encodeURIComponent(cleanCode)}`;
    const tokenRes = await fetch(tokenUrl, { signal: AbortSignal.timeout(30_000) });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      error?: { message: string };
    };
    if (!tokenJson.access_token) {
      throw new Error(tokenJson.error?.message || "Facebook token exchange failed");
    }

    // Long-lived user token (~60 days)
    const llUrl =
      `https://graph.facebook.com/v19.0/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(tokenJson.access_token)}`;
    const llRes = await fetch(llUrl);
    const llJson = (await llRes.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    const userToken = llJson.access_token || tokenJson.access_token;

    // Pages + linked Instagram Business account
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts` +
        `?fields=id,name,access_token,instagram_business_account` +
        `&access_token=${encodeURIComponent(userToken)}`,
    );
    const pagesJson = (await pagesRes.json()) as {
      data?: Array<{
        id: string;
        name: string;
        access_token: string;
        instagram_business_account?: { id: string };
      }>;
      error?: { message: string };
    };
    if (!pagesJson.data?.length) {
      throw new Error(
        pagesJson.error?.message ||
          "No Facebook Pages found. Create a Page and link Instagram Business/Creator.",
      );
    }

    // Prefer a page that has Instagram linked
    const page =
      pagesJson.data.find((p) => p.instagram_business_account?.id) || pagesJson.data[0];
    console.log("[facebook] Using page:", page.name, page.id);

    let igUserId = page.instagram_business_account?.id || "";
    if (!igUserId) {
      // Fallback: explicit page field
      try {
        const igRes = await fetch(
          `https://graph.facebook.com/v19.0/${page.id}` +
            `?fields=instagram_business_account` +
            `&access_token=${encodeURIComponent(page.access_token)}`,
        );
        const igJson = (await igRes.json()) as {
          instagram_business_account?: { id: string };
        };
        igUserId = igJson.instagram_business_account?.id || "";
      } catch {
        /* ignore */
      }
    }

    if (igUserId) {
      console.log("[facebook] Instagram Business account:", igUserId);
      // Page token is used for Instagram Graph API publish
      saveTokens({
        platform: "instagram",
        accessToken: page.access_token,
        userId: igUserId,
        obtainedAt: Date.now(),
        expiresIn: llJson.expires_in,
        scopes: SCOPES,
        extra: { pageId: page.id, pageName: page.name },
      });
    } else {
      console.warn(
        "[facebook] No Instagram Business account linked to this Page. " +
          "Link IG Business/Creator to the Page in Meta Business Suite.",
      );
    }

    const extra: Record<string, string> = {
      pageName: page.name,
      userToken,
    };
    if (igUserId) extra.instagramUserId = igUserId;

    const tokens: StoredTokens = {
      platform: "facebook",
      accessToken: page.access_token,
      userId: page.id,
      obtainedAt: Date.now(),
      expiresIn: llJson.expires_in,
      scopes: SCOPES,
      extra,
    };
    saveTokens(tokens);
    return tokens;
  },

  setupHelp() {
    return [
      "Meta Developer App → Facebook Login (+ Instagram Graph)",
      `  Redirect: ${redirectUri()}`,
      "  Env: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET",
      "  Permissions: pages_*, instagram_basic, instagram_content_publish",
      "  Run: npm run auth:facebook",
    ].join("\n");
  },
};
