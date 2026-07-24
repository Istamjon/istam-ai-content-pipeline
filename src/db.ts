import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { Platform } from "./agent/state.js";
import { env } from "./config/env.js";

const dbPath = path.resolve(env.DB_PATH);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS seen_articles (
    url TEXT PRIMARY KEY,
    title TEXT,
    source TEXT,
    first_seen TEXT DEFAULT (datetime('now')),
    content_hash TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    article_url TEXT,
    platform TEXT,
    content TEXT,
    image_path TEXT,
    status TEXT DEFAULT 'pending',
    scheduled_at TEXT,
    published_at TEXT,
    error TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_counts (
    platform TEXT,
    date TEXT,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (platform, date)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,
    platform TEXT,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    fetched_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (post_id) REFERENCES posts(id)
  )
`);

/** Daily Pollinations TEXT AI request counter (images use Cloudflare, not counted here). */
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_daily_usage (
    date TEXT PRIMARY KEY,
    request_count INTEGER DEFAULT 0
  )
`);

/** Successful image generations per UTC day (legacy total). */
db.exec(`
  CREATE TABLE IF NOT EXISTS image_daily_usage (
    date TEXT PRIMARY KEY,
    image_count INTEGER DEFAULT 0
  )
`);

/** Per-provider successful images per UTC day. */
db.exec(`
  CREATE TABLE IF NOT EXISTS image_provider_usage (
    date TEXT NOT NULL,
    provider TEXT NOT NULL,
    image_count INTEGER DEFAULT 0,
    PRIMARY KEY (date, provider)
  )
`);

export function isArticleSeen(url: string): boolean {
  const row = db.prepare("SELECT url FROM seen_articles WHERE url = ?").get(url) as
    | { url: string }
    | undefined;
  return !!row;
}

export function markArticleSeen(
  url: string,
  title: string,
  source: string,
  contentHash: string,
): void {
  db.prepare(
    "INSERT OR IGNORE INTO seen_articles (url, title, source, content_hash) VALUES (?, ?, ?, ?)",
  ).run(url, title, source, contentHash);
}

/**
 * Re-open articles that were permanently skipped only because of transient
 * fetch failures (old bug). Does not touch brand-reject / pipeline / quality.
 * @returns number of rows deleted
 */
export function releaseTransientFetchSkips(): number {
  const result = db
    .prepare(
      `DELETE FROM seen_articles
       WHERE source = 'skipped'
         AND content_hash = 'fetch-error'`,
    )
    .run();
  return Number(result.changes ?? 0);
}

export function insertPost(
  articleUrl: string,
  platform: Platform,
  content: string,
  imagePath?: string,
  status = "pending",
): number {
  const result = db
    .prepare(
      "INSERT INTO posts (article_url, platform, content, image_path, status) VALUES (?, ?, ?, ?, ?)",
    )
    .run(articleUrl, platform, content, imagePath ?? null, status);
  return Number(result.lastInsertRowid);
}

export function updatePostStatus(id: number, status: string, error?: string): void {
  const now = status === "published" ? new Date().toISOString() : null;
  db.prepare("UPDATE posts SET status = ?, published_at = ?, error = ? WHERE id = ?").run(
    status,
    now,
    error ?? null,
    id,
  );
}

