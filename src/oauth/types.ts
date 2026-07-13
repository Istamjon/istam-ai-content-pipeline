/**
 * Unified multi-platform OAuth / credential types.
 *
 * Flow (same for every OAuth platform):
 *   LangGraph / CLI
 *        │
 *        ▼
 *   OAuth Manager (registry)
 *        │
 *        ▼
 *   Provider Login URL
 *        │
 *        ▼
 *   Callback Server (/auth/{platform}/callback)
 *        │
 *        ▼
 *   Access Token → data/tokens/{platform}.json
 */

export type OAuthPlatform =
  | "linkedin"
  | "facebook"
  | "instagram"
  | "threads"
  | "x"
  | "blogger";

export interface StoredTokens {
  platform: OAuthPlatform;
  accessToken: string;
  /** Optional refresh / long-lived */
  refreshToken?: string;
  /** Platform-specific user/page id */
  userId?: string;
  /** Extra fields (page tokens, secrets, blog id, oauth1 pair, …) */
  extra?: Record<string, string>;
  obtainedAt: number;
  expiresIn?: number;
  scopes?: string;
}

export interface AuthCredentials {
  accessToken: string;
  userId?: string;
  extra?: Record<string, string>;
}

export interface OAuthProvider {
  readonly id: OAuthPlatform;
  readonly displayName: string;
  /** Relative callback path, e.g. /auth/linkedin/callback */
  readonly callbackPath: string;
  /** True if client app credentials exist in env */
  isConfigured(): boolean;
  /** True if we can publish (tokens ready) */
  isReady(): boolean;
  getCredentials(): AuthCredentials | null;
  /** Browser authorize URL (OAuth 2). Null if not browser-OAuth (e.g. needs only API keys). */
  getAuthorizationUrl(state: string): string | null;
  /** Exchange callback code → store tokens */
  exchangeCode(code: string, state?: string): Promise<StoredTokens>;
  /** Optional: setup instructions for console */
  setupHelp(): string;
}
