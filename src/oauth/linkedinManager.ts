/**
 * Backward-compatible LinkedIn OAuth facade.
 * Prefer: import { linkedinProvider } from "./providers/linkedin.js"
 *      or: import { getProvider } from "./registry.js"
 */
import { linkedinProvider } from "./providers/linkedin.js";

export const linkedInOAuth = {
  isConfigured: () => linkedinProvider.isConfigured(),
  isReady: () => linkedinProvider.isReady(),
  getCredentials: () => {
    const c = linkedinProvider.getCredentials();
    if (!c?.accessToken || !c.userId) return null;
    const userId = c.userId.replace(/^urn:li:person:/, "");
    return {
      accessToken: c.accessToken,
      userId,
      authorUrn: `urn:li:person:${userId}`,
    };
  },
  getAuthorizationUrl: (state?: string) =>
    linkedinProvider.getAuthorizationUrl(state || `io_${Date.now()}`),
  exchangeCode: (code: string) => linkedinProvider.exchangeCode(code),
};
