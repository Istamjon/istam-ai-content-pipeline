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

## Optional: auto-deploy from GitHub Actions

Deploy key alone does **not** auto-deploy. Actions needs **SSH into the VDS**:

1. Create an SSH key pair used only by Actions → VDS login (different from deploy key).
2. Add public half to VDS `~/.ssh/authorized_keys`.
3. Add GitHub **Secrets**:
   - `VDS_HOST` = `95.46.96.179`
   - `VDS_USER` = `root` (or deploy user)
   - `VDS_SSH_KEY` = private key PEM (full text)
4. Then add a `deploy.yml` job that SSHs and runs `git pull && docker compose up -d --build`.

Until that exists, deploy stays **manual on VDS** (recommended while iterating).

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
