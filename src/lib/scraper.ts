import * as cheerio from "cheerio";
import { Article } from "../agent/state.js";

export interface SourceConfig {
  url: string;
  name: string;
  /** primary = AI-eng core blogs; secondary = stricter brand-fit */
  tier?: "primary" | "secondary";
  rssPaths?: string[];
  sitemapPath?: string;
  articleSelector?: string;
  titleSelector?: string;
  contentSelector?: string;
  linkSelector?: string;
  /**
   * Keep only URLs whose pathname matches at least one pattern
   * (string substring or RegExp). Applied after discovery.
   */
  pathInclude?: Array<string | RegExp>;
  /** Drop URLs matching any of these pathname patterns. */
  pathExclude?: Array<string | RegExp>;
}

const defaultRssPaths = ["/feed", "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/index.xml"];
const defaultArticleSelector = "article, .post, .entry, .blog-post, [itemprop='blogPost']";
const defaultTitleSelector = "h1, h2, .title, [itemprop='headline']";
const defaultContentSelector =
  ".content, .entry-content, .post-content, article, [itemprop='articleBody']";
const defaultLinkSelector = "a[href]";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchHtml(url: string, timeoutMs = 12_000): Promise<string> {
  let lastError: Error | null = null;
  // One retry helps flaky VDS egress / brief 403/429/5xx
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
      const response = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        // Retry only on rate-limit / server errors
        if (
          attempt === 0 &&
          (response.status === 403 ||
            response.status === 429 ||
            response.status >= 500)
        ) {
          lastError = new Error(`Failed to fetch ${url}: ${response.status}`);
          continue;
        }
        throw new Error(`Failed to fetch ${url}: ${response.status}`);
      }
      return response.text();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt === 0 && /timeout|abort|network|ECONN|ENOTFOUND/i.test(lastError.message)) {
        continue;
      }
      throw lastError;
    }
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

function resolveUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

function parseRss(xml: string, baseUrl: string): Article[] {
  const $ = cheerio.load(xml, { xml: true });
  const articles: Article[] = [];

  $("item").each((_, el) => {
    const title = $(el).find("title").first().text().trim();
    // RSS link can be text content or empty with href in some feeds
    let link = $(el).find("link").first().text().trim();
    if (!link) {
      link = $(el).find("link").first().attr("href")?.trim() || "";
    }
    if (!link) {
      link = $(el).find("guid").first().text().trim();
    }
    const description = $(el).find("description").first().text().trim();
    const content =
      $(el).find("content\\:encoded, encoded").first().text().trim() || description;

    if (title && link) {
      articles.push({
        url: resolveUrl(link, baseUrl),
        title,
        rawText: content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      });
    }
  });

  return articles;
}

function parseAtom(xml: string, baseUrl: string): Article[] {
  const $ = cheerio.load(xml, { xml: true });
  const articles: Article[] = [];

  $("entry").each((_, el) => {
    const title = $(el).find("title").first().text().trim();
    const linkEl = $(el).find("link[rel='alternate'], link").first();
    const link = linkEl.attr("href")?.trim() || linkEl.text().trim() || "";
    const content =
      $(el).find("content").first().text().trim() ||
      $(el).find("summary").first().text().trim();

    if (title && link) {
      articles.push({
        url: resolveUrl(link, baseUrl),
        title,
        rawText: content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      });
    }
  });

  return articles;
}

function parseFeed(xml: string, baseUrl: string): Article[] {
  if (xml.includes("<feed") || xml.includes("<entry")) {
    const atom = parseAtom(xml, baseUrl);
    if (atom.length > 0) return atom;
  }
  if (xml.includes("<rss") || xml.includes("<channel") || xml.includes("<item")) {
    return parseRss(xml, baseUrl);
  }
  // Try both
  const rss = parseRss(xml, baseUrl);
  if (rss.length > 0) return rss;
  return parseAtom(xml, baseUrl);
}

function parseSitemap(xml: string): string[] {
  const $ = cheerio.load(xml, { xml: true });
  const urls: string[] = [];

  $("url > loc").each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) urls.push(loc);
  });

  $("sitemap > loc").each((_, el) => {
    const loc = $(el).text().trim();
    if (loc) urls.push(loc);
  });

  return urls;
}

function pathMatches(
  pathname: string,
  patterns?: Array<string | RegExp>,
): boolean {
  if (!patterns || patterns.length === 0) return true;
  return patterns.some((p) =>
    typeof p === "string" ? pathname.includes(p) : p.test(pathname),
  );
}