/** Local calendar day for publish caps (matches CRON schedule TZ). */
function publishDayKey(): string {
  // Inline to avoid circular import with dailySchedule → env → db in some paths
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function incrementDailyCount(platform: Platform): number {
  const today = publishDayKey();
  const row = db
    .prepare("SELECT count FROM daily_counts WHERE platform = ? AND date = ?")
    .get(platform, today) as { count: number } | undefined;
  const newCount = (row?.count ?? 0) + 1;
  db.prepare(
    "INSERT INTO daily_counts (platform, date, count) VALUES (?, ?, ?) ON CONFLICT(platform, date) DO UPDATE SET count = excluded.count",
  ).run(platform, today, newCount);
  return newCount;
}

export function getDailyCount(platform: Platform): number {
  const today = publishDayKey();
  const row = db
    .prepare("SELECT count FROM daily_counts WHERE platform = ? AND date = ?")
    .get(platform, today) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function getDailyLimit(platform: Platform): number {
  const limits: Record<Platform, number> = {
    telegram: env.DAILY_LIMIT_TELEGRAM,
    linkedin: env.DAILY_LIMIT_LINKEDIN,
    facebook: env.DAILY_LIMIT_FACEBOOK,
    instagram: env.DAILY_LIMIT_INSTAGRAM,
    x: env.DAILY_LIMIT_X,
    threads: env.DAILY_LIMIT_THREADS,
    blogger: env.DAILY_LIMIT_BLOGGER,
  };
  return limits[platform] ?? 5;
}

export function insertAnalytics(postId: number, platform: Platform): void {
  db.prepare("INSERT INTO analytics (post_id, platform) VALUES (?, ?)").run(postId, platform);
}

export function getAiDailyUsage(): number {
  const today = publishDayKey();
  const row = db
    .prepare("SELECT request_count FROM ai_daily_usage WHERE date = ?")
    .get(today) as { request_count: number } | undefined;
  return row?.request_count ?? 0;
}

/** Increment AI request counter; returns new count for today. */
export function incrementAiDailyUsage(by = 1): number {
  const today = publishDayKey();
  const row = db
    .prepare("SELECT request_count FROM ai_daily_usage WHERE date = ?")
    .get(today) as { request_count: number } | undefined;
  const next = (row?.request_count ?? 0) + by;
  db.prepare(
    `INSERT INTO ai_daily_usage (date, request_count) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET request_count = excluded.request_count`,
  ).run(today, next);
  return next;
}

/** UTC calendar day YYYY-MM-DD (Cloudflare neuron reset is 00:00 UTC). */
export function utcToday(): string {
  return new Date().toISOString().split("T")[0];
}

export function getImageDailyUsage(): number {
  const today = utcToday();
  const row = db
    .prepare("SELECT image_count FROM image_daily_usage WHERE date = ?")
    .get(today) as { image_count: number } | undefined;
  return row?.image_count ?? 0;
}

export function incrementImageDailyUsage(by = 1): number {
  const today = utcToday();
  const row = db
    .prepare("SELECT image_count FROM image_daily_usage WHERE date = ?")
    .get(today) as { image_count: number } | undefined;
  const next = (row?.image_count ?? 0) + by;
  db.prepare(
    `INSERT INTO image_daily_usage (date, image_count) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET image_count = excluded.image_count`,
  ).run(today, next);
  return next;
}

export function getImageBudget(limit: number): {
  used: number;
  limit: number;
  remaining: number;
} {
  const used = getImageDailyUsage();
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
  };
}

/**
 * Per-provider daily counters (image_provider_usage table).
 * - Image: cloudflare*, horde, nanobanana* → also bump legacy image_daily_usage
 * - Text: gemini → provider row only (must NOT inflate image totals)
 * Dynamic keys allowed (e.g. nanobanana4, nanobanana_ab12cd)
 */
export type ImageProviderName = string;

/** Providers that consume the shared image daily budget. */
export function isImageGenerationProvider(provider: string): boolean {
  return (
    provider === "horde" ||
    provider === "pollinations" ||
    provider === "skywork" ||
    provider.startsWith("skywork") ||
    provider.startsWith("cloudflare") ||
    provider.startsWith("nanobanana")
  );
}

export function getProviderImageUsage(provider: ImageProviderName): number {
  const today = utcToday();
  const row = db
    .prepare(
      "SELECT image_count FROM image_provider_usage WHERE date = ? AND provider = ?",
    )
    .get(today, provider) as { image_count: number } | undefined;
  return row?.image_count ?? 0;
}

export function incrementProviderImageUsage(
  provider: ImageProviderName,
  by = 1,
): number {
  const today = utcToday();
  const prev = getProviderImageUsage(provider);
  const next = prev + by;
  db.prepare(
    `INSERT INTO image_provider_usage (date, provider, image_count) VALUES (?, ?, ?)
     ON CONFLICT(date, provider) DO UPDATE SET image_count = excluded.image_count`,
  ).run(today, provider, next);
  // Only real image gens update the legacy image total (not gemini text, etc.)
  if (isImageGenerationProvider(provider)) {
    incrementImageDailyUsage(by);
  }
  return next;
}

export function getProviderImageBudget(
  provider: ImageProviderName,
  limit: number,
): { used: number; limit: number; remaining: number } {
  const used = getProviderImageUsage(provider);
  return { used, limit, remaining: Math.max(0, limit - used) };
}

export interface AnalyticsRow {
  platform: string;
  total_posts: number;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

export function getAnalytics(): AnalyticsRow[] {
  return db
    .prepare(
      `
    SELECT p.platform, COUNT(*) as total_posts, SUM(a.likes) as likes, SUM(a.comments) as comments, SUM(a.shares) as shares
    FROM posts p
    LEFT JOIN analytics a ON p.id = a.post_id
    GROUP BY p.platform
  `,
    )
    .all() as AnalyticsRow[];
}

export function closeDb(): void {
  db.close();
}
