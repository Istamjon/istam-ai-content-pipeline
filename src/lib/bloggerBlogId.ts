/**
 * Resolve Blogger blog id without requiring manual BLOGGER_BLOG_ID.
 *
 * Order:
 * 1) env / stored token
 * 2) public Atom/JSON feed on BLOGGER_URL (no OAuth) — blog-XXXXXXXX
 * 3) Blogger API byurl (needs access token)
 * 4) Blogger API users/self/blogs match by URL
 *
 * Default brand blog: https://istamjon.blogspot.com/ → 6041787032258205448
 */

import { loadTokens, saveTokens } from "../oauth/tokenStore.js";

export const DEFAULT_BLOGGER_URL = "https://istamjon.blogspot.com/";
/** Public feed id for DEFAULT_BLOGGER_URL (verified 2026-07-17). */
export const DEFAULT_BLOGGER_BLOG_ID = "6041787032258205448";

export type BlogResolveResult = {
  blogId: string;
  source: "env" | "token" | "public_feed" | "api_byurl" | "api_list" | "default";
  url?: string;
  name?: string;
};

function preferBlogUrl(): string {
  return (
    process.env.BLOGGER_URL ||
    DEFAULT_BLOGGER_URL
  )
    .trim()
    .replace(/\/+$/, "");
}

function normalizeBlogUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function extractBlogIdFromText(text: string): string | null {
  // tag:blogger.com,1999:blog-6041787032258205448
  const m1 = text.match(/blog-(\d{10,})/i);
  if (m1) return m1[1];
  const m2 = text.match(/["']blogId["']\s*:\s*["']?(\d{10,})/i);
  if (m2) return m2[1];
  const m3 = text.match(/blogID[=:\\x3d]+(\d{10,})/i);
  if (m3) return m3[1];
  return null;
}

/**
 * Public discovery — works without Google OAuth (Blogger JSON feed).
 */
export async function resolveBlogIdFromPublicFeed(
  blogUrl = preferBlogUrl(),
): Promise<{ blogId: string; url: string } | null> {
  const base = blogUrl.replace(/\/+$/, "");
  const candidates = [
    `${base}/feeds/posts/default?alt=json&max-results=0`,
    `${base}/feeds/posts/default?alt=json`,
    base.endsWith(".blogspot.com") || base.includes("blogspot.")
      ? `${base}/`
      : `${base}/`,
  ];

  for (const feedUrl of candidates) {
    try {
      const res = await fetch(feedUrl, {
        headers: {
          "User-Agent": "istam-ai-content-pipeline/1.0",
          Accept: "application/json, application/atom+xml, text/html, */*",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      const id = extractBlogIdFromText(text);
      if (id) {
        return { blogId: id, url: base };
      }
    } catch {
      // try next
    }
  }
  return null;
}

async function resolveViaByUrl(
  accessToken: string,
  blogUrl: string,
): Promise<{ blogId: string; name?: string; url?: string } | null> {
  const url =
    `https://www.googleapis.com/blogger/v3/blogs/byurl` +
    `?url=${encodeURIComponent(blogUrl.endsWith("/") ? blogUrl : blogUrl + "/")}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { id?: string; name?: string; url?: string };
    if (j.id) return { blogId: j.id, name: j.name, url: j.url };
  } catch {
    /* ignore */
  }
  return null;
}

async function resolveViaBlogList(
  accessToken: string,
  preferUrl: string,
): Promise<{ blogId: string; name?: string; url?: string } | null> {
  try {
    const res = await fetch(
      "https://www.googleapis.com/blogger/v3/users/self/blogs",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) return null;
    const blogs = (await res.json()) as {
      items?: Array<{ id: string; name: string; url?: string }>;
    };
    const items = blogs.items || [];
    if (!items.length) return null;
    const want = normalizeBlogUrl(preferUrl);
    const matched =
      items.find((b) => normalizeBlogUrl(b.url || "").includes(want)) ||
      items.find((b) =>
        want.includes(normalizeBlogUrl(b.url || "").replace(/\/$/, "")),
      ) ||
      items[0];
    return {
      blogId: matched.id,
      name: matched.name,
      url: matched.url,
    };
  } catch {
    return null;
  }
}

/**
 * Full resolve + optional cache into data/tokens/blogger.json + process.env.
 */
export async function resolveBloggerBlogId(options?: {
  accessToken?: string;
  forceRefresh?: boolean;
  persist?: boolean;
}): Promise<BlogResolveResult | null> {
  const preferUrl = preferBlogUrl();
  const persist = options?.persist !== false;

  if (!options?.forceRefresh) {
    const envId = (process.env.BLOGGER_BLOG_ID || "").trim();
    if (envId) {
      return { blogId: envId, source: "env", url: preferUrl };
    }
    const t = loadTokens("blogger");
    if (t?.userId && /^\d{8,}$/.test(t.userId)) {
      return { blogId: t.userId, source: "token", url: preferUrl };
    }
  }

  // Public feed (no OAuth)
  const pub = await resolveBlogIdFromPublicFeed(preferUrl);
  if (pub) {
    if (persist) cacheBlogId(pub.blogId, options?.accessToken);
    return {
      blogId: pub.blogId,
      source: "public_feed",
      url: pub.url,
    };
  }

  const token =
    options?.accessToken ||
    loadTokens("blogger")?.accessToken ||
    process.env.BLOGGER_ACCESS_TOKEN ||
    "";

  if (token) {
    const byUrl = await resolveViaByUrl(token, preferUrl);
    if (byUrl) {
      if (persist) cacheBlogId(byUrl.blogId, token);
      return {
        blogId: byUrl.blogId,
        source: "api_byurl",
        url: byUrl.url || preferUrl,
        name: byUrl.name,
      };
    }
    const listed = await resolveViaBlogList(token, preferUrl);
    if (listed) {
      if (persist) cacheBlogId(listed.blogId, token);
      return {
        blogId: listed.blogId,
        source: "api_list",
        url: listed.url || preferUrl,
        name: listed.name,
      };
    }
  }

  // Brand default when URL is the known blog
  if (
    normalizeBlogUrl(preferUrl).includes("istamjon.blogspot.com")
  ) {
    if (persist) cacheBlogId(DEFAULT_BLOGGER_BLOG_ID, token || undefined);
    return {
      blogId: DEFAULT_BLOGGER_BLOG_ID,
      source: "default",
      url: DEFAULT_BLOGGER_URL,
      name: "AI Engineering Hub",
    };
  }

  return null;
}

function cacheBlogId(blogId: string, accessToken?: string): void {
  process.env.BLOGGER_BLOG_ID = blogId;
  try {
    const existing = loadTokens("blogger");
    if (existing?.accessToken || accessToken) {
      saveTokens({
        platform: "blogger",
        accessToken: existing?.accessToken || accessToken || "",
        refreshToken: existing?.refreshToken,
        userId: blogId,
        obtainedAt: existing?.obtainedAt || Date.now(),
        expiresIn: existing?.expiresIn,
        scopes: existing?.scopes,
      });
    }
  } catch {
    // token file may be missing before first OAuth
  }
}

/** Sync helper used when async resolve already done or only env needed. */
export function getKnownBloggerBlogId(): string {
  return (
    (process.env.BLOGGER_BLOG_ID || "").trim() ||
    loadTokens("blogger")?.userId ||
    (normalizeBlogUrl(preferBlogUrl()).includes("istamjon.blogspot.com")
      ? DEFAULT_BLOGGER_BLOG_ID
      : "")
  );
}
