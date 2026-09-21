/* eslint-disable no-process-env */
/**
 * Integration tests for the proactive OAuth token-refresh path.
 *
 * Why this file exists
 * --------------------
 * The audit ranks a stale access token as the most expensive silent failure in
 * the pipeline: nothing crashes, the run just dies mid-publish with a 401 and
 * the slot is lost. `refreshAllExpiringTokens()` runs before every publish
 * batch, so its behaviour is what stands between a healthy deployment and a
 * silently dead one. Before this file, `src/oauth/*` had 0% coverage.
 *
 * What is pinned here
 * -------------------
 *   1. The expiry heuristic: long-lived tokens (7-day window), Google/X
 *      short-lived tokens (5-minute buffer), and unknown-TTL tokens (50-day
 *      age rule). Three branches, easy to break, hard to notice.
 *   2. Every per-platform refresh flow, end to end, over a real HTTP socket.
 *   3. That the batch entry point never rejects — a failed refresh must
 *      degrade to "keep the old token", never to "crash the publish run".
 *
 * Real HTTP, not a stubbed `fetch`
 * --------------------------------
 * The refresh helpers call the global `fetch`. Rather than replacing `fetch`
 * with a spy (which asserts on call shape and skips the transport), this suite
 * stands up an ephemeral `http.createServer` on port 0 and re-points the global
 * `fetch` at it. Requests are still real sockets with real `Request`/`Response`
 * objects and real JSON parsing — only the *destination* is redirected. The
 * suite stays offline and deterministic without gutting the code path under
 * test.
 *
 * Filesystem side effects
 * -----------------------
 * `tokenStore` derives `data/tokens` from `import.meta.url`, so it always
 * writes into the *real* repo directory, and `saveTokens()` additionally
 * mirrors every value into `.env`. On a developer machine (and on the VDS)
 * those hold live production credentials. Everything this suite can touch is
 * snapshotted in `beforeAll` and restored byte-for-byte in `afterAll`, so it is
 * safe to run against a machine with real tokens.
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import type { AddressInfo } from "net";
import { saveTokens } from "./tokenStore.js";
import type { OAuthPlatform, StoredTokens } from "./types.js";

// ── Paths (resolved the same way tokenStore resolves them) ──────────
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const tokensDir = path.join(repoRoot, "data/tokens");
const envPath = path.join(repoRoot, ".env");
const legacyLinkedInPath = path.join(repoRoot, "data/linkedin-tokens.json");

const PLATFORMS: OAuthPlatform[] = [
  "linkedin",
  "facebook",
  "instagram",
  "threads",
  "x",
  "blogger",
];

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): number => Date.now() - n * DAY_MS;

// ── Environment ─────────────────────────────────────────────────────
/**
 * Written by `tokenStore.syncEnv()` as a live global cache, and/or read live
 * via `process.env` by the refresh helpers. Must not leak between tests.
 */
const LIVE_ENV_KEYS = [
  "LINKEDIN_ACCESS_TOKEN",
  "LINKEDIN_USER_ID",
  "LINKEDIN_REFRESH_TOKEN",
  "FACEBOOK_PAGE_TOKEN",
  "FACEBOOK_PAGE_ID",
  "INSTAGRAM_TOKEN",
  "INSTAGRAM_USER_ID",
  "THREADS_TOKEN",
  "THREADS_USER_ID",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
  "X_BEARER_TOKEN",
  "BLOGGER_ACCESS_TOKEN",
  "BLOGGER_REFRESH_TOKEN",
  "BLOGGER_BLOG_ID",
  // read live by refreshBlogger / refreshX
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
];

/**
 * `src/config/env.ts` snapshots `process.env` into a frozen object at *import*
 * time, so these must be set before the module under test is imported (see the
 * dynamic import in `beforeAll`). Only the Facebook and LinkedIn refresh paths
 * read credentials through that frozen object rather than live `process.env`.
 */
const IMPORT_TIME_ENV: Record<string, string> = {
  FACEBOOK_APP_ID: "test-fb-app-id",
  FACEBOOK_APP_SECRET: "test-fb-app-secret",
  LINKEDIN_CLIENT_ID: "test-li-client-id",
  LINKEDIN_CLIENT_SECRET: "test-li-client-secret",
};

const SNAPSHOT_KEYS = [...LIVE_ENV_KEYS, ...Object.keys(IMPORT_TIME_ENV)];
const envSnapshot = new Map<string, string | undefined>();