function filterByPathConfig(
  articles: Article[],
  config: SourceConfig,
): Article[] {
  if (!config.pathInclude?.length && !config.pathExclude?.length) {
    return articles;
  }
  return articles.filter((a) => {
    try {
      const path = new URL(a.url).pathname;
      if (config.pathExclude?.length && pathMatches(path, config.pathExclude)) {
        return false;
      }
      if (config.pathInclude?.length && !pathMatches(path, config.pathInclude)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Next.js listing pages embed articles in __NEXT_DATA__ (e.g. aiagentstore.ai).
 * Shape: props.pageProps.articles[] with title, content, slug, tagSlug.
 */
function parseNextDataArticles(
  html: string,
  baseUrl: string,
): Article[] {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!m?.[1]) return [];
  try {
    const data = JSON.parse(m[1]) as {
      props?: {
        pageProps?: {
          articles?: Array<{
            title?: string;
            content?: string;
            slug?: string;
            tagSlug?: string;
            url?: string;
            path?: string;
          }>;
        };
      };
    };
    const list = data?.props?.pageProps?.articles;
    if (!Array.isArray(list) || list.length === 0) return [];

    const origin = new URL(baseUrl).origin;
    const out: Article[] = [];
    const seen = new Set<string>();

    for (const item of list) {
      const title = (item.title || "").trim();
      if (!title) continue;
      let url = "";
      if (item.url && /^https?:\/\//i.test(item.url)) {
        url = item.url;
      } else if (item.path) {
        url = resolveUrl(item.path, baseUrl);
      } else if (item.slug) {
        const tag = (item.tagSlug || "guides-and-tutorials").replace(
          /^\/+|\/+$/g,
          "",
        );
        const slug = item.slug.replace(/^\/+|\/+$/g, "");
        url = `${origin}/${tag}/${slug}`;
      } else {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({
        url,
        title,
        rawText: (item.content || "").trim(),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function parseHtml(config: SourceConfig, html: string): Article[] {
  // Prefer structured Next.js payload when present (avoids nav/promo noise)
  const nextArticles = parseNextDataArticles(html, config.url);
  if (nextArticles.length > 0) {
    return filterByPathConfig(nextArticles, config);
  }

  const $ = cheerio.load(html);
  const articles: Article[] = [];
  const articleSelector = config.articleSelector || defaultArticleSelector;
  const seen = new Set<string>();

  $(articleSelector).each((_, el) => {
    const titleEl = $(el).find(config.titleSelector || defaultTitleSelector).first();
    const contentEl = $(el).find(config.contentSelector || defaultContentSelector).first();
    const linkEl = $(el).find(config.linkSelector || defaultLinkSelector).first();

    const title = titleEl.text().trim() || $(el).find("a").first().text().trim();
    const content = contentEl.text().trim() || $(el).text().trim();
    const href = linkEl.attr("href")?.trim() || "";

    if (title && (content || href)) {
      const url = href ? resolveUrl(href, config.url) : config.url;
      if (seen.has(url)) return;
      seen.add(url);
      articles.push({
        url,
        title,
        rawText: content,
      });
    }
  });

  // Fallback: collect post-like links from the listing page
  if (articles.length === 0) {
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href")?.trim() || "";
      const title = $(el).text().trim();
      if (!href || title.length < 12 || title.length > 200) return;
      const url = resolveUrl(href, config.url);
      // Prefer same-origin article-like paths
      if (!url.startsWith("http")) return;
      try {
        const base = new URL(config.url);
        const target = new URL(url);
        if (target.hostname !== base.hostname) return;
        if (seen.has(url)) return;
        // Skip pure nav/home links
        if (target.pathname === "/" || target.pathname === base.pathname) return;
        seen.add(url);
        articles.push({ url, title, rawText: "" });
      } catch {
        // ignore invalid URLs
      }
    });
  }

  return filterByPathConfig(articles, config);
}

async function discoverOneSource(config: SourceConfig): Promise<Article[]> {
  const baseUrl = config.url.replace(/\/$/, "");
  let articles: Article[] = [];
  const rssPaths = config.rssPaths ?? defaultRssPaths;

  // Try feed candidates in parallel (first success wins content)
  const feedUrls = rssPaths.map((p) =>
    p.startsWith("http") ? p : `${baseUrl}${p}`,
  );
  const feedAttempts = await Promise.allSettled(
    feedUrls.map(async (rssUrl) => {
      const xml = await fetchHtml(rssUrl, 6_000);
      if (
        xml.includes("<rss") ||
        xml.includes("<feed") ||
        xml.includes("<channel") ||
        xml.includes("<item") ||
        xml.includes("<entry")
      ) {
        const parsed = parseFeed(xml, baseUrl);
        if (parsed.length > 0) return parsed;
      }
      throw new Error("empty feed");
    }),
  );
  for (const r of feedAttempts) {
    if (r.status === "fulfilled" && r.value.length > 0) {
      articles = r.value;
      break;
    }
  }

  if (articles.length === 0 && config.sitemapPath) {
    try {
      const sitemapUrl = config.sitemapPath.startsWith("http")
        ? config.sitemapPath
        : `${baseUrl}${config.sitemapPath}`;
      const xml = await fetchHtml(sitemapUrl, 6_000);
      const urls = parseSitemap(xml).slice(0, 8);
      for (const url of urls) {
        try {
          const html = await fetchHtml(url, 6_000);
          articles.push(...parseHtml({ ...config, url }, html));
        } catch {
          continue;
        }
      }
    } catch {
      // sitemap failed
    }
  }

  if (articles.length === 0) {
    const html = await fetchHtml(config.url, 8_000);
    articles = parseHtml(config, html);
  }

  console.log(`[scraper] ${config.name || config.url}: ${articles.length} items`);
  return articles;
}

export async function discoverSources(configs: SourceConfig[]): Promise<Article[]> {
  const allArticles: Article[] = [];
  const globalSeen = new Set<string>();

  // Sources in parallel — avoids multi-minute sequential hangs
  const results = await Promise.allSettled(configs.map((c) => discoverOneSource(c)));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      console.error(`Failed to discover sources from ${configs[i].url}:`, r.reason);
      continue;
    }
    for (const a of r.value) {
      if (!globalSeen.has(a.url)) {
        globalSeen.add(a.url);
        allArticles.push(a);
      }
    }
  }

  return allArticles;
}

export async function fetchArticleContent(
  url: string,
): Promise<{ title: string; rawText: string }> {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  let title = $("h1, h2, .title, [itemprop='headline']").first().text().trim();
  // Fixed: previously discarded the page <title> result
  if (!title) {
    title = $("title").first().text().trim();
  }

  let rawText = $(
    ".content, .entry-content, .post-content, article, [itemprop='articleBody'], .prose, main",
  )
    .first()
    .text()
    .trim();

  if (!rawText || rawText.length < 100) {
    rawText = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);
  }

  return {
    title: title || "No Title",
    rawText,
  };
}
