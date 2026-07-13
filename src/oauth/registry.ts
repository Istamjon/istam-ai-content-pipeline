import { env } from "../config/env.js";
import { loadTokens } from "./tokenStore.js";
import type { AuthCredentials, OAuthPlatform, OAuthProvider } from "./types.js";
import { linkedinProvider } from "./providers/linkedin.js";
import { facebookProvider } from "./providers/facebook.js";
import { threadsProvider } from "./providers/threads.js";
import { xProvider } from "./providers/x.js";
import { bloggerProvider } from "./providers/blogger.js";

/** Instagram Graph — usually page token + IG business account id. */
const instagramProvider: OAuthProvider = {
  id: "instagram",
  displayName: "Instagram",
  callbackPath: "/auth/instagram/callback",
  isConfigured() {
    return (
      facebookProvider.isConfigured() ||
      Boolean(env.INSTAGRAM_TOKEN || process.env.INSTAGRAM_TOKEN)
    );
  },
  isReady() {
    return this.getCredentials() !== null;
  },
  getCredentials(): AuthCredentials | null {
    const t = loadTokens("instagram");
    const accessToken =
      t?.accessToken || env.INSTAGRAM_TOKEN || env.FACEBOOK_PAGE_TOKEN || "";
    const userId = t?.userId || env.INSTAGRAM_USER_ID || "";
    if (!accessToken || !userId) return null;
    return { accessToken, userId };
  },
  getAuthorizationUrl(state: string) {
    // Instagram login often goes through Facebook Login first
    return facebookProvider.getAuthorizationUrl(state);
  },
  async exchangeCode(code: string, state?: string) {
    // Store under facebook first; user sets INSTAGRAM_USER_ID for IG publishing
    return facebookProvider.exchangeCode(code, state);
  },
  setupHelp() {
    return [
      "Instagram Graph API (Business/Creator + FB Page)",
      "  Env: INSTAGRAM_TOKEN, INSTAGRAM_USER_ID",
      "  Or: npm run auth -- facebook  then set INSTAGRAM_USER_ID",
    ].join("\n");
  },
};

const providers: Record<OAuthPlatform, OAuthProvider> = {
  linkedin: linkedinProvider,
  facebook: facebookProvider,
  instagram: instagramProvider,
  threads: threadsProvider,
  x: xProvider,
  blogger: bloggerProvider,
};

export function getProvider(platform: string): OAuthProvider | undefined {
  return providers[platform as OAuthPlatform];
}

export function listProviders(): OAuthProvider[] {
  return Object.values(providers);
}

export function isPlatformReady(platform: string): boolean {
  if (platform === "telegram") {
    return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHANNEL);
  }
  const p = getProvider(platform);
  return p ? p.isReady() : false;
}

export { providers };
