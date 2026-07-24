import { env } from "../../config/env.js";
import { loadTokens, saveTokens } from "../tokenStore.js";
import type { AuthCredentials, OAuthProvider, StoredTokens } from "../types.js";

/**
 * Threads OAuth scopes.
 * - threads_manage_replies is required for multi-part reply chains (reply_to_id).
 *   Without it Meta returns "Application does not have permission for this action".
 */
const SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_replies",
].join(",");

function redirectUri(): string {
  return (
    process.env.THREADS_REDIRECT_URI ||
    // Meta blocks http:// for Threads OAuth ("Insecure Login Blocked")
    "https://localhost:3000/auth/threads/callback"
  );
}

export const threadsProvider: OAuthProvider = {
  id: "threads",
  displayName: "Threads",
  callbackPath: "/auth/threads/callback",

  isConfigured() {
    return Boolean(
      process.env.THREADS_APP_ID || env.THREADS_TOKEN,
    );
  },

  isReady() {
    return this.getCredentials() !== null;
  },

  getCredentials(): AuthCredentials | null {
    const t = loadTokens("threads");
    const accessToken = t?.accessToken || env.THREADS_TOKEN || "";
    const userId = t?.userId || env.THREADS_USER_ID || "";
    if (!accessToken || !userId) return null;
    return { accessToken, userId };
  },

  getAuthorizationUrl(state: string) {
    const appId = process.env.THREADS_APP_ID || process.env.FACEBOOK_APP_ID || "";
    if (!appId) return null;
    // Threads auth dialog (Meta)
    return (
      `https://threads.net/oauth/authorize` +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&response_type=code` +
      `&state=${encodeURIComponent(state)}`
    );
  },

  async exchangeCode(code: string): Promise<StoredTokens> {
    const appId = process.env.THREADS_APP_ID || process.env.FACEBOOK_APP_ID || "";
    const appSecret =
      process.env.THREADS_APP_SECRET || process.env.FACEBOOK_APP_SECRET || "";
    if (!appId || !appSecret) {
      throw new Error("THREADS_APP_ID/SECRET or FACEBOOK_APP_ID/SECRET required");
    }

    const body = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      code,
    });
    const tokenRes = await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    // Parse carefully: large user_id as number loses precision in JS
    const tokenRaw = await tokenRes.text();
    const tokenJson = JSON.parse(tokenRaw) as {
      access_token?: string;
      user_id?: number | string;
      error?: { message: string };
    };
    if (!tokenJson.access_token) {
      throw new Error(tokenJson.error?.message || "Threads token exchange failed");
    }

    let accessToken = tokenJson.access_token;
    // Long-lived (~60 days)
    try {
      const ll = await fetch(
        `https://graph.threads.net/access_token?grant_type=th_exchange_token` +
          `&client_secret=${encodeURIComponent(appSecret)}` +
          `&access_token=${encodeURIComponent(accessToken)}`,
        { signal: AbortSignal.timeout(30_000) },
      );
      const llJson = (await ll.json()) as { access_token?: string; expires_in?: number };
      if (llJson.access_token) accessToken = llJson.access_token;
    } catch {
      /* keep short-lived */
    }

    // Always resolve id from /me (string) — never trust numeric user_id from token JSON
    const me = await fetch(
      `https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    const meJson = (await me.json()) as { id?: string; username?: string };
    const userId = meJson.id || "";
    if (!userId) {
      throw new Error("Threads /me returned no id — check tester invite accepted");
    }
    console.log("[threads] User:", meJson.username || userId, userId);

    const tokens: StoredTokens = {
      platform: "threads",
      accessToken,
      userId,
      obtainedAt: Date.now(),
      scopes: SCOPES,
    };
    saveTokens(tokens);
    return tokens;
  },

  setupHelp() {
    return [
      "Meta Threads API app",
      `  Redirect: ${redirectUri()}`,
      "  Env: THREADS_APP_ID, THREADS_APP_SECRET (or Facebook app credentials)",
      "  Run: npm run auth -- threads",
    ].join("\n");
  },
};