// ── Module under test (imported dynamically, after env is prepared) ─
let refreshAllExpiringTokens: (typeof import("./tokenRefresh.js"))["refreshAllExpiringTokens"];
let isTokenExpiring: (typeof import("./tokenRefresh.js"))["isTokenExpiring"];
let msUntilExpiry: (typeof import("./tokenRefresh.js"))["msUntilExpiry"];
let expiresAtMs: (typeof import("./tokenRefresh.js"))["expiresAtMs"];
let tokenStatusReport: (typeof import("./tokenRefresh.js"))["tokenStatusReport"];

// ── Mock HTTP server ────────────────────────────────────────────────
interface Hit {
  url: string;
  method: string;
  body: string;
  headers: http.IncomingHttpHeaders;
}

interface Reply {
  status: number;
  body: string;
  contentType?: string;
}

const json = (status: number, obj: unknown): Reply => ({
  status,
  body: JSON.stringify(obj),
  contentType: "application/json",
});

const realFetch = globalThis.fetch;
let server: http.Server;
let base = "";
let hits: Hit[] = [];
let respond: (hit: Hit) => Reply = () => json(200, {});

/** Extract the URL from whatever `fetch` was handed (string, URL or Request). */
function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  const obj = input as { href?: string; url?: string } | null;
  if (obj && typeof obj.href === "string") return obj.href;
  if (obj && typeof obj.url === "string") return obj.url;
  return String(input);
}

/** Keep the path + query, swap the origin for the local test server. */
function toLocal(input: unknown): URL {
  const parsed = new URL(urlOf(input));
  return new URL(parsed.pathname + parsed.search, base);
}

/** The single request recorded for `method` + path, failing loudly otherwise. */
function only(method: string, pathFragment: string): Hit {
  const matching = hits.filter(
    (h) => h.method === method && h.url.includes(pathFragment),
  );
  if (matching.length !== 1) {
    throw new Error(
      `Expected exactly 1 ${method} ${pathFragment}, got ${matching.length}. ` +
        `Recorded: ${JSON.stringify(hits.map((h) => `${h.method} ${h.url}`))}`,
    );
  }
  return matching[0];
}

// ── Token file helpers ──────────────────────────────────────────────
function tokenFile(platform: OAuthPlatform): string {
  return path.join(tokensDir, `${platform}.json`);
}

/** Write a token file directly, bypassing `syncEnv` so tests stay deterministic. */
function seed(
  platform: OAuthPlatform,
  tokens: Omit<StoredTokens, "platform">,
): void {
  fs.mkdirSync(tokensDir, { recursive: true });
  fs.writeFileSync(
    tokenFile(platform),
    JSON.stringify({ platform, ...tokens }, null, 2),
    "utf8",
  );
}

function readToken(platform: OAuthPlatform): StoredTokens | null {
  const file = tokenFile(platform);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as StoredTokens;
}

/** A healthy, non-expiring token: 60-day TTL, just issued. */
function fresh(
  platform: OAuthPlatform,
  overrides: Partial<Omit<StoredTokens, "platform">> = {},
): Omit<StoredTokens, "platform"> {
  return {
    accessToken: `FRESH-${platform.toUpperCase()}`,
    userId: `user-${platform}`,
    obtainedAt: Date.now(),
    expiresIn: 60 * 24 * 3600,
    extra: platform === "x" ? { mode: "oauth2" } : {},
    ...overrides,
  };
}

/** A token one day from expiry — past the 7-day threshold, so it must refresh. */
function expiring(
  platform: OAuthPlatform,
  overrides: Partial<Omit<StoredTokens, "platform">> = {},
): Omit<StoredTokens, "platform"> {
  return fresh(platform, {
    accessToken: `OLD-${platform.toUpperCase()}`,
    obtainedAt: daysAgo(59),
    ...overrides,
  });
}

/** Narrow helper so assertions never need a non-null assertion. */
function pick<T extends { platform: OAuthPlatform }>(
  report: T[],
  platform: OAuthPlatform,
): T {
  const found = report.find((r) => r.platform === platform);
  if (!found) throw new Error(`No status entry for ${platform}`);
  return found;
}

// ── Snapshot / restore ──────────────────────────────────────────────
let tokenSnapshot = new Map<string, string | null>();
let envFileSnapshot: string | null = null;
let legacySnapshot: string | null = null;
let tokensDirExisted = false;

