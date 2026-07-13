# Istam Obidov — AI Content Pipeline

LangGraph.js multi-platform publisher for the **Istam Obidov** personal brand (AI Engineering).

The pipeline discovers AI/engineering articles, rewrites them in professional **Uzbek (Latin)** with strict fact grounding, generates a brand-styled image, then publishes to social platforms on a randomized daily schedule.

| Layer | Stack |
|--------|--------|
| Orchestration | [LangGraph.js](https://github.com/langchain-ai/langgraphjs) |
| Text | **Google Gemini Free** → Pollinations fallback |
| Images | **Nano Banana** (Gemini image) → **Cloudflare Workers AI** (3 accounts) → **AI Horde** |
| Storage | SQLite (`better-sqlite3`), canonical JSON, local tokens |
| Runtime | Node.js (ESM), TypeScript |

---

## What it does

1. **Scrapes** primary blog sources (RSS/HTML).
2. **Filters** by brand fit (AI Engineering / agents / automation).
3. **Analyzes** → extracts FACTS only from the source.
4. **Translates** to Uzbek (Latin), technical terms preserved.
5. **Rewrites** in Istam Obidov voice (Teacher + Mentor + Senior AI Engineer).
6. **Quality + fact-check** (hard fail if `FACT_OK` is not yes).
7. **Image** (topic metaphors; no office; no on-image gibberish text when possible).
8. **Canonical content** saved once; platform texts derived from it.
9. **Publishes** only if quality OK **and** image exists.
10. **Scheduler**: 3 random local times per day (new plan each day).

### Graph overview

```
fetchSources → fetchArticle → analyze → translate → rewrite → qualityCheck
       ↑              |                      |            |
       |         next article          fail/retry    fail → skip
       |                                              ↓
       |                                    generateImagePrompt
       |                                              ↓
       |                                      generateImage
       |                                         | no image → skip
       |                                         ↓
       |                                    formatPosts → schedule → publish
       └──────────────────────────────────────────── next article / end
```

Defined in [`src/agent/graph.ts`](./src/agent/graph.ts).

---

## Brand

Source of truth: [`src/config/brand.ts`](./src/config/brand.ts).

| | |
|--|--|
| **Name** | Istam Obidov |
| **Focus** | AI Engineering, AI Agents, LangGraph, LangChain, MCP, automation |
| **Language** | Uzbek (Latin) + English tech terms |
| **Tone** | Professional, practical, no hype |
| **Never publish** | Crypto, rumors, pure ads, off-topic |
| **Color** | `#036158` (teal) |
| **Image presets** | `graph` · `abstract` · `systems` (no office) |

### Content sources (primary)

- [Actualize AI](https://actualize.co/ai-engineering-blog/)
- [The Agentic Engineer](https://www.the-agentic-engineer.com/blog)
- [Skywork AI](https://skywork.ai/blog/)

---

## Platforms

| Platform | Notes |
|----------|--------|
| **Telegram** | Photo + caption (one post); long body → Telegra.ph + teaser |
| **LinkedIn** | Person post (+ optional company if scoped); image upload |
| **Facebook** | Page photo post; needs **never-expiring Page token** |
| **Instagram** | Graph API via Page + IG Business ID; needs **public image URL** |
| **Threads** | Graph API; public image URL when media |
| X / Blogger | Supported in code; optional / often paid or unused |

Default `ENABLED_PLATFORMS`:

```env
ENABLED_PLATFORMS=telegram,linkedin,facebook,instagram,threads
```

---

## Image waterfall

```
Nano Banana (Gemini image)  →  Cloudflare FLUX.2 (cf1→cf2→cf3)  →  AI Horde
```

| Provider | Role |
|----------|------|
| **Nano Banana** | Best text-in-image when Free/Paid quota allows |
| **Cloudflare** | Free neurons ~10k/day **per account** (multi-account rotation) |
| **AI Horde** | Community free GPU fallback (queue/slow) |

Soft caps (env):

- `DAILY_NANOBANANA_LIMIT` (default 3)
- `DAILY_IMAGE_TOTAL` (all CF accounts combined)
- `DAILY_IMAGE_LIMIT` (per CF account)
- `DAILY_HORDE_LIMIT`

**Policy:** no image → **do not publish**.

---

## Text waterfall

```
Gemini Free (gemini-flash-lite-latest)  →  Pollinations (openai-fast)
```

| Env | Purpose |
|-----|---------|
| `GEMINI_API_KEY` | Google AI Studio key |
| `GEMINI_MODEL` | Text model (default `gemini-flash-lite-latest`) |
| `TEXT_PROVIDER` | `auto` \| `gemini` \| `pollinations` |
| `POLLINATIONS_API_KEY` | Fallback text |

Quality rules (high level):

- Facts only from source + analyst FACTS list
- Post ends with **Asosiy faktlar:** (3–5 bullets when FACTS exist)
- `FACT_OK` must be yes or draft is rejected
- After quality retries fail → article skipped (no publish)

---

## Schedule

| Env | Default | Meaning |
|-----|---------|---------|
| `CRON_RANDOM` | `true` | Random times each local day |
| `CRON_SLOTS_PER_DAY` | `3` | Posts per day (social-safe) |
| `CRON_WINDOW_START_HOUR` | `8` | Window start |
| `CRON_WINDOW_END_HOUR` | `21` | Window end |
| `CRON_MIN_GAP_MINUTES` | `180` | Min gap between slots |
| `CRON_RUN_ON_START` | `false` | Immediate run on boot |
| `DRY_RUN` | `false` | If `true`, single pipeline, no real publish |

Daily plan is stored in `data/daily-schedule.json` (same times if process restarts same day).

Platform soft limits: `DAILY_LIMIT_*`. Use `0` for **unlimited** (e.g. Facebook).

---

## Quick start

### Requirements

- Node.js 20+ recommended  
- Windows / macOS / Linux  

### Install

```bash
npm install
# or: yarn install
```

### Configure

```bash
cp .env.example .env
# edit .env with keys and tokens
```

### Build & run

```bash
npm run build
npm start
```

- `DRY_RUN=true` → one pipeline run, prints posts, **no** publish  
- `DRY_RUN=false` → scheduler (random daily slots)

### One-shot live pipeline (manual)

```bash
npm run build
node --input-type=module -e "import 'dotenv/config'; import { createEmptyState } from './dist/agent/state.js'; import { graph, graphInvokeConfig } from './dist/agent/graph.js'; const r = await graph.invoke(createEmptyState(), graphInvokeConfig); console.log(r.publishResults, r.quality, r.errors);"
```

---

## Environment variables (core)

See [`.env.example`](./.env.example) for a fuller list.

### Text

```env
TEXT_PROVIDER=auto
GEMINI_API_KEY=
GEMINI_MODEL=gemini-flash-lite-latest
DAILY_GEMINI_LIMIT=80
POLLINATIONS_API_KEY=
POLLINATIONS_TEXT_MODEL=openai-fast
```

### Images

```env
# Nano Banana (Gemini image)
NANOBANANA_IMAGE_MODEL=gemini-2.5-flash-image
DAILY_NANOBANANA_LIMIT=3

# Cloudflare (up to 3 accounts)
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID_2=
CLOUDFLARE_API_TOKEN_2=
CLOUDFLARE_ACCOUNT_ID_3=
CLOUDFLARE_API_TOKEN_3=
CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-2-dev
DAILY_IMAGE_LIMIT=2
DAILY_IMAGE_TOTAL=9

# AI Horde
AIHORDE_API_KEY=
DAILY_HORDE_LIMIT=8

# Optional force preset: graph | abstract | systems
# IMAGE_PRESET=graph
```

### Platforms

```env
ENABLED_PLATFORMS=telegram,linkedin,facebook,instagram,threads
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHANNEL=
TELEGRAPH_ENABLED=true

# LinkedIn OAuth tokens / app
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_USER_ID=
LINKEDIN_ORGANIZATION_ID=
LINKEDIN_POST_AS=both

# Meta — Facebook Page (use long-lived PAGE token, expires_at=0)
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_PAGE_ID=
FACEBOOK_PAGE_TOKEN=

# Instagram (usually Page token + IG Business user id)
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_USER_ID=
INSTAGRAM_TOKEN=

# Threads
THREADS_APP_ID=
THREADS_APP_SECRET=
THREADS_TOKEN=
THREADS_USER_ID=

# Daily caps (0 = unlimited)
DAILY_LIMIT_TELEGRAM=5
DAILY_LIMIT_LINKEDIN=3
DAILY_LIMIT_FACEBOOK=0
DAILY_LIMIT_INSTAGRAM=2
DAILY_LIMIT_THREADS=3
```

### Scheduler

```env
DRY_RUN=false
CRON_RANDOM=true
CRON_SLOTS_PER_DAY=3
CRON_WINDOW_START_HOUR=8
CRON_WINDOW_END_HOUR=21
CRON_MIN_GAP_MINUTES=180
CRON_RUN_ON_START=false
MAX_ARTICLES_PER_RUN=1
```

---

## OAuth & tokens

Tokens live under `data/tokens/*.json` (gitignored if configured).

```bash
npm run auth -- status          # list platforms
npm run auth -- linkedin
npm run auth -- facebook
npm run auth -- threads
npm run auth:facebook           # helper script
npm run tokens:status
npm run tokens:refresh
npm run test:meta               # Meta smoke post
npm run linkedin:doctor
npm run cf:resolve              # resolve CF account IDs from tokens
```

### Facebook long-lived **Page** token (recommended)

1. Graph API Explorer → short **USER** token (with `pages_manage_posts`, `pages_show_list`, …).
2. Exchange:

```text
GET https://graph.facebook.com/v19.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id=APP_ID
  &client_secret=APP_SECRET
  &fb_exchange_token=SHORT_USER_TOKEN
```

3. Get Page tokens:

```text
GET /me/accounts?fields=id,name,access_token&access_token=LONG_USER_TOKEN
```

4. Save the **PAGE** `access_token` as `FACEBOOK_PAGE_TOKEN`.  
   When derived from a long-lived user token, Page tokens often have **`expires_at = 0` (never)**.

Debug:

```text
GET /debug_token?input_token=PAGE_TOKEN&access_token=APP_ID|APP_SECRET
```

Expect: `type: PAGE`, `is_valid: true`, `expires_at: 0`.

---

## Project structure

```text
src/
  agent/           # LangGraph nodes, prompts, state
  canonical/       # Single source of truth for post body + derived formats
  config/          # brand, env, image presets
  lib/             # Gemini, images, scrape, telegraph, schedule
  oauth/           # Auth providers, token store, refresh
  platforms/       # telegram, linkedin, facebook, instagram, threads, x, blogger
  scheduler.ts     # Random / fixed / interval modes
  index.ts         # Entry: DRY_RUN or scheduler
  db.ts            # SQLite usage, daily counts, image budgets
scripts/           # smoke tests, auth helpers, CF resolve
data/
  app.db           # SQLite
  tokens/          # OAuth tokens
  canonical/       # Saved canonical posts
  daily-schedule.json
  images/          # Temporary local images (deleted after publish)
```

---

## NPM scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript → `dist/` |
| `npm start` | Run pipeline scheduler / DRY_RUN |
| `npm run auth -- <platform>` | OAuth for linkedin / facebook / threads / x / blogger |
| `npm run cf:resolve` | List/resolve Cloudflare accounts |
| `npm run tokens:status` | Token status |
| `npm run tokens:refresh` | Refresh expiring tokens |
| `npm run test:meta` | Meta API test post |
| `npm run canonical:list` | List canonical docs |

Smoke helpers:

```bash
node scripts/smoke-image-waterfall.mjs
node scripts/smoke-all-image-providers.mjs
node scripts/reset-image-soft-budget.mjs   # clear soft image counters (UTC day)
```

---

## Quality & safety policies

| Rule | Behavior |
|------|----------|
| Brand reject | Off-topic / crypto / rumor articles skipped early |
| Fact ground | Claims must map to source / FACTS |
| Quality fail | Up to 2 rewrite attempts, then skip article |
| No image | Skip publish entirely |
| Soft style | Not enough to pass if facts fail |
| Telegram layout | **One** `sendPhoto` with caption (image + text together) |
| Telegra.ph | Hero image first, then paragraphs |

---

## Operational notes

1. **Cloudflare free neurons** reset **00:00 UTC** per account (~2–3 FLUX images/account at 1024@15).  
2. **Nano Banana Free** image quota is often very low (`429` → CF fallback).  
3. **Instagram / Threads** need a **public HTTPS** image (Litterbox temp host). If Litterbox is 500, IG may fail while Telegram photo still works.  
4. **LinkedIn company** posts may return 403 without Community Management API approval; person posts usually work.  
5. Keep secrets out of git; rotate tokens if leaked in chat logs.

---

## Development

```bash
npm run build
npm run lint
npm test
```

LangGraph Studio (optional):

```bash
npm run dev
# npx @langchain/langgraph-cli dev
```

Graph recursion limit is set high (`recursionLimit: 150`) for multi-article + quality retries.

---

## License

MIT — see [LICENSE](./LICENSE).

Originally based on the LangGraph.js project template; heavily customized for multi-platform AI Engineering content publishing.
