import { env } from "../../config/env.js";
import { loadTokens, saveTokens } from "../tokenStore.js";
import type { AuthCredentials, OAuthProvider, StoredTokens } from "../types.js";

/** Member posts always need this. */
const BASE_SCOPES = ["openid", "profile", "email", "w_member_social"];

/** Company Page posts — only if app product allows it. */
const ORG_SCOPE = "w_organization_social";

function scopesForAuth(): string[] {
  if (env.LINKEDIN_REQUEST_ORG_SCOPE) {
    return [...BASE_SCOPES, ORG_SCOPE];
  }
  return [...BASE_SCOPES];
}

export const linkedinProvider: OAuthProvider = {
  id: "linkedin",
  displayName: "LinkedIn",
  callbackPath: "/auth/linkedin/callback",

  isConfigured() {
    return Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET);
  },

  isReady() {
    return this.getCredentials() !== null;
  },

  getCredentials(): AuthCredentials | null {
    const t = loadTokens("linkedin");
    const accessToken = t?.accessToken || env.LINKEDIN_ACCESS_TOKEN || "";
    const userId = t?.userId || env.LINKEDIN_USER_ID || "";
    if (!accessToken) return null;
    // Person id optional if only org posting, but we keep it when present
    return {
      accessToken,
      userId: userId ? userId.replace(/^urn:li:person:/, "") : undefined,
      extra: {
        refreshToken: t?.refreshToken || env.LINKEDIN_REFRESH_TOKEN || "",
        canOrg: t?.extra?.canOrg || "",
        organizationId: env.LINKEDIN_ORGANIZATION_ID || t?.extra?.organizationId || "",
      },
    };
  },

  getAuthorizationUrl(state: string) {
    if (!this.isConfigured()) return null;
    const scopes = scopesForAuth();
    return (
      "https://www.linkedin.com/oauth/v2/authorization" +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(env.LINKEDIN_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(env.LINKEDIN_REDIRECT_URI)}` +
      `&scope=${encodeURIComponent(scopes.join(" "))}` +
      `&state=${encodeURIComponent(state)}`
    );
  },

  async exchangeCode(code: string): Promise<StoredTokens> {
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: env.LINKEDIN_REDIRECT_URI,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
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
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(
        `LinkedIn token failed: ${tokenJson.error || tokenRes.status} ${tokenJson.error_description || ""}`,
      );
    }

    let userId = "";
    const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (meRes.ok) {
      const me = (await meRes.json()) as { sub?: string; name?: string };
      userId = (me.sub || "").replace(/^urn:li:person:/, "");
      console.log("[linkedin] Profile:", me.name || userId);
    }
    if (!userId) {
      throw new Error("LinkedIn user id (sub) missing from userinfo");
    }

    const canOrg = await probeCanPostAsOrganization(
      tokenJson.access_token,
      env.LINKEDIN_ORGANIZATION_ID,
    );

    const tokens: StoredTokens = {
      platform: "linkedin",
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      userId,
      obtainedAt: Date.now(),
      expiresIn: tokenJson.expires_in,
      scopes: scopesForAuth().join(" "),
      extra: {
        canOrg: canOrg ? "1" : "0",
        organizationId: env.LINKEDIN_ORGANIZATION_ID || "",
      },
    };
    saveTokens(tokens);
    return tokens;
  },

  setupHelp() {
    return [
      "LinkedIn Developer App:",
      "  Products: OpenID Connect + Share on LinkedIn",
      "  Company Page: Community Management API (w_organization_social)",
      `  Redirect: ${env.LINKEDIN_REDIRECT_URI}`,
      "  Env: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET",
      "  Env: LINKEDIN_ORGANIZATION_ID, LINKEDIN_POST_AS=auto",
      "  After Community Management API approved: LINKEDIN_REQUEST_ORG_SCOPE=true",
      "  Run: npm run auth -- linkedin",
      "  Diagnose: npm run linkedin:doctor",
    ].join("\n");
  },
};

/** LinkedIn access tokens are typically ~60d; refresh when under 7 days left. */
const LINKEDIN_REFRESH_IF_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;
const LINKEDIN_UNKNOWN_EXPIRY_MAX_AGE_MS = 50 * 24 * 60 * 60 * 1000;

function linkedInAccessTokenStillFresh(stored: StoredTokens | null): boolean {
  if (!stored?.accessToken) return false;
  if (!stored.obtainedAt || !stored.expiresIn) {
    // Unknown expiry — treat as fresh until ~50d old (Meta/LinkedIn LL window style)
    if (!stored.obtainedAt) return true;
    return Date.now() - stored.obtainedAt < LINKEDIN_UNKNOWN_EXPIRY_MAX_AGE_MS;
  }
  const left = stored.obtainedAt + stored.expiresIn * 1000 - Date.now();
  return left >= LINKEDIN_REFRESH_IF_WITHIN_MS;
}

/**
 * Refresh access token using LINKEDIN_REFRESH_TOKEN.
 * Returns new (or still-valid) access token, or null.
 *
 * By default skips the network call when the stored token is still fresh.
 * Pass `{ force: true }` after 401 / EXPIRED responses.
 */
export async function refreshLinkedInAccessToken(options?: {
  force?: boolean;
}): Promise<string | null> {
  const stored = loadTokens("linkedin");
  if (!options?.force && linkedInAccessTokenStillFresh(stored)) {
    return stored!.accessToken;
  }

  const refreshToken =
    stored?.refreshToken || env.LINKEDIN_REFRESH_TOKEN || process.env.LINKEDIN_REFRESH_TOKEN || "";
  if (!refreshToken || !env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET) {
    // No refresh path — still return existing access token if present
    return stored?.accessToken || null;
  }

  const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.LINKEDIN_CLIENT_ID,
      client_secret: env.LINKEDIN_CLIENT_SECRET,
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

  if (!tokenRes.ok || !tokenJson.access_token) {
    console.warn(
      "[linkedin] refresh failed:",
      tokenJson.error || tokenRes.status,
      tokenJson.error_description || "",
    );
    return null;
  }

  const prev = loadTokens("linkedin");
  const userId = prev?.userId || env.LINKEDIN_USER_ID || "";
  saveTokens({
    platform: "linkedin",
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token || refreshToken,
    userId,
    obtainedAt: Date.now(),
    expiresIn: tokenJson.expires_in,
    scopes: prev?.scopes,
    extra: prev?.extra,
  });

  console.log("[linkedin] Access token refreshed");
  return tokenJson.access_token;
}

/** Probe whether this token can post as the company page. */
export async function probeCanPostAsOrganization(
  accessToken: string,
  orgIdRaw?: string,
): Promise<boolean> {
  const orgId = (orgIdRaw || env.LINKEDIN_ORGANIZATION_ID || "").replace(/\D/g, "");
  if (!orgId || !accessToken) return false;

  try {
    // If we can list org ACLs as admin, org social is likely available
    const acl = await fetch(
      "https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Restli-Protocol-Version": "2.0.0",
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (acl.ok) {
      const body = (await acl.json()) as {
        elements?: Array<{ organizationalTarget?: string }>;
      };
      const target = `urn:li:organization:${orgId}`;
      const hit = body.elements?.some((e) => e.organizationalTarget === target);
      if (hit) return true;
      // ACL works but different org — still might post if token has org social
      if ((body.elements?.length || 0) > 0) return true;
    }
  } catch {
    // ignore
  }

  // Lightweight: try registerUpload for org (cheap fail) — skip to avoid side effects
  return false;
}

export function getLinkedInPostMode(): "both" | "auto" | "person" | "organization" {
  // Default matches env.LINKEDIN_POST_AS (person) — safest for forks / missing org scope
  const m = (env.LINKEDIN_POST_AS || "person").toLowerCase();
  if (m === "company" || m === "page") return "organization";
  if (m === "person" || m === "organization" || m === "both" || m === "auto") {
    return m as "both" | "auto" | "person" | "organization";
  }
  return "person";
}
