/* eslint-disable no-process-env */

function normalizeImageTempHours(hours: number): 1 | 12 | 24 | 72 {
  if (hours <= 1) return 1;
  if (hours <= 12) return 12;
  if (hours <= 24) return 24;
  return 72;
}

/**
 * AI split (project policy):
 * - TEXT  → Gemini Free (primary) → Pollinations fallback
 * - IMAGE → Nano Banana → Skywork → Pollinations gpt-image-2 → Cloudflare FLUX → AI Horde
 *
 * Gemini: https://aistudio.google.com → API key
 * Skywork: https://skywork.ai → API key (image credits)
 * Pollinations: https://enter.pollinations.ai
 * Cloudflare: Workers AI REST
 */
export const env = {
  /**
   * Text provider: "gemini" | "pollinations" | "auto"
   * auto = Gemini if key set, else Pollinations; on Gemini fail → Pollinations.
   */
  TEXT_PROVIDER: (process.env.TEXT_PROVIDER || "auto").toLowerCase(),
  /** Google AI Studio / Gemini API key (Free Tier) — text + image key #1. */
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  /**
   * Extra Gemini keys for Nano Banana image rotation (429/quota → next key).
   * Also accepts comma list: GEMINI_API_KEYS or NANOBANANA_API_KEYS.
   */
  GEMINI_API_KEY_2: process.env.GEMINI_API_KEY_2 || "",
  GEMINI_API_KEY_3: process.env.GEMINI_API_KEY_3 || "",
  /**
   * Free-friendly default: gemini-flash-lite-latest
   * Alternatives: gemini-2.0-flash-lite, gemini-flash-latest
   */
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
  /** Soft daily Gemini text generateContent calls (UTC). 0 = unlimited soft cap. */
  DAILY_GEMINI_LIMIT: Math.max(
    0,
    parseInt(process.env.DAILY_GEMINI_LIMIT || "80", 10) || 80,
  ),
  /**
   * Nano Banana = Gemini native image models (better on-image text).
   * Free tier quota is low/variable — multi-key rotation + CF/Horde fallback.
   * Models: gemini-2.5-flash-image | gemini-3.1-flash-image | gemini-3.1-flash-lite-image
   */
  NANOBANANA_IMAGE_MODEL:
    process.env.NANOBANANA_IMAGE_MODEL || "gemini-2.5-flash-image",
  /**
   * Soft daily Nano Banana images PER KEY (UTC).
   * Total capacity ≈ this × number of configured keys.
   */
  DAILY_NANOBANANA_LIMIT: Math.max(
    0,
    parseInt(process.env.DAILY_NANOBANANA_LIMIT || "3", 10) || 3,
  ),
  /**
   * Skywork Image API (waterfall #2 after Nano Banana).
   * Multi-key rotation like Nano Banana: KEY → KEY_2… on credits/429.
   * Also accepts comma list: SKYWORK_API_KEYS=k1,k2,k3
   * Keys: https://skywork.ai/?openApiKeySetting=1
   */
  SKYWORK_API_KEY: process.env.SKYWORK_API_KEY || "",
  SKYWORK_API_KEY_2: process.env.SKYWORK_API_KEY_2 || "",
  SKYWORK_API_KEY_3: process.env.SKYWORK_API_KEY_3 || "",
  SKYWORK_API_KEY_4: process.env.SKYWORK_API_KEY_4 || "",
  SKYWORK_API_KEY_5: process.env.SKYWORK_API_KEY_5 || "",
  SKYWORK_GATEWAY_URL: (
    process.env.SKYWORK_GATEWAY_URL ||
    "https://api-tools.skywork.ai/theme-gateway"
  ).replace(/\/$/, ""),
  /**
   * Soft daily Skywork images PER KEY (UTC).
   * Total capacity ≈ this × number of configured keys.
   * 0 = unlimited soft cap per key.
   */
  DAILY_SKYWORK_LIMIT: Math.max(
    0,
    parseInt(process.env.DAILY_SKYWORK_LIMIT || "4", 10) || 4,
  ),
  /** 1K | 2K | 4K — 1K ≈ social 1024, faster & cheaper credits */
  SKYWORK_RESOLUTION: (process.env.SKYWORK_RESOLUTION || "1K").toUpperCase(),
  /** e.g. 1:1 (default social cover). "auto" = omit */
  SKYWORK_ASPECT_RATIO: process.env.SKYWORK_ASPECT_RATIO || "1:1",
  /** Optional source_platform field for Skywork gateway */
  SKYWORK_SOURCE_PLATFORM: process.env.SKYWORK_SOURCE_PLATFORM || "",
  /**
   * When brand face.jpg is present, only use identity-capable image providers
   * (Nano Banana, Skywork, Pollinations with image= URL). Cloudflare/Horde
   * are text-only and invent a random person — skipped when true.
   * Default true. Set REQUIRE_BRAND_FACE=false to allow CF/Horde fallbacks.
   */
  REQUIRE_BRAND_FACE: !["0", "false", "no", "off"].includes(
    (process.env.REQUIRE_BRAND_FACE || "true").toLowerCase().trim(),
  ),
  /** Secret key sk_… from enter.pollinations.ai (text + image). */
  POLLINATIONS_API_KEY: process.env.POLLINATIONS_API_KEY || "",
  /**
   * API host (text chat + /image/{prompt}).
   */
  POLLINATIONS_BASE_URL: (
    process.env.POLLINATIONS_BASE_URL || "https://gen.pollinations.ai"
  ).replace(/\/$/, ""),
  /** Free text model (fallback). */
  POLLINATIONS_TEXT_MODEL: process.env.POLLINATIONS_TEXT_MODEL || "openai-fast",
  /**
   * Pollinations image model after Nano Banana fails.
   * Official name: gpt-image-2 (also: gptimage, flux, … see /image/models).
   */
  POLLINATIONS_IMAGE_MODEL: (() => {
    const raw = (
      process.env.POLLINATIONS_IMAGE_MODEL ||
      process.env.IMAGE_MODEL ||
      "gpt-image-2"
    ).trim();
    // Legacy value when Pollinations images were turned off
    if (!raw || raw === "disabled") return "gpt-image-2";
    return raw;
  })(),
  /**
   * Pollinations model when face.jpg is available (image-to-image / identity).
   * Models that accept `image=` ref: kontext, gptimage, nanobanana, seedream5, …
   * Default: kontext (documented img2img). Override if your key tier differs.
   */
  POLLINATIONS_FACE_MODEL: (
    process.env.POLLINATIONS_FACE_MODEL || "kontext"
  ).trim(),
  /**
   * Soft daily Pollinations image gens (UTC). 0 = unlimited soft cap.
   */
  DAILY_POLLINATIONS_IMAGE_LIMIT: Math.max(
    0,
    parseInt(process.env.DAILY_POLLINATIONS_IMAGE_LIMIT || "8", 10) || 8,
  ),
  /** Image waterfall: nanobanana → skywork → pollinations → cloudflare → horde. */
  IMAGE_PROVIDER: (process.env.IMAGE_PROVIDER || "waterfall") as string,
  /** Cloudflare Account ID #1 (Workers AI REST). */
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || "",
  /** Cloudflare API Token #1 with Workers AI permissions. */
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || "",
  /**
   * Optional extra Cloudflare accounts (each has its own free 10k Neurons/day).
   * Pair ACCOUNT_ID_N + API_TOKEN_N must both be set to enable that slot.
   */
  CLOUDFLARE_ACCOUNT_ID_2: process.env.CLOUDFLARE_ACCOUNT_ID_2 || "",
  CLOUDFLARE_API_TOKEN_2: process.env.CLOUDFLARE_API_TOKEN_2 || "",
  CLOUDFLARE_ACCOUNT_ID_3: process.env.CLOUDFLARE_ACCOUNT_ID_3 || "",
  CLOUDFLARE_API_TOKEN_3: process.env.CLOUDFLARE_API_TOKEN_3 || "",
  /** Workers AI text-to-image model — FLUX.2-dev */
  CLOUDFLARE_IMAGE_MODEL:
    process.env.CLOUDFLARE_IMAGE_MODEL ||
    "@cf/black-forest-labs/flux-2-dev",
  /** Alias for POLLINATIONS_IMAGE_MODEL (legacy env name). */
  IMAGE_MODEL:
    process.env.IMAGE_MODEL ||
    process.env.POLLINATIONS_IMAGE_MODEL ||
    "gpt-image-2",
  /**
   * Image quality profile:
   * - balanced (default): 1024×1024, steps 15 → ~2–3 free images/day per account
   * - premium: 1536×1536, steps 25 → ~0–1 free/day (Workers Paid recommended)
   */
  IMAGE_QUALITY: (process.env.IMAGE_QUALITY || "balanced").toLowerCase(),
  /** Defaults applied from IMAGE_QUALITY if env not set explicitly */
  IMAGE_WIDTH: parseInt(
    process.env.IMAGE_WIDTH ||
      (process.env.IMAGE_QUALITY === "premium" ? "1536" : "1024"),
    10,
  ),
  IMAGE_HEIGHT: parseInt(
    process.env.IMAGE_HEIGHT ||
      (process.env.IMAGE_QUALITY === "premium" ? "1536" : "1024"),
    10,
  ),
  CLOUDFLARE_IMAGE_STEPS: parseInt(
    process.env.CLOUDFLARE_IMAGE_STEPS ||
      (process.env.IMAGE_QUALITY === "premium" ? "25" : "15"),
    10,
  ) || 15,
  /**
   * Soft daily cap **per Cloudflare account** (successful gens).
   * Free Workers AI ≈ 10k Neurons/day/account; balanced 1024@15 ≈ 2–3 images.
   */
  DAILY_IMAGE_LIMIT: Math.max(
    0,
    parseInt(process.env.DAILY_IMAGE_LIMIT || "2", 10) || 2,
  ),
  /**
   * Soft daily cap **across all Cloudflare accounts combined**.
   * Default 6 ≈ 3 posts/day + spare (3 CF accounts × ~2 free images).
   */
  DAILY_IMAGE_TOTAL: Math.max(
    0,
    parseInt(process.env.DAILY_IMAGE_TOTAL || "6", 10) || 6,
  ),
  /** AI Horde (stablehorde) — free community GPU queue */
  AIHORDE_API_KEY: process.env.AIHORDE_API_KEY || "",
  DAILY_HORDE_LIMIT: Math.max(
    0,
    parseInt(process.env.DAILY_HORDE_LIMIT || "4", 10) || 4,
  ),
  /** Soft daily cap for free Pollinations AI app tier (~1.5M req/day). */
  POLLINATIONS_DAILY_REQUEST_LIMIT: parseInt(
    process.env.POLLINATIONS_DAILY_REQUEST_LIMIT || "1500000",
    10,
  ) || 1_500_000,
  /**
   * Temporary public image lifetime on Litterbox (hours): 1 | 12 | 24 | 72.
   * Remote file auto-deletes after this window. Local file is deleted after publish.
   */
  IMAGE_TEMP_HOURS: normalizeImageTempHours(
    parseInt(process.env.IMAGE_TEMP_HOURS || "24", 10) || 24,
  ),
  /** Optional ImgBB fallback if Litterbox is unavailable. */
  IMGBB_API_KEY: process.env.IMGBB_API_KEY || "",
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  TELEGRAM_CHANNEL: process.env.TELEGRAM_CHANNEL || "",
  /**
   * Optional chat for ops alerts (token expiry). Default = TELEGRAM_CHANNEL.
   * Use a private group/chat id if you do not want alerts on the public channel.
   */
  TELEGRAM_ALERT_CHAT: process.env.TELEGRAM_ALERT_CHAT || "",
  /**
   * Inbound Telegram bot: admin can send photo/video + caption → publish all platforms.
   * Default true when TELEGRAM_BOT_TOKEN is set. Set TELEGRAM_BOT_INBOUND=false to disable.
   */
  TELEGRAM_BOT_INBOUND: process.env.TELEGRAM_BOT_INBOUND !== "false",
  /**
   * Comma-separated Telegram user IDs allowed to post via the bot.
   * Get your id: message @userinfobot or /whoami after bot starts.
   * Empty = no one can publish (safe default).
   */
  TELEGRAM_ADMIN_IDS: (process.env.TELEGRAM_ADMIN_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /**
   * Send Telegram warning when OAuth token has this many days (or less) left.
   * Default 1 = "1 kun qolganda".
   */
  TOKEN_ALERT_DAYS: Math.max(
    0,
    parseInt(process.env.TOKEN_ALERT_DAYS || "1", 10) || 1,
  ),
  /** Set TOKEN_ALERT_ENABLED=false to disable expiry Telegram alerts. */
  TOKEN_ALERT_ENABLED: process.env.TOKEN_ALERT_ENABLED !== "false",
  /**
   * Telegra.ph long-form for Telegram (full article link in channel).
   * Token auto-created via API if missing.
   */
  TELEGRAPH_ENABLED: process.env.TELEGRAPH_ENABLED !== "false",
  TELEGRAPH_ACCESS_TOKEN: process.env.TELEGRAPH_ACCESS_TOKEN || "",
  TELEGRAPH_SHORT_NAME: process.env.TELEGRAPH_SHORT_NAME || "IstamAI",
  /** LinkedIn app credentials (OAuth) — from developer.linkedin.com */
  LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID || "",
  LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET || "",
  /** Must match an Authorized Redirect URL in the LinkedIn app settings */
  LINKEDIN_REDIRECT_URI:
    process.env.LINKEDIN_REDIRECT_URI ||
    "http://localhost:3000/auth/linkedin/callback",
  /** User access token (from OAuth) — required to post */
  LINKEDIN_ACCESS_TOKEN: process.env.LINKEDIN_ACCESS_TOKEN || "",
  /** Optional refresh token (long-lived apps / some products) */
  LINKEDIN_REFRESH_TOKEN: process.env.LINKEDIN_REFRESH_TOKEN || "",
  /** Person id only, without urn:li:person: prefix */
  LINKEDIN_USER_ID: process.env.LINKEDIN_USER_ID || "",
  /**
   * Company Page numeric id (from admin URL .../company/<id>/...).
   * Required when LINKEDIN_POST_AS includes organization.
   */
  LINKEDIN_ORGANIZATION_ID: process.env.LINKEDIN_ORGANIZATION_ID || "",
  /**
   * person (default) — personal profile only
   * organization — company page only (needs LINKEDIN_ORGANIZATION_ID)
   * both/auto — person + company when ids are set
   */
  LINKEDIN_POST_AS: (process.env.LINKEDIN_POST_AS || "person").toLowerCase(),
  /**
   * If true, OAuth requests w_organization_social.
   * Only enable after Community Management API is approved on the app
   * (otherwise LinkedIn returns unauthorized_scope_error).
   */
  LINKEDIN_REQUEST_ORG_SCOPE: process.env.LINKEDIN_REQUEST_ORG_SCOPE === "true",
  FACEBOOK_PAGE_TOKEN: process.env.FACEBOOK_PAGE_TOKEN || "",
  FACEBOOK_PAGE_ID: process.env.FACEBOOK_PAGE_ID || "",
  INSTAGRAM_TOKEN: process.env.INSTAGRAM_TOKEN || "",
  INSTAGRAM_USER_ID: process.env.INSTAGRAM_USER_ID || "",
  /** Instagram / Meta app (optional; Graph publish usually uses Facebook Page token). */
  INSTAGRAM_APP_ID: process.env.INSTAGRAM_APP_ID || "",
  INSTAGRAM_APP_SECRET: process.env.INSTAGRAM_APP_SECRET || "",
  /** Optional; tweet write usually requires OAuth 1.0a user tokens below. */
  X_BEARER_TOKEN: process.env.X_BEARER_TOKEN || "",
  X_API_KEY: process.env.X_API_KEY || "",
  X_API_SECRET: process.env.X_API_SECRET || "",
  X_ACCESS_TOKEN: process.env.X_ACCESS_TOKEN || "",
  X_ACCESS_TOKEN_SECRET: process.env.X_ACCESS_TOKEN_SECRET || "",
  THREADS_TOKEN: process.env.THREADS_TOKEN || "",
  THREADS_USER_ID: process.env.THREADS_USER_ID || "",
  /** Meta / Google / X app credentials for unified OAuth Manager */
  FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID || "",
  FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET || "",
  FACEBOOK_REDIRECT_URI:
    process.env.FACEBOOK_REDIRECT_URI || "https://oauth.pstmn.io/v1/callback",
  THREADS_APP_ID: process.env.THREADS_APP_ID || "",
  THREADS_APP_SECRET: process.env.THREADS_APP_SECRET || "",
  THREADS_REDIRECT_URI:
    process.env.THREADS_REDIRECT_URI ||
    "https://localhost:3000/auth/threads/callback",
  X_CLIENT_ID: process.env.X_CLIENT_ID || "",
  X_CLIENT_SECRET: process.env.X_CLIENT_SECRET || "",
  X_REDIRECT_URI: process.env.X_REDIRECT_URI || "http://localhost:3000/auth/x/callback",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  BLOGGER_REDIRECT_URI:
    process.env.BLOGGER_REDIRECT_URI || "http://localhost:3000/auth/blogger/callback",
  /** Target blog URL — id is auto-resolved from public feed / OAuth */
  BLOGGER_URL:
    process.env.BLOGGER_URL || "https://istamjon.blogspot.com/",
  BLOGGER_ACCESS_TOKEN: process.env.BLOGGER_ACCESS_TOKEN || "",
  BLOGGER_REFRESH_TOKEN: process.env.BLOGGER_REFRESH_TOKEN || "",
  /** Optional override; empty = auto (public feed → 6041787032258205448 for istamjon.blogspot.com) */
  BLOGGER_BLOG_ID: process.env.BLOGGER_BLOG_ID || "",
  DB_PATH: process.env.DB_PATH || "./data/app.db",
  /**
   * Fixed daily run times (local server time), e.g. "09:30,19:30".
   * Used only when CRON_RANDOM=false.
   */
  CRON_TIMES: (process.env.CRON_TIMES || "09:30,19:30")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /**
   * If true (default): generate random post times every local calendar day.
   * Each day picks a random slot count in [CRON_SLOTS_MIN, CRON_SLOTS_MAX].
   * CRON_SLOTS_PER_DAY is legacy fixed count (used only when MIN=MAX unset path).
   */
  CRON_RANDOM: process.env.CRON_RANDOM !== "false",
  /**
   * Legacy fixed slots/day. If CRON_SLOTS_MIN/MAX not set, both default from this (or 3–6).
   */
  CRON_SLOTS_PER_DAY: Math.max(
    1,
    Math.min(48, parseInt(process.env.CRON_SLOTS_PER_DAY || "4", 10) || 4),
  ),
  /**
   * Inclusive min random slots per local day (default 3).
   * Each day: uniform random count in [MIN, MAX] for free-tier + engagement balance.
   */
  CRON_SLOTS_MIN: Math.max(
    1,
    Math.min(24, parseInt(process.env.CRON_SLOTS_MIN || "3", 10) || 3),
  ),
  /** Inclusive max random slots per local day (default 6). */
  CRON_SLOTS_MAX: Math.max(
    1,
    Math.min(48, parseInt(process.env.CRON_SLOTS_MAX || "6", 10) || 6),
  ),
  /** Local hour window start for random slots (0–23). */
  CRON_WINDOW_START_HOUR: Math.max(
    0,
    Math.min(23, parseInt(process.env.CRON_WINDOW_START_HOUR || "8", 10) || 8),
  ),
  /** Local hour window end (exclusive-ish; last minute can be end-1). */
  CRON_WINDOW_END_HOUR: Math.max(
    1,
    Math.min(24, parseInt(process.env.CRON_WINDOW_END_HOUR || "21", 10) || 21),
  ),
  /** Minimum minutes between two random slots (default 180m with 4 slots/day). */
  CRON_MIN_GAP_MINUTES: Math.max(
    15,
    parseInt(process.env.CRON_MIN_GAP_MINUTES || "180", 10) || 180,
  ),
  /**
   * Interval mode only when CRON_RANDOM=false and CRON_TIMES empty.
   */
  CRON_INTERVAL_MINUTES: Math.max(
    1,
    parseInt(process.env.CRON_INTERVAL_MINUTES || "720", 10) || 720,
  ),
  /** Run pipeline immediately on process start (false = only scheduled slots) */
  CRON_RUN_ON_START: process.env.CRON_RUN_ON_START === "true",
  DRY_RUN: process.env.DRY_RUN === "true",
  /**
   * Comma-separated platforms to publish to.
   * Default = free stack (no X paid API, no Blogger).
   */
  ENABLED_PLATFORMS: (
    process.env.ENABLED_PLATFORMS ||
    "telegram,linkedin,facebook,instagram,threads"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  /**
   * Max new articles processed per pipeline run.
   * Default 3: if article #1 fails quality/image, try #2 and #3 in the same slot.
   * Graph stops after the first successful publish (no multi-post flood).
   */
  MAX_ARTICLES_PER_RUN: Math.max(
    1,
    parseInt(process.env.MAX_ARTICLES_PER_RUN || "5", 10) || 5,
  ),
  /** Soft daily publish cap per platform (local TZ date). Default 6 matches CRON_SLOTS_MAX. */
  DAILY_LIMIT_TELEGRAM: parseInt(process.env.DAILY_LIMIT_TELEGRAM || "6", 10),
  DAILY_LIMIT_LINKEDIN: parseInt(process.env.DAILY_LIMIT_LINKEDIN || "6", 10),
  /** 0 = unlimited (no soft daily cap for Facebook). */
  DAILY_LIMIT_FACEBOOK: parseInt(process.env.DAILY_LIMIT_FACEBOOK || "6", 10),
  DAILY_LIMIT_INSTAGRAM: parseInt(process.env.DAILY_LIMIT_INSTAGRAM || "6", 10),
  DAILY_LIMIT_X: parseInt(process.env.DAILY_LIMIT_X || "6", 10),
  DAILY_LIMIT_THREADS: parseInt(process.env.DAILY_LIMIT_THREADS || "6", 10),
  DAILY_LIMIT_BLOGGER: parseInt(process.env.DAILY_LIMIT_BLOGGER || "6", 10),
  /** Max posts in a Threads reply chain (root + replies). */
  THREADS_MAX_PARTS: Math.max(
    1,
    Math.min(12, parseInt(process.env.THREADS_MAX_PARTS || "6", 10) || 6),
  ),
};

const dailyLimitByPlatform: Record<string, number> = {
  telegram: env.DAILY_LIMIT_TELEGRAM,
  linkedin: env.DAILY_LIMIT_LINKEDIN,
  facebook: env.DAILY_LIMIT_FACEBOOK,
  instagram: env.DAILY_LIMIT_INSTAGRAM,
  x: env.DAILY_LIMIT_X,
  threads: env.DAILY_LIMIT_THREADS,
  blogger: env.DAILY_LIMIT_BLOGGER,
};

export function getDailyLimit(platform: string): number {
  return dailyLimitByPlatform[platform] ?? 5;
}