function restoreEverything(): Promise<void> {
  globalThis.fetch = realFetch;
  for (const [file, content] of tokenSnapshot) {
    if (content === null) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } else {
      fs.writeFileSync(file, content, "utf8");
    }
  }
  if (!tokensDirExisted && fs.existsSync(tokensDir)) {
    if (fs.readdirSync(tokensDir).length === 0) fs.rmdirSync(tokensDir);
  }
  if (legacySnapshot !== null)
    fs.writeFileSync(legacyLinkedInPath, legacySnapshot, "utf8");
  if (envFileSnapshot === null) {
    if (fs.existsSync(envPath)) fs.unlinkSync(envPath);
  } else {
    fs.writeFileSync(envPath, envFileSnapshot, "utf8");
  }
  for (const [key, value] of envSnapshot) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

// ── Setup / teardown ────────────────────────────────────────────────
beforeAll(async () => {
  // 1. Snapshot everything we are allowed to touch, before any of it changes.
  for (const key of SNAPSHOT_KEYS) envSnapshot.set(key, process.env[key]);
  tokenSnapshot = new Map();
  for (const platform of PLATFORMS) {
    const file = tokenFile(platform);
    tokenSnapshot.set(
      file,
      fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null,
    );
  }
  envFileSnapshot = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8")
    : null;
  tokensDirExisted = fs.existsSync(tokensDir);
  legacySnapshot = fs.existsSync(legacyLinkedInPath)
    ? fs.readFileSync(legacyLinkedInPath, "utf8")
    : null;

  // 2. Point the global fetch at a real local socket.
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const hit: Hit = {
        url: req.url || "",
        method: req.method || "GET",
        body,
        headers: req.headers,
      };
      hits.push(hit);
      const reply = respond(hit);
      res.writeHead(reply.status, {
        "Content-Type": reply.contentType || "application/json",
      });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  globalThis.fetch = ((input: unknown, init?: unknown) =>
    realFetch(toLocal(input), init as RequestInit)) as typeof fetch;

  // 3. Prepare env, THEN import the module under test (see IMPORT_TIME_ENV).
  Object.assign(process.env, IMPORT_TIME_ENV);
  const mod = await import("./tokenRefresh.js");
  ({
    refreshAllExpiringTokens,
    isTokenExpiring,
    msUntilExpiry,
    expiresAtMs,
    tokenStatusReport,
  } = mod);
});

afterAll(async () => {
  await restoreEverything();
});

beforeEach(() => {
  hits = [];
  respond = () => json(200, {});
  for (const key of LIVE_ENV_KEYS) delete process.env[key];
  // Every platform starts healthy, so only the platform under test can make an
  // HTTP call. That keeps `only()` assertions unambiguous.
  for (const platform of PLATFORMS) seed(platform, fresh(platform));
});

