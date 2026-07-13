import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { OAuthPlatform, StoredTokens } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const tokensDir = path.resolve(projectRoot, "data/tokens");

function fileFor(platform: OAuthPlatform): string {
  return path.join(tokensDir, `${platform}.json`);
}

export function loadTokens(platform: OAuthPlatform): StoredTokens | null {
  try {
    const p = fileFor(platform);
    // Legacy LinkedIn path
    if (platform === "linkedin") {
      const legacy = path.resolve(projectRoot, "data/linkedin-tokens.json");
      if (fs.existsSync(legacy) && !fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(legacy, "utf8")) as {
          accessToken?: string;
          userId?: string;
          obtainedAt?: number;
          expiresIn?: number;
          scopes?: string;
        };
        if (raw.accessToken) {
          const migrated: StoredTokens = {
            platform: "linkedin",
            accessToken: raw.accessToken,
            userId: raw.userId,
            obtainedAt: raw.obtainedAt || Date.now(),
            expiresIn: raw.expiresIn,
            scopes: raw.scopes,
          };
          saveTokens(migrated);
          return migrated;
        }
      }
    }
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as StoredTokens;
    if (raw?.accessToken) return raw;
  } catch {
    // ignore
  }
  return null;
}

export function saveTokens(tokens: StoredTokens): void {
  if (!fs.existsSync(tokensDir)) fs.mkdirSync(tokensDir, { recursive: true });
  fs.writeFileSync(fileFor(tokens.platform), JSON.stringify(tokens, null, 2), "utf8");
  // Mirror critical fields into .env for legacy readers
  syncEnv(tokens);
  console.log(`[tokenStore] Saved ${tokens.platform} → data/tokens/${tokens.platform}.json`);
}

function syncEnv(tokens: StoredTokens): void {
  const map: Record<string, string> = {};
  switch (tokens.platform) {
    case "linkedin":
      map.LINKEDIN_ACCESS_TOKEN = tokens.accessToken;
      if (tokens.userId) map.LINKEDIN_USER_ID = tokens.userId;
      if (tokens.refreshToken) map.LINKEDIN_REFRESH_TOKEN = tokens.refreshToken;
      break;
    case "facebook":
      map.FACEBOOK_PAGE_TOKEN = tokens.accessToken;
      if (tokens.userId) map.FACEBOOK_PAGE_ID = tokens.userId;
      break;
    case "instagram":
      map.INSTAGRAM_TOKEN = tokens.accessToken;
      if (tokens.userId) map.INSTAGRAM_USER_ID = tokens.userId;
      break;
    case "threads":
      map.THREADS_TOKEN = tokens.accessToken;
      if (tokens.userId) map.THREADS_USER_ID = tokens.userId;
      break;
    case "x":
      if (tokens.extra?.accessTokenSecret) {
        map.X_ACCESS_TOKEN = tokens.accessToken;
        map.X_ACCESS_TOKEN_SECRET = tokens.extra.accessTokenSecret;
      } else {
        map.X_BEARER_TOKEN = tokens.accessToken;
      }
      break;
    case "blogger":
      map.BLOGGER_ACCESS_TOKEN = tokens.accessToken;
      if (tokens.refreshToken) map.BLOGGER_REFRESH_TOKEN = tokens.refreshToken;
      if (tokens.userId) map.BLOGGER_BLOG_ID = tokens.userId;
      break;
    default:
      break;
  }
  for (const [k, v] of Object.entries(map)) {
    process.env[k] = v;
    upsertEnvFile(k, v);
  }
}

function upsertEnvFile(key: string, value: string): void {
  const envPath = path.join(projectRoot, ".env");
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) content = content.replace(re, line);
  else {
    const sep = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    content = content + sep + line + "\n";
  }
  fs.writeFileSync(envPath, content, "utf8");
}
