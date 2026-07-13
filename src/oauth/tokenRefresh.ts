/**
 * Proactive OAuth token refresh before publish.
 * - LinkedIn: refresh_token grant
 * - Threads: th_refresh_token (long-lived ~60d, refresh before expiry)
 * - Facebook/Instagram: re-extend via stored userToken + page token if expiring
 */
import { env } from "../config/env.js";
import { loadTokens, saveTokens } from "./tokenStore.js";
import { refreshLinkedInAccessToken } from "./providers/linkedin.js";
import type { OAuthPlatform, StoredTokens } from "./types.js";

const DAYS_BEFORE = 7;

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
    const tok = await refreshLinkedInAccessToken();
    return Boolean(tok);
  } catch (e) {
    console.warn("[tokenRefresh] linkedin error:", e);
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
