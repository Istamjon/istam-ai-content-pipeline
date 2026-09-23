# Istam Obidov — AI Content Pipeline

LangGraph.js multi-platform publisher for the **Istam Obidov** personal brand (AI Engineering).

The pipeline discovers AI/engineering articles, rewrites them in professional **Uzbek (Latin)** with strict fact grounding, generates a brand-styled image, then publishes to social platforms on a randomized daily schedule.

| Layer | Stack |
|--------|--------|
| Orchestration | [LangGraph.js](https://github.com/langchain-ai/langgraphjs) |
| Text | **Google Gemini Free** (multi-key rotation) |
| Images | **UnoRouter** → **Nano Banana** → **Skywork** → **xKiro** (diagram) |
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
10. **Scheduler**: 3–6 random local times per day (new plan each day).

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
| **Image presets** | `workflow` · `infrastructure` · `engineering` · `agents` · `dataflow` (premium social cover diagrams) |

### Content sources

**AI engineering (primary)**

- [Chase AI Blog](https://www.chaseai.io/blog) — **first priority**
- [Actualize AI](https://actualize.co/ai-engineering-blog/)
- [The Agentic Engineer](https://www.the-agentic-engineer.com/blog)
- [Skywork AI](https://skywork.ai/blog/)
- [EasyInsights Blog](https://easyinsights.ai/blog/)
- [KeyValue Systems Blog](https://www.keyvalue.systems/blog/)
- [AI Agent Store News](https://aiagentstore.ai/news)
- [LangChain Blog](https://blog.langchain.dev/)
- [Anthropic Engineering](https://www.anthropic.com/engineering)
- [LlamaIndex Blog](https://www.llamaindex.ai/blog)
- [Hugging Face Blog](https://huggingface.co/blog)

**Community / fullstack**

- [Towards Data Science — Agentic AI](https://towardsdatascience.com/category/artificial-intelligence/agentic-ai/)
- [Plain English — Fullstack](https://plainenglish.io/topics/fullstack)

**UX/UI + product frontend**

- [web.dev Blog](https://web.dev/blog/)
- [Nielsen Norman Group](https://www.nngroup.com/articles/)
- [Josh W Comeau](https://www.joshwcomeau.com/)
- [Vercel Blog](https://vercel.com/blog)
- [Chrome Developers Blog](https://developer.chrome.com/blog)
- [Smashing Magazine](https://www.smashingmagazine.com/articles/)

---

## Platforms

| Platform | Notes |
|----------|--------|
| **Telegram** | Photo + caption, then continuation message(s) — the full article stays inside Telegram |
| **LinkedIn** | Person post (+ optional company if scoped); image upload |
| **Facebook** | Page photo/video post; needs **never-expiring Page token** |
| **Instagram** | Graph API via Page + IG Business ID; image or Reels (public URL) |
| **Threads** | Graph API; public image/video URL when media |
| X / Blogger | Supported in code; optional / often paid or unused |

### Manual post via Telegram bot

Bot the same `TELEGRAM_BOT_TOKEN` long-polls private messages from admins:

1. Set `TELEGRAM_ADMIN_IDS` (your numeric Telegram user id — DM bot `/whoami`).
2. Start the process (`npm start` / Docker). Bot runs next to the scheduler.
3. Send a **photo or video with caption** (caption = post text).
4. Confirm **✅ Barcha platformalarga joylash** — publishes to every `ENABLED_PLATFORMS` entry.
5. Bot replies with per-platform ✅ / ❌ / skip.

| Media | Behaviour |
|-------|-----------|
| Photo + text | All platforms (Instagram requires media) |
| Video + text | Telegram, Facebook, Instagram Reels, Threads; **LinkedIn skip**; X text-only |
| Text only | All except Instagram (skipped) |

Commands: `/help` · `/whoami` · `/platforms` · `/cancel`  
Disable inbound: `TELEGRAM_BOT_INBOUND=false`.

Default `ENABLED_PLATFORMS`:

```env
ENABLED_PLATFORMS=telegram,linkedin,facebook,instagram,threads
```

---

## Image waterfall

```
1) UnoRouter (gpt-image-2:free)  →  2) Nano Banana (Gemini)
   →  3) Skywork  →  4) xKiro (workflow diagram, NO face)
```

| Provider | Role | `face.jpg` identity |
|----------|------|---------------------|
| **UnoRouter** | Primary — `gpt-image-2:free` via `/images/edits` (multipart) | Yes |
| **Nano Banana** | Gemini image models, `inlineData` multimodal | Yes |
| **Skywork** | Credits / daily benefit after Nano fails (`source_images`) | Yes |
| **xKiro** | Absolute last resort — topic-aware workflow diagram | **No** |

Providers **1–3 are identity-capable**: they receive the real photo bytes and are
the only ones that can reproduce the brand face. xKiro never gets the photo.

**Diagram covers (xKiro / humanless fallback) are flat and matte, not
glassmorphism.** The earlier style asked for frosted translucent panels, a deep
gradient and *"soft blurred teal light behind the glass"* while separately
banning excessive glow — a contradiction the model resolved by over-serving the
positive instructions, which is where the over-rendered look came from. Every
positive line is now something a print designer would actually do, and every
effect is a **named negative**:

| Block | What it enforces |
|-------|------------------|
| `[STYLE]` | Solid panels a few percent lighter than the backdrop, 12–16px radius, one hairline border, near-black `#0A0A0A`, at most one very soft teal `#036158` corner wash |
| `[FORBIDDEN EFFECTS]` | No glow, bloom, neon, lens flare, light streaks, bokeh, particles, sparkles, swirls, 3D perspective, bevel, emboss, stacked drop shadows, reflections, gradient mesh, motion blur, cyberpunk styling |
| `[TYPOGRAPHY — MANDATORY]` | Horizontal upright labels, ≤5 node labels of 1–2 words and ≤~14 chars, title largest. If a label cannot be set legibly, **omit that node** rather than shrink it into gibberish |
| `[ACCURACY — MANDATORY]` | The node sequence is authoritative — never invent, merge, drop or duplicate a node; every arrow follows real data flow; no legend, key or caption block |

**The prompt is assembled in priority order and never sliced.** Both diagram
builders used to end with `(...).trim().slice(0, 2500)`. The rules grew past the
budget, so the cut landed inside `[ACCURACY — MANDATORY]` and the model received
a rule that stopped mid-word — while the prompt still reported success and the
cover still rendered. `assembleDiagramPrompt()` now treats each block as atomic:
it fits whole or is dropped whole, assembly stops at the first block that does
not fit, and the budget is 2800 with **every load-bearing block ordered to
finish before ~2500** (where Nano Banana truncates). Only the thumbnail
self-check sits in the tail. See
[`src/config/imagePrompt.ts`](./src/config/imagePrompt.ts).

### Brand face (`data/brand/face.jpg`)

Identity-preserving covers need the real photo bytes on a multimodal provider.
The photo is **not** in git (`.gitignore`) — on the VDS it lives at
`data/brand/face.jpg`, and CI ships it from the `BRAND_FACE_B64` secret.

| Situation | Result |
|-----------|--------|
| File missing / wrong path / `BRAND_FACE_IMAGE` | Providers 1–3 fall back to a text-only prompt (generic person, no likeness) |
| `REQUIRE_BRAND_FACE=true` (default), face present | Providers 1–3 may **only** return a face-preserving result. A failed edit **throws and cascades to the next identity provider** — it never degrades into a faceless image from the same model |
| Verification rejects the result | The cover is **not** the brand person → the image is discarded and the pipeline cascades to the next provider (see below) |
| All identity providers fail/exhausted | **xKiro** produces a humanless workflow diagram; the post is still published |
| `REQUIRE_BRAND_FACE=false` | Providers 1–3 may fall back to text-only generation |
| File very large (e.g. >400KB / multi-MB) | Prefer ~512–1024px JPEG; `sharp` auto-downscales for APIs |

#### Face verification (`src/lib/faceVerify.ts`)

The pipeline never *detects* faces — `face.jpg` is sent as a byte-for-byte
reference. To catch the case where a provider ignores it, every identity result
is checked by a **Gemini vision pass**: reference photo + generated cover in one
request, and the model must answer whether the same individual appears.

| Env | Default | Purpose |
|-----|---------|---------|
| `FACE_VERIFY` | `true` | Enable the vision check (only runs when `REQUIRE_BRAND_FACE=true` and face.jpg exists) |
| `GEMINI_VISION_MODEL` | `gemini-2.5-flash` | Any multimodal Gemini model works |
| `DAILY_FACEVERIFY_LIMIT` | `40` | Soft cap **per Gemini key** (UTC), in its own bucket so it never eats the text quota |
| `FACE_VERIFY_MIN_CONFIDENCE` | `0.6` | Below this the image is rejected |
| `BRAND_IDENTITY_DESCRIPTION` | built-in Uzbek description | The appearance wording injected into every identity prompt — **update it if your real appearance changes** |

**Failure policy:** if verification *runs* and says "different person", the image
is rejected. If verification *cannot run* (no key, quota, network), the image is
accepted **with a warning** — the pass is a safety net on top of the primary
mechanism, and blocking all publishing when the free Gemini quota runs out would
turn a quality guard into an outage.

xKiro covers are intentionally **not** verified: they are diagrams by design.

Soft caps (env):

- `UNOROUTER_EDIT_MODELS` — extra models that accept `/images/edits` (face-capable). Built-ins: `gpt-image-2:free`, `gpt-image-2`
- `DAILY_NANOBANANA_LIMIT` (default 3 **per key**; multi-key rotation)
- `SKYWORK_API_KEY` / `_2`…`_5` (or `SKYWORK_API_KEYS`) + `DAILY_SKYWORK_LIMIT` **per key** (default 4; credit fail → next key)
- `DAILY_XKIRO_LIMIT` (default 25 **per key**)
- Daily loop: soft budgets reset each **UTC day**; key order = day-offset round-robin + highest remaining first (not always key #1)
- `REQUIRE_BRAND_FACE` (default `true` when you want identity-only)

**Policy:** only when **all four** providers fail → **do not publish**.

---

## Text waterfall

```
Gemini Free (gemini-flash-lite-latest) — multi-key rotation, per-key daily budget
```

| Env | Purpose |
|-----|---------|
| `GEMINI_API_KEY` | Google AI Studio key (text + image nb1) |
| `GEMINI_API_KEY_2` / `_3` | Extra keys — Nano Banana image rotation + Gemini text rotation on quota/429 |
| `GEMINI_MODEL` | Text model (default `gemini-flash-lite-latest`) |
| `DAILY_GEMINI_LIMIT` | Soft cap **per key** (UTC); total ≈ limit × keys |

Quality rules (high level):

- Facts only from source + analyst FACTS list
- Post ends with **Asosiy faktlar:** (3–5 bullets when FACTS exist)
- `FACT_OK` must be yes or draft is rejected
- After quality retries fail → article skipped (no publish)

---

## Brand voice & audience

Single source of truth: [`src/config/voiceRules.ts`](./src/config/voiceRules.ts).
It exists because the brand *declared* rules that nothing enforced — the voice
spec lived in prose inside the prompts, and the quality gate hardcoded a
two-item list while `brand.neverPublish` declared four. A rule nothing reads is
not a rule, so the rules now live in one module and both the prompt and the gate
import from it.

### Never-publish enforcement

Every entry in `brand.neverPublish` has a matching check in
`NEVER_PUBLISH_CHECKS`, and `voiceRules.test.ts` asserts the two sets are equal —
so adding a declared rule without an enforcement cannot pass CI. Each check
carries a `label` that `isHardIssue()` classifies; a label that stops matching
would silently downgrade a hard rule to a soft one, so every label is asserted
against the predicate.

The advertising rule deliberately needs **two** independent signals (promotional
wording *and* a price or an ad-only CTA), so a single word like *chegirma* in a
technical post cannot block a publish. All four checks are also run against the
real body of a live post and required to stay silent.

### Dual-audience contract

The brand has two audiences reading the same post: beginners/juniors/students/IT
entrepreneurs (primary, and the larger group) and middle+/AI engineers/founders
(secondary). "Keep it simple" and "give me the real detail" are therefore not a
trade-off the writer may pick between, so the writer prompt carries an explicit
contract requiring **both**, in layers:

- **Layer 1** — what this is and why it matters, in ≤2 plain sentences.
- **Layer 2** — the actual mechanism, the specific constraint, the number, the
  failure mode, and when *not* to reach for this.

It also forbids explaining what the reader can look up (translate the
*consequence* instead), requires every claim a senior would challenge to come
from the source, and takes its interest from the source's own tension rather than
manufactured drama. The audience tiers are interpolated from
`brand.targetAudience`, and the same rule sentences are used verbatim in both the
role prompt and the rewrite prompt — a paraphrase would just be a second copy
that drifts.

### Paragraph rhythm

`normalizeParagraphs()` splits over-long prose at sentence boundaries as a
**deterministic repair**, not a gate. An earlier length *gate* (a 3500-char
"Too long") once broke the pipeline, so the fix is a repair that can only
improve the draft: URLs and abbreviations are masked first, and the block is
returned untouched unless the re-joined text is provably identical to the
original.

### `voiceLint` is a diagnostic, not a gate

[`src/lib/voiceLint.ts`](./src/lib/voiceLint.ts) reports voice issues and metrics
for a *finished* post. It is surfaced in the ops preview
(`scripts/tg-rich-preview.mjs`), **not** wired into the publish path — a lint that
blocks publishing would be the same outage-shaped mistake as the length gate
above. It measures prose only, so a bullet list is never reported as an
over-long paragraph, and its `longestParagraph` metric skips exactly the
structural blocks the repair refuses to touch.

---

## Schedule

| Env | Default | Meaning |
|-----|---------|---------|
| `CRON_RANDOM` | `true` | Random times each local day |
| `CRON_SLOTS_MIN` / `CRON_SLOTS_MAX` | `3` / `6` | Random posts per day (picked each local day) |
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

## Docker (production)

Long-running **cron pipeline** in a container. OAuth remains on the host (`npm run auth`).

### Requirements

- Docker + Docker Compose  
- Host `.env` (from `.env.example`)  
- Host `./data` volume (SQLite, `data/tokens/*`, schedule, canonical)

### Build & run

```bash
# first time: tokens already on host after local OAuth
docker compose up -d --build
docker compose logs -f
```

### Useful commands

```bash
docker compose ps
docker compose restart
docker compose down
# one-shot dry run inside container:
docker compose run --rm -e DRY_RUN=true pipeline
```

### What is mounted

| Host | Container | Purpose |
|------|-----------|---------|
| `./data` | `/app/data` | DB, tokens, images, canonical, schedule |
| `.env` | (env_file) | Secrets — **not** baked into the image |

Timezone defaults to `Asia/Tashkent` (`TZ` in compose). Override with `TZ=...` in `.env` if needed.

---

## Environment variables (core)

See [`.env.example`](./.env.example) for a fuller list.

### Text

```env
GEMINI_API_KEY=
GEMINI_API_KEY_2=
GEMINI_API_KEY_3=
GEMINI_MODEL=gemini-flash-lite-latest
DAILY_GEMINI_LIMIT=80
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

# Optional force preset: workflow | infrastructure | engineering
# IMAGE_PRESET=workflow
```

### Platforms

```env
ENABLED_PLATFORMS=telegram,linkedin,facebook,instagram,threads
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHANNEL=
# Manual publish via Telegram bot (photo/video + caption → all platforms)
TELEGRAM_BOT_INBOUND=true
TELEGRAM_ADMIN_IDS=123456789

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
CRON_SLOTS_MIN=3
CRON_SLOTS_MAX=6
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
  lib/             # Gemini, images, scrape, image hosting, schedule
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
| `npm test` | Unit tests |
| `npm run test:int` | Integration tests (OAuth token refresh, mock HTTP socket) |
| `npm run test:all` | Unit + integration + `langgraph.json` check |
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
| Quality fail | Up to 3 rewrite passes (first draft + 2 retries), then skip article |
| No image | Skip publish entirely |
| Soft style | Not enough to pass if facts fail |
| Telegram layout | `sendPhoto`/`sendVideo` + caption, then continuation message(s) — full article stays in Telegram |

---

## Operational notes

1. **Cloudflare free neurons** reset **00:00 UTC** per account (~2–3 FLUX images/account at 1024@15).  
2. **Nano Banana Free** image quota is often very low (`429` → CF fallback).  
3. **Instagram / Threads** need a **public HTTPS** image (Litterbox temp host). If Litterbox is 500, IG may fail while Telegram photo still works.  
4. **LinkedIn company** posts may return 403 without Community Management API approval; person posts usually work.  
5. Keep secrets out of git; rotate tokens if leaked in chat logs.

---

## CI

GitHub Actions (`.github/workflows/ci.yml`) on every push/PR to `main`.

**Job `build-and-test`**

1. `npm ci` → `npm run build` (TypeScript)
2. `npm run lint:langgraph-json` — every path in `langgraph.json` resolves and exports its object
3. `npm test` — unit suite
4. `npm run test:int` — integration suite, including the OAuth token-refresh path against a real local HTTP socket. A stale access token is the most expensive silent failure in this pipeline, so this step is never skipped
5. Smoke — image prompt builder (brand colour, person, heading, logo, preset, composition)
6. Smoke — brand-fit + sources (accepts an AI-engineering article, rejects a gaming one)
7. `npm run lint` — **report only** (`continue-on-error`)

**Job `docker`** (needs `build-and-test`)

8. Docker image build, no push

Local equivalent:

```bash
npm run ci   # build + langgraph check + unit tests + integration tests
```

The two smoke checks and the Docker build are CI-only — run them by hand after
touching `imagePrompt.ts` or `brandFit.ts`.

ESLint is report-only because the codebase violates several of its own rules —
measured at 170 problems (134 errors) across 39 files, dominated by
`no-process-env` (84), then `no-instanceof` (32) and `no-non-null-assertion`
(27). Note that fixing only the `process.env` usage would **not** make the gate
pass: ~50 errors from the other rules would remain. Flip it to blocking once the
count reaches zero, otherwise the gate stays decorative.

### Deploy

`.github/workflows/deploy.yml` runs on `workflow_run` after **CI succeeds on a
push to `main`** (guarded on `conclusion == 'success'`), pulls the commit on the
VDS, rebuilds the container and restarts it. There is no manual step. See
[`docs/DEPLOY-VDS.md`](./docs/DEPLOY-VDS.md).

`vds-health.yml` is the read-only probe used to confirm a deploy actually landed
— it prints the box's `local=<sha>` next to `origin=<sha>`, the container status,
the live image-provider ledger and the day's schedule. **Confirm the deployed
commit with that probe rather than assuming the workflow meant it.**

---

## Development

```bash
npm run build
npm run lint
npm test        # unit
npm run test:int  # integration (OAuth token refresh)
```

The integration suite in `src/oauth/tokenRefresh.int.test.ts` starts an ephemeral
HTTP server on `127.0.0.1:0` and re-points the global `fetch` at it, so it runs
fully offline. It snapshots and restores `data/tokens/*` and `.env`, so it is
safe to run on a machine holding real credentials.

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
