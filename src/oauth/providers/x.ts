import crypto from "crypto";
import { env } from "../../config/env.js";
import { loadTokens, saveTokens } from "../tokenStore.js";
import type { AuthCredentials, OAuthProvider, StoredTokens } from "../types.js";

/**
 * X (Twitter) OAuth 2.0 Authorization Code + PKCE (user context for tweets).
 * Also accepts pre-set OAuth 1.0a keys in env as "ready".
 */
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"].join(" ");

const pkceStore = new Map<string, { verifier: string }>();

function redirectUri(): string {
  return process.env.X_REDIRECT_URI || "http://localhost:3000/auth/x/callback";
}

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const xProvider: OAuthProvider = {
  id: "x",
  displayName: "X (Twitter)",
  callbackPath: "/auth/x/callback",

  isConfigured() {
    const oauth2 = Boolean(process.env.X_CLIENT_ID);
    const oauth1 = Boolean(env.X_API_KEY && env.X_API_SECRET);
    return oauth2 || oauth1 || Boolean(env.X_BEARER_TOKEN);
  },

  isReady() {
    return this.getCredentials() !== null;
  },

  getCredentials(): AuthCredentials | null {
    const t = loadTokens("x");
    if (t?.accessToken) {
      return {
        accessToken: t.accessToken,
        userId: t.userId,
        extra: t.extra,
      };
    }
    // OAuth 1.0a from env
    if (env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_TOKEN_SECRET) {
      return {
        accessToken: env.X_ACCESS_TOKEN,
        extra: {
          accessTokenSecret: env.X_ACCESS_TOKEN_SECRET,
          apiKey: env.X_API_KEY,
          apiSecret: env.X_API_SECRET,
          mode: "oauth1",
        },
      };
    }
    if (env.X_BEARER_TOKEN) {
      return { accessToken: env.X_BEARER_TOKEN, extra: { mode: "bearer" } };
    }
    return null;
  },

  getAuthorizationUrl(state: string) {
    const clientId = process.env.X_CLIENT_ID || "";
    if (!clientId) return null;

    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
    pkceStore.set(state, { verifier });

    return (
      `https://twitter.com/i/oauth2/authorize` +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&state=${encodeURIComponent(state)}` +
      `&code_challenge=${encodeURIComponent(challenge)}` +
      `&code_challenge_method=S256`
    );
  },

  async exchangeCode(code: string, state?: string): Promise<StoredTokens> {
    const clientId = process.env.X_CLIENT_ID || "";
    const clientSecret = process.env.X_CLIENT_SECRET || "";
    if (!clientId) throw new Error("X_CLIENT_ID required");

    const verifier = (state && pkceStore.get(state)?.verifier) || process.env.X_PKCE_VERIFIER || "";
    if (!verifier) {
      throw new Error(
        "PKCE verifier missing — start auth via npm run auth -- x (same process)",
      );
    }

    const basic =
      clientSecret
        ? Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
        : "";

    const body = new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (basic) headers.Authorization = `Basic ${basic}`;

    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers,
      body,
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
        `X token failed: ${tokenJson.error || tokenRes.status} ${tokenJson.error_description || ""}`,
      );
    }

    let userId = "";
    try {
      const me = await fetch("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (me.ok) {
        const meJson = (await me.json()) as { data?: { id?: string; username?: string } };
        userId = meJson.data?.id || "";
        console.log("[x] User:", meJson.data?.username || userId);
      }
    } catch {
      // optional
    }

    if (state) pkceStore.delete(state);

    const tokens: StoredTokens = {
      platform: "x",
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      userId,
      obtainedAt: Date.now(),
      expiresIn: tokenJson.expires_in,
      scopes: SCOPES,
      extra: { mode: "oauth2" },
    };
    saveTokens(tokens);
    return tokens;
  },

  setupHelp() {
    return [
      "X Developer Portal → OAuth 2.0",
      `  Redirect: ${redirectUri()}`,
      "  Env: X_CLIENT_ID, X_CLIENT_SECRET (confidential client)",
      "  Or OAuth 1.0a: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET",
      "  Run: npm run auth -- x",
    ].join("\n");
  },
};