// ════════════════════════════════════════════════════════════════════
// 1. Expiry heuristic
// ════════════════════════════════════════════════════════════════════
describe("isTokenExpiring", () => {
  it("treats a missing or empty token as expiring", () => {
    expect(isTokenExpiring(null)).toBe(true);
    expect(
      isTokenExpiring({
        platform: "threads",
        ...fresh("threads", { accessToken: "" }),
      }),
    ).toBe(true);
  });

  it("long-lived token with 30 days left is NOT expiring", () => {
    expect(
      isTokenExpiring({
        platform: "threads",
        ...fresh("threads", {
          obtainedAt: daysAgo(30),
          expiresIn: 60 * 24 * 3600,
        }),
      }),
    ).toBe(false);
  });

  it("long-lived token with 3 days left IS expiring (inside the 7-day window)", () => {
    expect(
      isTokenExpiring({
        platform: "threads",
        ...fresh("threads", {
          obtainedAt: daysAgo(57),
          expiresIn: 60 * 24 * 3600,
        }),
      }),
    ).toBe(true);
  });

  it("long-lived token with 8 days left is NOT expiring (just outside the window)", () => {
    expect(
      isTokenExpiring({
        platform: "threads",
        ...fresh("threads", {
          obtainedAt: daysAgo(52),
          expiresIn: 60 * 24 * 3600,
        }),
      }),
    ).toBe(false);
  });

  it("short-lived token with 1h left is NOT expiring — 5-minute buffer, not 7 days", () => {
    // Google access tokens live ~1h. Applying the 7-day rule to them would
    // mean refreshing on literally every run.
    expect(
      isTokenExpiring({
        platform: "blogger",
        ...fresh("blogger", { obtainedAt: Date.now(), expiresIn: 3600 }),
      }),
    ).toBe(false);
  });

  it("switches to the long-lived rule once TTL exceeds the 3h short-token cutoff", () => {
    // Identical remaining life (1h), two different TTLs — this is the boundary
    // between the two rules, and the only place they can be told apart.
    const oneHourLeftShortTtl = {
      platform: "blogger" as const,
      ...fresh("blogger", { obtainedAt: Date.now(), expiresIn: 3600 }),
    };
    expect(isTokenExpiring(oneHourLeftShortTtl)).toBe(false);

    const oneHourLeftLongTtl = {
      platform: "blogger" as const,
      ...fresh("blogger", {
        obtainedAt: Date.now() - 3 * 3600 * 1000,
        expiresIn: 4 * 3600,
      }),
    };
    expect(isTokenExpiring(oneHourLeftLongTtl)).toBe(true);
  });

  it("short-lived token inside the 5-minute buffer IS expiring", () => {
    expect(
      isTokenExpiring({
        platform: "blogger",
        ...fresh("blogger", {
          obtainedAt: Date.now() - (3600 - 3) * 1000,
          expiresIn: 3600,
        }),
      }),
    ).toBe(true);
  });

  it("unknown expiry: a 10-day-old token is NOT expiring", () => {
    expect(
      isTokenExpiring({
        platform: "facebook",
        ...fresh("facebook", { obtainedAt: daysAgo(10), expiresIn: undefined }),
      }),
    ).toBe(false);
  });

  it("unknown expiry: a 49-day-old token is NOT expiring", () => {
    expect(
      isTokenExpiring({
        platform: "facebook",
        ...fresh("facebook", { obtainedAt: daysAgo(49), expiresIn: undefined }),
      }),
    ).toBe(false);
  });

  it("unknown expiry: a token older than 50 days IS expiring", () => {
    // Meta long-lived tokens are ~60 days; 50 is the conservative floor.
    expect(
      isTokenExpiring({
        platform: "facebook",
        ...fresh("facebook", { obtainedAt: daysAgo(51), expiresIn: undefined }),
      }),
    ).toBe(true);
  });

  it("with neither obtainedAt nor expiresIn it cannot judge, and does not claim expiry", () => {
    expect(
      isTokenExpiring({ platform: "x", accessToken: "t" } as StoredTokens),
    ).toBe(false);
  });
});

describe("msUntilExpiry / expiresAtMs", () => {
  it("returns null when either field is missing", () => {
    expect(
      msUntilExpiry({
        platform: "x",
        accessToken: "t",
        obtainedAt: Date.now(),
      } as StoredTokens),
    ).toBeNull();
    expect(
      expiresAtMs({
        platform: "x",
        accessToken: "t",
        obtainedAt: Date.now(),
      } as StoredTokens),
    ).toBeNull();
    expect(
      msUntilExpiry({
        platform: "x",
        accessToken: "t",
        expiresIn: 60,
      } as StoredTokens),
    ).toBeNull();
  });

  it("computes the remaining lifetime from obtainedAt + expiresIn", () => {
    const obtainedAt = daysAgo(10);
    const token = {
      platform: "threads" as const,
      ...fresh("threads", { obtainedAt, expiresIn: 20 * 24 * 3600 }),
    };
    expect(expiresAtMs(token)).toBe(obtainedAt + 20 * 24 * 3600 * 1000);
    const left = msUntilExpiry(token);
    expect(left).toBeGreaterThan(10 * DAY_MS - 5000);
    expect(left).toBeLessThan(10 * DAY_MS + 5000);
  });
});

