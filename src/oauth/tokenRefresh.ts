/**
 * Proactive OAuth token refresh before publish.
 * - LinkedIn: refresh_token grant
 * - Threads: th_refresh_token (long-lived ~60d, refresh before expiry)
 * - Facebook/Instagram: re-extend via stored userToken + page token if expiring
 * - Blogger (Google): refresh_token grant (~1h access)
 * - X OAuth2: refresh_token grant when offline.access was granted
 */
import { env } from "../config/env.js";
import { loadTokens, saveTokens } from "./tokenStore.js";
import { refreshLinkedInAccessToken } from "./providers/linkedin.js";
import type { OAuthPlatform, StoredTokens } from "./types.js";

const DAYS_BEFORE = 7;
/** Short-lived tokens (Google ~1h, X OAuth2 ~2h): refresh this many ms before expiry. */
const SHORT_TOKEN_BUFFER_MS = 5 * 60 * 1000;
const SHORT_TOKEN_MAX_LIFETIME_S = 3 * 60 * 60; // treat <= 3h TTL as short-lived

function msUntilExpiry(t: StoredTokens): number | null {
  if (!t.obtainedAt || !t.expiresIn) return null;
  const expiresAt = t.obtainedAt + t.expiresIn * 1000;
  return expiresAt - Date.now();
}

export function isTokenExpiring(t: StoredTokens | null, days = DAYS_BEFORE): boolean {
  if (!t?.accessToken) return true;
  const left = msUntilExpiry(t);
  if (left === null) {
    // Unknown expiry — refresh if older than 50 days (common Meta LL window)
    if (t.obtainedAt) {
      const age = Date.now() - t.obtainedAt;
      return age > 50 * 24 * 60 * 60 * 1000;
    }
    return false;
  }
  // Google / X-style short tokens: refresh when under 5 minutes left (not 7 days)
  if (t.expiresIn && t.expiresIn <= SHORT_TOKEN_MAX_LIFETIME_S) {
    return left < SHORT_TOKEN_BUFFER_MS;
  }
  return left < days * 24 * 60 * 60 * 1000;
}

async function refreshThreads(): Promise<boolean> {
  const t = loadTokens("threads");
  if (!t?.accessToken) return false;
  if (!isTokenExpiring(t)) {
    console.log("[tokenRefresh] threads OK (not expiring)");
    return true;
  }

  try {
    const url =
      `https://graph.threads.net/refresh_access_token` +
      `?grant_type=th_refresh_token` +
      `&access_token=${encodeURIComponent(t.accessToken)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };
    if (!json.access_token) {
      console.warn("[tokenRefresh] threads refresh failed:", json.error?.message || json);
      return false;
    }
    saveTokens({
      ...t,
      accessToken: json.access_token,
      obtainedAt: Date.now(),
      expiresIn: json.expires_in ?? t.expiresIn,
    });
    console.log("[tokenRefresh] threads refreshed, expires_in=", json.expires_in);
    return true;
  } catch (e) {
    console.warn("[tokenRefresh] threads error:", e);
    return false;
  }
}

/**
 * Facebook Page tokens from long-lived user tokens often don't expire,
 * but we re-pull page token if we still have userToken and page token looks old.
 */
async function refreshFacebookPage(): Promise<boolean> {
  const t = loadTokens("facebook");
  if (!t?.accessToken) return false;
  if (!isTokenExpiring(t) && t.extra?.userToken) {
    console.log("[tokenRefresh] facebook OK (not expiring)");
    return true;
  }

  const userToken = t.extra?.userToken;
  const appId = env.FACEBOOK_APP_ID;
  const appSecret = env.FACEBOOK_APP_SECRET;
  if (!userToken || !appId || !appSecret) {
    // Page tokens may still work without refresh
    console.log("[tokenRefresh] facebook: no userToken to re-extend; keeping page token");
    return Boolean(t.accessToken);
  }

  try {
    // Extend user token
    const llUrl =
      `https://graph.facebook.com/v19.0/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(appId)}` +
      `&client_secret=${encodeURIComponent(appSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(userToken)}`;
    const llRes = await fetch(llUrl, { signal: AbortSignal.timeout(30_000) });
    const llJson = (await llRes.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    const newUser = llJson.access_token || userToken;

    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts` +
        `?fields=id,name,access_token,instagram_business_account` +
        `&access_token=${encodeURIComponent(newUser)}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    const pagesJson = (await pagesRes.json()) as {
      data?: Array<{
        id: string;
        name: string;
        access_token: string;
        instagram_business_account?: { id: string };
      }>;
    };
    const page =
      pagesJson.data?.find((p) => p.id === t.userId) ||
      pagesJson.data?.find((p) => p.instagram_business_account?.id) ||
      pagesJson.data?.[0];
    if (!page?.access_token) {
      console.warn("[tokenRefresh] facebook: no pages returned");
      return false;
    }

    const igId =
      page.instagram_business_account?.id ||
      t.extra?.instagramUserId ||
      loadTokens("instagram")?.userId ||
      "";

    saveTokens({
      platform: "facebook",
      accessToken: page.access_token,
      userId: page.id,
      obtainedAt: Date.now(),
      expiresIn: llJson.expires_in ?? 5184000,
      scopes: t.scopes,
      extra: {
        pageName: page.name,
        userToken: newUser,
        ...(igId ? { instagramUserId: igId } : {}),
      },
    });

    if (igId) {
      saveTokens({
        platform: "instagram",
        accessToken: page.access_token,
        userId: igId,
        obtainedAt: Date.now(),
        expiresIn: llJson.expires_in ?? 5184000,
        extra: { pageId: page.id, pageName: page.name },
      });
    }

    console.log("[tokenRefresh] facebook/instagram page token refreshed:", page.name);
    return true;
  } catch (e) {
    console.warn("[tokenRefresh] facebook error:", e);
    return false;
  }
}

async function refreshLinkedIn(): Promise<boolean> {
  try {
    const t = loadTokens("linkedin");
    if (t && !isTokenExpiring(t) && t.accessToken) {
      console.log("[tokenRefresh] linkedin OK (not expiring)");
      return true;
    }
    const tok = await refreshLinkedInAccessToken({ force: true });
    return Boolean(tok);
  } catch (e) {
    console.warn("[tokenRefresh] linkedin error:", e);
    return false;
  }
}

async function refreshBlogger(): Promise<boolean> {
  const t = loadTokens("blogger");
  if (!t?.accessToken && !t?.refreshToken) return false;
  if (t.accessToken && !isTokenExpiring(t)) {
    console.log("[tokenRefresh] blogger OK (not expiring)");
    return true;
  }

  const refreshToken =
    t.refreshToken || process.env.BLOGGER_REFRESH_TOKEN || "";
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  if (!refreshToken || !clientId || !clientSecret) {
    console.log(
      "[tokenRefresh] blogger: no refresh_token / Google client — keeping access token",
    );
    return Boolean(t.accessToken);
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      console.warn(
        "[tokenRefresh] blogger refresh failed:",
        json.error || res.status,
        json.error_description || "",
      );
      return false;
    }
    saveTokens({
      platform: "blogger",
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      userId: t.userId,
      obtainedAt: Date.now(),
      expiresIn: json.expires_in ?? 3600,
      scopes: t.scopes,
      extra: t.extra,
    });
    console.log("[tokenRefresh] blogger refreshed, expires_in=", json.expires_in);
    return true;
  } catch (e) {
    console.warn("[tokenRefresh] blogger error:", e);
    return false;
  }
}

