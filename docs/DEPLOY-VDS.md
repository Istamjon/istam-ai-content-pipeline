# Deploy to VDS (95.46.96.179)

## What is the deploy key?

Repo deploy key title: **VDS-95.46.96.179-Deploy**

| Item | Role |
|------|------|
| **Public key** | GitHub → Repo → Settings → Deploy keys |
| **Private key** | Only on the VDS (`~/.ssh/…`) |
| **Purpose** | VDS runs `git pull` / `git clone` from this private repo |

**Not for:**

- GitHub Actions CI (Actions uses built-in `GITHUB_TOKEN` — no deploy key needed)
- Chat / password login
- Storing API secrets (use `.env` on the server only)

Write access is enabled on the key — only needed if the server pushes back. Prefer **read-only** unless you really need push.

---

## One-time setup on VDS

```bash
# 1) SSH as your deploy user
ssh root@95.46.96.179   # or your user

# 2) Private key already created on VDS — ensure permissions
chmod 600 ~/.ssh/id_ed25519_github   # actual filename may differ
# Optional SSH config:
# Host github.com
#   HostName github.com
#   User git
#   IdentityFile ~/.ssh/id_ed25519_github
#   IdentitiesOnly yes

# 3) Test GitHub access via deploy key
ssh -T git@github.com
# → Hi Istamjon/istam-ai-content-pipeline! You've successfully authenticated...

# 4) Clone (first time)
cd /opt   # or /var/www
git clone git@github.com:Istamjon/istam-ai-content-pipeline.git
cd istam-ai-content-pipeline

# 5) Env + data (never commit these)
cp .env.example .env
nano .env
mkdir -p data/tokens
# copy token JSON files from your PC if needed:
# scp data/tokens/*.json root@95.46.96.179:/opt/istam-ai-content-pipeline/data/tokens/

# 6) Run with Docker
docker compose up -d --build
docker compose logs -f
```

### Common “post yubormadi” causes (check logs)

```bash
docker compose logs --tail=200
```

| Symptom in logs | Cause | Fix |
|-----------------|-------|-----|
| `Temporary image upload failed` / Litterbox 500 | Instagram/Threads need a public image URL; Litterbox often fails from VDS IPs | Redeploy latest (multi-host: Litterbox → Catbox → 0x0 → ImgBB). Optional: set `IMGBB_API_KEY` |
| `Session has expired` (Facebook/Instagram) | Meta page token expired | On a machine with browser: `npm run auth:facebook`, copy `data/tokens/*.json` to VDS |
| `fetchArticle … fetch-error` / empty batch | Site blocked scraper; old code permanently skipped URLs | Latest build retries; browser UA + no permanent skip on network errors |
| `Waiting for scheduled slots` and no posts | `CRON_RUN_ON_START=false` and next slot later | Compose default is now `true`; or set in `.env` |
| `EACCES` / `DB insert failed` / cannot write images | `./data` owned by root, container user 10001 | Latest image entrypoint chowns data; or `chown -R 10001:10001 data` |
| `DRY_RUN=true` | Preview mode, nothing posted | Set `DRY_RUN=false` in `.env` |

After fix, force one run:

```bash
# in .env: CRON_RUN_ON_START=true  DRY_RUN=false
docker compose up -d --build --force-recreate
docker compose logs -f --tail=100
```

---

## Update after each push to `main`

CI must be green first (GitHub Actions). Then on VDS:

```bash
cd /opt/istam-ai-content-pipeline
git pull origin main
docker compose up -d --build
docker compose logs -f --tail=100
```

Optional one-liner script `scripts/vds-update.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
git pull origin main
docker compose up -d --build
docker compose ps
```

---

## Auto-deploy from GitHub Actions

Workflow: `.github/workflows/deploy.yml`  
Runs after **CI succeeds** on `main` (or manual **Actions → Deploy VDS → Run workflow**).

### Two different keys (do not mix them)

| Key | Where private key lives | Purpose |
|-----|-------------------------|---------|
| **GitHub deploy key** (`VDS-95.46.96.179-Deploy`) | On the **VDS** | Server runs `git pull` from GitHub |
| **VDS login key** (new) | GitHub Secret `VDS_SSH_KEY` | Actions SSHs **into** the VDS |

### One-time setup

**A) On VDS — create login key for Actions (or reuse an existing user key):**

```bash
# On VDS as root (or on your PC, then copy public key to VDS)
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/gha_vds_deploy -N ""

# Allow Actions to log in as root:
cat ~/.ssh/gha_vds_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Show PRIVATE key — add this to GitHub Secrets as VDS_SSH_KEY (never commit it)
cat ~/.ssh/gha_vds_deploy
```

If you generated the key on your PC instead:

```bash
# Local machine
ssh-keygen -t ed25519 -C "github-actions-deploy" -f gha_vds_deploy -N ""
ssh-copy-id -i gha_vds_deploy.pub root@95.46.96.179
# Then paste contents of gha_vds_deploy into GitHub secret VDS_SSH_KEY
```

**B) GitHub → repo → Settings → Secrets and variables → Actions → New repository secret:**

| Secret | Example value |
|--------|----------------|
| `VDS_HOST` | `95.46.96.179` |
| `VDS_USER` | `root` |
| `VDS_SSH_KEY` | full private key (`-----BEGIN ... PRIVATE KEY-----` …) |
| `VDS_PORT` | `22` (optional) |
| `VDS_PATH` | `/root/istam-ai-content-pipeline` (optional; default `~/istam-ai-content-pipeline`) |

**C) On VDS — ensure git + docker work non-interactively:**

```bash
cd ~/istam-ai-content-pipeline
# deploy key for github.com already set
ssh -T git@github.com
git remote -v   # should be git@github.com:Istamjon/istam-ai-content-pipeline.git
docker compose ps
```

If `origin` is HTTPS, switch to SSH so deploy key is used:

```bash
git remote set-url origin git@github.com:Istamjon/istam-ai-content-pipeline.git
```

### Verify

1. Push any small change to `main` (or wait for next push).
2. **Actions** tab: **CI** green → **Deploy VDS** runs.
3. Or: Actions → **Deploy VDS** → **Run workflow**.

Do **not** paste private keys into chat — only into GitHub Secrets.

---

## CI vs CD summary

```
Developer → git push main
     ↓
GitHub Actions CI  (build, test, docker build)  ← no secrets required
     ↓ (green)
You / script on VDS
     ↓
git pull (deploy key) + docker compose up
     ↓
Pipeline running with local .env + data/tokens
```