describe("tokenStatusReport", () => {
  it("reports hasToken / expiring / daysLeft for all six platforms", () => {
    seed("threads", fresh("threads", { obtainedAt: daysAgo(50) }));
    seed("x", expiring("x"));
    seed("instagram", fresh("instagram", { accessToken: "" }));

    const report = tokenStatusReport();
    expect(report.map((r) => r.platform)).toEqual([
      "linkedin",
      "facebook",
      "instagram",
      "threads",
      "x",
      "blogger",
    ]);

    const threads = pick(report, "threads");
    expect(threads.hasToken).toBe(true);
    expect(threads.expiring).toBe(false);
    expect(threads.daysLeft).toBeGreaterThanOrEqual(9);

    const x = pick(report, "x");
    expect(x.expiring).toBe(true);
    expect(x.daysLeft).toBeLessThanOrEqual(1);
    expect(x.daysLeft).toBeGreaterThanOrEqual(0);

    // An empty access token is not a token: loadTokens() filters it out.
    const instagram = pick(report, "instagram");
    expect(instagram.hasToken).toBe(false);
    expect(instagram.expiring).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Per-platform refresh flows (real HTTP)
// ════════════════════════════════════════════════════════════════════
describe("refreshAllExpiringTokens — Threads", () => {
  it("refreshes an expiring token over HTTP and persists the new one", async () => {
    seed("threads", expiring("threads", { userId: "TH-1" }));
    respond = () =>
      json(200, { access_token: "NEW-THREADS", expires_in: 5184000 });

    await refreshAllExpiringTokens();

    const hit = only("GET", "/refresh_access_token");
    expect(hit.url).toContain("grant_type=th_refresh_token");
    expect(hit.url).toContain(
      `access_token=${encodeURIComponent("OLD-THREADS")}`,
    );

    const saved = readToken("threads");
    expect(saved?.accessToken).toBe("NEW-THREADS");
    expect(saved?.expiresIn).toBe(5184000);
    expect(saved?.userId).toBe("TH-1");
    expect(saved?.obtainedAt).toBeGreaterThan(Date.now() - 5000);
  });

  it("makes no HTTP call when the token is not expiring", async () => {
    await refreshAllExpiringTokens();
    expect(hits).toHaveLength(0);
    expect(readToken("threads")?.accessToken).toBe("FRESH-THREADS");
  });

  it("keeps the stored token when the API replies without an access_token", async () => {
    seed("threads", expiring("threads"));
    respond = () => json(200, { error: { message: "Session has expired" } });

    await refreshAllExpiringTokens();

    expect(only("GET", "/refresh_access_token").url).toContain(
      "th_refresh_token",
    );
    expect(readToken("threads")?.accessToken).toBe("OLD-THREADS");
  });

  it("survives a non-JSON response instead of throwing", async () => {
    seed("threads", expiring("threads"));
    respond = () => ({
      status: 502,
      body: "<html>bad gateway</html>",
      contentType: "text/html",
    });

    await expect(refreshAllExpiringTokens()).resolves.toBeUndefined();
    expect(readToken("threads")?.accessToken).toBe("OLD-THREADS");
  });
});

describe("refreshAllExpiringTokens — Blogger (Google)", () => {
  it("exchanges the refresh_token for a new access token", async () => {
    seed(
      "blogger",
      expiring("blogger", { refreshToken: "RT-BLOGGER", userId: "BLOG-1" }),
    );
    process.env.GOOGLE_CLIENT_ID = "google-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    respond = () =>
      json(200, { access_token: "NEW-BLOGGER", expires_in: 3599 });

    await refreshAllExpiringTokens();

    const params = new URLSearchParams(only("POST", "/token").body);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("RT-BLOGGER");
    expect(params.get("client_id")).toBe("google-id");
    expect(params.get("client_secret")).toBe("google-secret");

    const saved = readToken("blogger");
    expect(saved?.accessToken).toBe("NEW-BLOGGER");
    expect(saved?.expiresIn).toBe(3599);
    expect(saved?.refreshToken).toBe("RT-BLOGGER");
    expect(saved?.userId).toBe("BLOG-1");
  });

  it("defaults expiresIn to 3600 when Google omits it", async () => {
    seed("blogger", expiring("blogger", { refreshToken: "RT-BLOGGER" }));
    process.env.GOOGLE_CLIENT_ID = "google-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    respond = () => json(200, { access_token: "NEW-BLOGGER" });

    await refreshAllExpiringTokens();
    expect(readToken("blogger")?.expiresIn).toBe(3600);
  });

  it("keeps the token when Google rejects the refresh", async () => {
    seed("blogger", expiring("blogger", { refreshToken: "RT-BLOGGER" }));
    process.env.GOOGLE_CLIENT_ID = "google-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    respond = () =>
      json(400, {
        error: "invalid_grant",
        error_description: "Token has been revoked",
      });

    await refreshAllExpiringTokens();
    expect(readToken("blogger")?.accessToken).toBe("OLD-BLOGGER");
  });

  it("skips the network entirely when no Google client is configured", async () => {
    seed("blogger", expiring("blogger", { refreshToken: "RT-BLOGGER" }));
    await refreshAllExpiringTokens();

    expect(hits).toHaveLength(0);
    expect(readToken("blogger")?.accessToken).toBe("OLD-BLOGGER");
  });
});

describe("refreshAllExpiringTokens — X", () => {
  it("refreshes an OAuth2 token and records the mode", async () => {
    seed(
      "x",
      expiring("x", { refreshToken: "RT-X", extra: { mode: "oauth2" } }),
    );
    process.env.X_CLIENT_ID = "x-client";
    process.env.X_CLIENT_SECRET = "x-secret";
    respond = () =>
      json(200, {
        access_token: "NEW-X",
        refresh_token: "RT-X-2",
        expires_in: 7200,
      });

    await refreshAllExpiringTokens();

    const hit = only("POST", "/2/oauth2/token");
    expect(hit.headers.authorization).toBe(
      `Basic ${Buffer.from("x-client:x-secret").toString("base64")}`,
    );
    expect(new URLSearchParams(hit.body).get("grant_type")).toBe(
      "refresh_token",
    );

    const saved = readToken("x");
    expect(saved?.accessToken).toBe("NEW-X");
    expect(saved?.refreshToken).toBe("RT-X-2");
    expect(saved?.extra?.mode).toBe("oauth2");
  });

  it("omits the Authorization header when no client secret is set (public client)", async () => {
    seed(
      "x",
      expiring("x", { refreshToken: "RT-X", extra: { mode: "oauth2" } }),
    );
    process.env.X_CLIENT_ID = "x-client";
    respond = () => json(200, { access_token: "NEW-X" });

    await refreshAllExpiringTokens();
    expect(
      only("POST", "/2/oauth2/token").headers.authorization,
    ).toBeUndefined();
  });

  it.each(["oauth1", "bearer"])(
    "does not refresh a %s-mode token",
    async (mode) => {
      seed("x", expiring("x", { extra: { mode } }));
      await refreshAllExpiringTokens();

      expect(hits).toHaveLength(0);
      expect(readToken("x")?.accessToken).toBe("OLD-X");
    },
  );

  it("keeps the token when there is no refresh_token to use", async () => {
    seed("x", expiring("x", { extra: { mode: "oauth2" } }));
    process.env.X_CLIENT_ID = "x-client";
    await refreshAllExpiringTokens();

    expect(hits).toHaveLength(0);
    expect(readToken("x")?.accessToken).toBe("OLD-X");
  });
});

describe("refreshAllExpiringTokens — Facebook / Instagram", () => {
  it("re-extends the user token, re-pulls the matching page, and mirrors Instagram", async () => {
    seed(
      "facebook",
      expiring("facebook", {
        userId: "PAGE-1",
        extra: { userToken: "OLD-USER" },
      }),
    );
    respond = (hit) => {
      if (hit.url.includes("/oauth/access_token")) {
        return json(200, { access_token: "NEW-USER", expires_in: 5184000 });
      }
      return json(200, {
        data: [
          { id: "PAGE-9", name: "Some Other Page", access_token: "OTHER-PAGE" },
          {
            id: "PAGE-1",
            name: "Istam Page",
            access_token: "NEW-PAGE",
            instagram_business_account: { id: "IG-1" },
          },
        ],
      });
    };

    await refreshAllExpiringTokens();

    const extend = only("GET", "/v19.0/oauth/access_token");
    expect(extend.url).toContain("grant_type=fb_exchange_token");
    expect(extend.url).toContain("fb_exchange_token=OLD-USER");
    expect(extend.url).toContain("client_id=test-fb-app-id");

    // The page is selected by matching the stored userId — not by taking [0].
    expect(only("GET", "/v19.0/me/accounts").url).toContain(
      "access_token=NEW-USER",
    );

    const fb = readToken("facebook");
    expect(fb?.accessToken).toBe("NEW-PAGE");
    expect(fb?.userId).toBe("PAGE-1");
    expect(fb?.extra?.userToken).toBe("NEW-USER");
    expect(fb?.extra?.instagramUserId).toBe("IG-1");

    const ig = readToken("instagram");
    expect(ig?.accessToken).toBe("NEW-PAGE");
    expect(ig?.userId).toBe("IG-1");
  });

  it("keeps the page token when there is no userToken to re-extend", async () => {
    seed("facebook", expiring("facebook", { userId: "PAGE-1" }));
    await refreshAllExpiringTokens();

    expect(hits).toHaveLength(0);
    expect(readToken("facebook")?.accessToken).toBe("OLD-FACEBOOK");
  });

  it("fails safely when the page list comes back empty", async () => {
    seed(
      "facebook",
      expiring("facebook", {
        userId: "PAGE-1",
        extra: { userToken: "OLD-USER" },
      }),
    );
    respond = (hit) =>
      hit.url.includes("/oauth/access_token")
        ? json(200, { access_token: "NEW-USER" })
        : json(200, { data: [] });

    await refreshAllExpiringTokens();
    expect(readToken("facebook")?.accessToken).toBe("OLD-FACEBOOK");
  });
});

describe("refreshAllExpiringTokens — LinkedIn", () => {
  it("forces a provider refresh when the stored token is expiring", async () => {
    seed(
      "linkedin",
      expiring("linkedin", { refreshToken: "RT-LI", userId: "LI-1" }),
    );
    respond = () =>
      json(200, {
        access_token: "NEW-LI",
        refresh_token: "RT-LI-2",
        expires_in: 5184000,
      });

    await refreshAllExpiringTokens();

    const params = new URLSearchParams(
      only("POST", "/oauth/v2/accessToken").body,
    );
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("RT-LI");

    const saved = readToken("linkedin");
    expect(saved?.accessToken).toBe("NEW-LI");
    expect(saved?.refreshToken).toBe("RT-LI-2");
    expect(saved?.userId).toBe("LI-1");
  });

  it("does not call the provider when the token is still fresh", async () => {
    await refreshAllExpiringTokens();
    expect(hits).toHaveLength(0);
    expect(readToken("linkedin")?.accessToken).toBe("FRESH-LINKEDIN");
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Resilience of the batch entry point
// ════════════════════════════════════════════════════════════════════
describe("refreshAllExpiringTokens — failure isolation", () => {
  it("never rejects, even when every provider fails", async () => {
    for (const platform of PLATFORMS) {
      seed(
        platform,
        expiring(platform, {
          refreshToken: `RT-${platform}`,
          extra: { mode: "oauth2", userToken: "U" },
        }),
      );
    }
    process.env.GOOGLE_CLIENT_ID = "google-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    process.env.X_CLIENT_ID = "x-client";
    respond = () => ({
      status: 500,
      body: "upstream exploded",
      contentType: "text/plain",
    });

    await expect(refreshAllExpiringTokens()).resolves.toBeUndefined();

    // Nothing was overwritten with garbage.
    for (const platform of PLATFORMS) {
      expect(readToken(platform)?.accessToken).toBe(
        `OLD-${platform.toUpperCase()}`,
      );
    }
  });

  it("one platform failing does not stop the others from refreshing", async () => {
    seed("threads", expiring("threads"));
    seed("blogger", expiring("blogger", { refreshToken: "RT-BLOGGER" }));
    process.env.GOOGLE_CLIENT_ID = "google-id";
    process.env.GOOGLE_CLIENT_SECRET = "google-secret";
    respond = (hit) =>
      hit.url.includes("/refresh_access_token")
        ? json(500, { error: { message: "threads is down" } })
        : json(200, { access_token: "NEW-BLOGGER" });

    await refreshAllExpiringTokens();

    expect(readToken("threads")?.accessToken).toBe("OLD-THREADS");
    expect(readToken("blogger")?.accessToken).toBe("NEW-BLOGGER");
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Credential files must stay private
// ════════════════════════════════════════════════════════════════════
describe("tokenStore — file permissions", () => {
  it("creates token files owner-only (0o600)", () => {
    // `mode` is only honoured when the file is *created*, so the file must not
    // exist beforehand. This is why the check lives here and not in a refresh
    // test — a refresh always rewrites an existing file.
    const file = tokenFile("threads");
    if (fs.existsSync(file)) fs.unlinkSync(file);

    saveTokens({
      platform: "threads",
      accessToken: "SECRET",
      obtainedAt: Date.now(),
      expiresIn: 3600,
    });

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