async function refreshX(): Promise<boolean> {
  const t = loadTokens("x");
  // OAuth1 / bearer in env do not use refresh_token
  if (t?.extra?.mode === "oauth1" || t?.extra?.mode === "bearer") {
    return Boolean(t.accessToken);
  }
  if (!t?.accessToken && !t?.refreshToken) return false;
  if (t.accessToken && !isTokenExpiring(t)) {
    console.log("[tokenRefresh] x OK (not expiring)");
    return true;
  }

  const refreshToken = t.refreshToken || "";
  const clientId = process.env.X_CLIENT_ID || "";
  const clientSecret = process.env.X_CLIENT_SECRET || "";
  if (!refreshToken || !clientId) {
    console.log("[tokenRefresh] x: no OAuth2 refresh_token — keeping token");
    return Boolean(t.accessToken);
  }

  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(
        `${clientId}:${clientSecret}`,
      ).toString("base64")}`;
    }
    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      console.warn(
        "[tokenRefresh] x refresh failed:",
        json.error || res.status,
        json.error_description || "",
      );
      return false;
    }
    saveTokens({
      platform: "x",
      accessToken: json.access_token,
      refreshToken: json.refresh_token || refreshToken,
      userId: t.userId,
      obtainedAt: Date.now(),
      expiresIn: json.expires_in ?? 7200,
      scopes: t.scopes,
      extra: { ...(t.extra || {}), mode: "oauth2" },
    });
    console.log("[tokenRefresh] x refreshed, expires_in=", json.expires_in);
    return true;
  } catch (e) {
    console.warn("[tokenRefresh] x error:", e);
    return false;
  }
}

/** Run before pipeline publish batch. */
export async function refreshAllExpiringTokens(): Promise<void> {
  console.log("[tokenRefresh] Checking tokens…");
  await Promise.all([
    refreshLinkedIn().catch(() => false),
    refreshThreads().catch(() => false),
    refreshFacebookPage().catch(() => false),
    refreshBlogger().catch(() => false),
    refreshX().catch(() => false),
  ]);
}

export function tokenStatusReport(): Array<{
  platform: OAuthPlatform;
  hasToken: boolean;
  expiring: boolean;
  daysLeft: number | null;
}> {
  const platforms: OAuthPlatform[] = [
    "linkedin",
    "facebook",
    "instagram",
    "threads",
    "x",
    "blogger",
  ];
  return platforms.map((platform) => {
    const t = loadTokens(platform);
    const left = t ? msUntilExpiry(t) : null;
    return {
      platform,
      hasToken: Boolean(t?.accessToken),
      expiring: isTokenExpiring(t),
      daysLeft: left === null ? null : Math.floor(left / (24 * 60 * 60 * 1000)),
    };
  });
}
