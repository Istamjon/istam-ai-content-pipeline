/**
 * Cloudflare multi-account registry + auto Account ID resolve + cache.
 * Each account = separate free Workers AI Neurons pool (~10k/day).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../config/env.js";
import type { ImageProviderName } from "../db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.resolve(__dirname, "../../data/cloudflare-accounts.json");

export type CloudflareAccountSlot = {
  label: string;
  providerKey: ImageProviderName;
  accountId: string;
  token: string;
  name?: string;
};

type CacheFile = {
  updatedAt: string;
  byTokenSuffix: Record<
    string,
    { accountId: string; name?: string; label?: string }
  >;
};

function tokenSuffix(token: string): string {
  return token.slice(-12);
}

function loadCache(): CacheFile {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")) as CacheFile;
    }
  } catch {
    /* ignore */
  }
  return { updatedAt: "", byTokenSuffix: {} };
}

function saveCache(cache: CacheFile): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    cache.updatedAt = new Date().toISOString();
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
  } catch (e) {
    console.warn("[cf-accounts] cache write failed:", e);
  }
}

/** Resolve Account ID for a token via GET /accounts (needs Account Read). */
export async function resolveAccountIdForToken(
  token: string,
): Promise<{ accountId: string; name?: string } | null> {
  if (!token) return null;
  try {
    const res = await fetch(
      "https://api.cloudflare.com/client/v4/accounts?per_page=50",
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
    const json = (await res.json()) as {
      success?: boolean;
      result?: Array<{ id?: string; name?: string }>;
    };
    const list = json.result?.filter((a) => a.id) ?? [];
    if (list.length === 0) return null;
    // Prefer first account (token usually scoped to one)
    return { accountId: list[0].id!, name: list[0].name };
  } catch (e) {
    console.warn(
      "[cf-accounts] resolve failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

type RawCandidate = {
  label: string;
  providerKey: ImageProviderName;
  accountId: string;
  token: string;
};

function rawCandidates(): RawCandidate[] {
  const out: RawCandidate[] = [
    {
      label: "cf1",
      providerKey: "cloudflare",
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_API_TOKEN,
    },
    {
      label: "cf2",
      providerKey: "cloudflare2",
      accountId: env.CLOUDFLARE_ACCOUNT_ID_2,
      token: env.CLOUDFLARE_API_TOKEN_2,
    },
    {
      label: "cf3",
      providerKey: "cloudflare3",
      accountId: env.CLOUDFLARE_ACCOUNT_ID_3,
      token: env.CLOUDFLARE_API_TOKEN_3,
    },
  ];

  // Optional bulk: CLOUDFLARE_ACCOUNTS=id:token,id:token  or  token-only (auto-resolve)
  const bulk = (process.env.CLOUDFLARE_ACCOUNTS || "").trim();
  if (bulk) {
    const parts = bulk.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    let i = out.length + 1;
    for (const p of parts) {
      if (p.includes(":")) {
        const [accountId, token] = p.split(":").map((x) => x.trim());
        if (accountId && token) {
          out.push({
            label: `cf${i}`,
            providerKey: (i === 1
              ? "cloudflare"
              : i === 2
                ? "cloudflare2"
                : "cloudflare3") as ImageProviderName,
            accountId,
            token,
          });
          i++;
        }
      }
    }
  }

  return out.filter((c) => Boolean(c.token));
}

let resolvedCache: CloudflareAccountSlot[] | null = null;
let resolvePromise: Promise<CloudflareAccountSlot[]> | null = null;

/**
 * Sync slots: only those with accountId already known (env or disk cache).
 * Use ensureCloudflareAccounts() for auto-resolve.
 */
export function getCloudflareAccountsSync(): CloudflareAccountSlot[] {
  if (resolvedCache) return resolvedCache;
  const cache = loadCache();
  const slots: CloudflareAccountSlot[] = [];
  for (const c of rawCandidates()) {
    let accountId = c.accountId;
    let name: string | undefined;
    if (!accountId) {
      const hit = cache.byTokenSuffix[tokenSuffix(c.token)];
      if (hit?.accountId) {
        accountId = hit.accountId;
        name = hit.name;
      }
    }
    if (accountId && c.token) {
      slots.push({
        label: c.label,
        providerKey: c.providerKey,
        accountId,
        token: c.token,
        name,
      });
    }
  }
  return slots;
}

/**
 * Ensure all tokens have Account IDs (auto-resolve via API when possible).
 * Caches successful resolves to data/cloudflare-accounts.json.
 */
export async function ensureCloudflareAccounts(): Promise<
  CloudflareAccountSlot[]
> {
  if (resolvedCache) return resolvedCache;
  if (resolvePromise) return resolvePromise;

  resolvePromise = (async () => {
    const cache = loadCache();
    const slots: CloudflareAccountSlot[] = [];
    const pending: string[] = [];

    for (const c of rawCandidates()) {
      let accountId = c.accountId;
      let name: string | undefined;

      if (!accountId) {
        const hit = cache.byTokenSuffix[tokenSuffix(c.token)];
        if (hit?.accountId) {
          accountId = hit.accountId;
          name = hit.name;
          console.log(
            `[cf-accounts] ${c.label}: Account ID from cache …${accountId.slice(-6)}`,
          );
        }
      }

      if (!accountId) {
        console.log(
          `[cf-accounts] ${c.label}: resolving Account ID via API…`,
        );
        const resolved = await resolveAccountIdForToken(c.token);
        if (resolved) {
          accountId = resolved.accountId;
          name = resolved.name;
          cache.byTokenSuffix[tokenSuffix(c.token)] = {
            accountId,
            name,
            label: c.label,
          };
          console.log(
            `[cf-accounts] ${c.label}: resolved …${accountId.slice(-6)} (${name || "?"})`,
          );
        } else {
          pending.push(c.label);
          console.warn(
            `[cf-accounts] ${c.label}: cannot resolve Account ID (token needs Account Settings: Read, or set CLOUDFLARE_ACCOUNT_ID_* in .env)`,
          );
        }
      }

      if (accountId && c.token) {
        slots.push({
          label: c.label,
          providerKey: c.providerKey,
          accountId,
          token: c.token,
          name,
        });
      }
    }

    saveCache(cache);
    resolvedCache = slots;

    if (pending.length > 0) {
      console.warn(
        `[cf-accounts] inactive slots (no Account ID): ${pending.join(", ")}. ` +
          `Dashboard → right sidebar Account ID, or recreate token with Account Settings: Read.`,
      );
    }
    console.log(
      `[cf-accounts] active rotation: ${slots.map((s) => s.label).join(" → ") || "(none)"} (${slots.length} account(s))`,
    );
    return slots;
  })();

  try {
    return await resolvePromise;
  } finally {
    resolvePromise = null;
  }
}

export function clearCloudflareAccountsCacheMemory(): void {
  resolvedCache = null;
}

/** Pending tokens that have no Account ID yet. */
export function getPendingCloudflareSlots(): string[] {
  const active = new Set(getCloudflareAccountsSync().map((s) => s.label));
  return rawCandidates()
    .filter((c) => !active.has(c.label) || !c.accountId)
    .filter((c) => {
      const cache = loadCache();
      const hit = cache.byTokenSuffix[tokenSuffix(c.token)];
      return !c.accountId && !hit?.accountId;
    })
    .map((c) => c.label);
}
