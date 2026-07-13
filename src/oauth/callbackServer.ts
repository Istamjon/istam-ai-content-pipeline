/**
 * Unified multi-platform OAuth callback server.
 *
 * Routes:
 *   /auth/linkedin/callback
 *   /auth/facebook/callback
 *   /auth/threads/callback
 *   /auth/x/callback
 *   /auth/blogger/callback
 *   /auth/instagram/callback
 *   GET /  → status dashboard
 *
 * Meta (Threads/Facebook) requires HTTPS redirect URIs.
 * When data/certs/localhost-*.pem exist (or OAUTH_HTTPS=1), the server listens on TLS.
 */
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import { URL } from "url";
import { getProvider, listProviders } from "./registry.js";
import type { OAuthPlatform } from "./types.js";

const PORT = Number(process.env.OAUTH_PORT || 3000);

function resolveTls(): { key: Buffer; cert: Buffer } | null {
  const forceOff = process.env.OAUTH_HTTPS === "0" || process.env.OAUTH_HTTPS === "false";
  if (forceOff) return null;

  const keyPath =
    process.env.OAUTH_TLS_KEY || path.resolve("data/certs/localhost-key.pem");
  const certPath =
    process.env.OAUTH_TLS_CERT || path.resolve("data/certs/localhost-cert.pem");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  if (process.env.OAUTH_HTTPS === "1" || process.env.OAUTH_HTTPS === "true") {
    throw new Error(
      "OAUTH_HTTPS=1 but certs missing. Run: node scripts/gen-localhost-cert.mjs",
    );
  }
  return null;
}

export function startUnifiedOAuthServer(options?: {
  platform?: OAuthPlatform;
  openBrowser?: boolean;
}): http.Server | https.Server {
  const focus = options?.platform;
  const tls = resolveTls();
  const scheme = tls ? "https" : "http";
  const publicBase =
    process.env.OAUTH_PUBLIC_URL?.replace(/\/$/, "") ||
    `${scheme}://localhost:${PORT}`;

  console.log("\n========== Unified OAuth Manager ==========");
  console.log("LangGraph → OAuth Manager → Login → Callback → Access Token");
  console.log(`Listening: ${scheme}://127.0.0.1:${PORT}`);
  if (tls) {
    console.log("TLS: self-signed localhost cert (Meta requires HTTPS)");
    console.log("Browser may warn — click Advanced → Proceed to localhost");
  }
  console.log(`Public base: ${publicBase}`);
  console.log("\nProviders:");
  for (const p of listProviders()) {
    const cfg = p.isConfigured() ? "configured" : "missing-app-creds";
    const ready = p.isReady() ? "READY" : "needs-login";
    console.log(`  • ${p.id.padEnd(10)} ${cfg.padEnd(18)} ${ready}`);
    console.log(`      redirect path: ${p.callbackPath}`);
  }

  if (focus) {
    const p = getProvider(focus);
    if (!p) throw new Error(`Unknown platform: ${focus}`);
    if (!p.isConfigured()) {
      console.error(`\n${p.setupHelp()}`);
      throw new Error(`${focus} app credentials missing`);
    }
    const state = `${focus}_${Date.now()}`;
    const url = p.getAuthorizationUrl(state);
    if (!url) {
      console.error(p.setupHelp());
      throw new Error(`${focus} does not support browser OAuth with current config`);
    }
    console.log(`\n→ Authorize ${p.displayName}:\n${url}\n`);
    console.log(
      `Meta dashboard redirect URI must EXACTLY match:\n  ${publicBase}${p.callbackPath}\n`,
    );
    if (options?.openBrowser !== false) openBrowser(url);
  } else {
    console.log("\nStart login for a platform:");
    console.log("  npm run auth -- linkedin");
    console.log("  npm run auth -- facebook");
    console.log("  npm run auth -- threads");
    console.log("  npm run auth -- x");
    console.log("  npm run auth -- blogger\n");
  }

  const finishOk = (
    res: http.ServerResponse,
    providerId: string,
    displayName: string,
    tokens: { userId?: string; expiresIn?: number },
  ) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      htmlPage(
        `${displayName} OAuth OK`,
        `<p>Access token saqlandi.</p>
         <pre>platform: ${providerId}
userId: ${esc(tokens.userId || "")}
expires_in: ${tokens.expiresIn ?? "n/a"}s</pre>
         <p>Pipeline ni restart qiling: <code>npm start</code></p>`,
      ),
    );
    if (focus) {
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 400);
    }
  };

  const exchangeAndRespond = async (
    res: http.ServerResponse,
    providerId: string,
    code: string,
    state?: string,
  ) => {
    const provider = getProvider(providerId as OAuthPlatform);
    if (!provider) throw new Error(`Unknown platform: ${providerId}`);
    // Meta sometimes appends #_ — strip if pasted into code field
    const clean = code.replace(/#_$/, "").trim();
    console.log(`[oauth:${provider.id}] code received → token exchange...`);
    const tokens = await provider.exchangeCode(clean, state);
    console.log(`[oauth:${provider.id}] SUCCESS userId=${tokens.userId || "n/a"}`);
    finishOk(res, provider.id, provider.displayName, tokens);
  };

  const handler = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => {
    try {
      const reqUrl = new URL(req.url || "/", `${scheme}://127.0.0.1:${PORT}`);
      console.log(`[oauth] ${req.method} ${reqUrl.pathname}${reqUrl.search || ""}`);

      if (reqUrl.pathname === "/" || reqUrl.pathname === "/status") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderStatusPage(focus));
        return;
      }

      // Manual paste page: /auth/paste?platform=threads
      if (reqUrl.pathname === "/auth/paste") {
        if (req.method === "POST") {
          const body = await readBody(req);
          const params = new URLSearchParams(body);
          const platform = params.get("platform") || focus || "threads";
          const raw = (params.get("url_or_code") || "").trim();
          let code = raw;
          let state: string | undefined;
          if (raw.includes("code=") || raw.startsWith("http")) {
            try {
              const u = raw.startsWith("http")
                ? new URL(raw.replace(/#_$/, ""))
                : new URL(raw, "https://localhost");
              code = u.searchParams.get("code") || "";
              state = u.searchParams.get("state") || undefined;
            } catch {
              const m = raw.match(/[?&]code=([^&#]+)/);
              code = m ? decodeURIComponent(m[1]) : raw;
            }
          }
          if (!code) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(
              htmlPage("Missing code", `<p>URL yoki code topilmadi.</p>${pasteForm(platform, raw)}`),
            );
            return;
          }
          await exchangeAndRespond(res, platform, code, state);
          return;
        }
        const platform = reqUrl.searchParams.get("platform") || focus || "threads";
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          htmlPage(
            "Paste OAuth redirect URL",
            `<p>Brauzer address bar dagi to‘liq URL ni yoki <code>code=...</code> ni yopishtiring.</p>${pasteForm(platform)}`,
          ),
        );
        return;
      }

      const provider = listProviders().find((p) => p.callbackPath === reqUrl.pathname);
      if (!provider) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(`Unknown callback path: ${reqUrl.pathname}`);
        return;
      }

      const err = reqUrl.searchParams.get("error");
      if (err) {
        const desc =
          reqUrl.searchParams.get("error_description") ||
          reqUrl.searchParams.get("error_message") ||
          "";
        console.error(`[oauth:${provider.id}]`, err, desc);
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          htmlPage(
            "OAuth error",
            `<b>${esc(err)}</b><p>${esc(desc)}</p><pre>${esc(provider.setupHelp())}</pre>
             <p><a href="/auth/paste?platform=${esc(provider.id)}">Manual paste</a></p>`,
          ),
        );
        return;
      }

      let code = reqUrl.searchParams.get("code");
      // Some clients send code in fragment only — cannot read fragment server-side.
      // Also accept ?code without value issues.
      if (code) code = code.replace(/#_$/, "");
      const state = reqUrl.searchParams.get("state") || undefined;

      if (!code) {
        const qs = Object.fromEntries(reqUrl.searchParams.entries());
        console.warn(`[oauth:${provider.id}] missing code; query=`, qs);
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          htmlPage(
            "Missing code",
            `<p>Callback keldi, lekin <code>code</code> yo‘q.</p>
             <p>Bu odatda: brauzer cert warning dan keyin query string yo‘qolgan, yoki Meta Allow tugmasi to‘liq ishlamagan.</p>
             <pre>path: ${esc(reqUrl.pathname)}
query: ${esc(JSON.stringify(qs, null, 2))}</pre>
             <h3>Yechim</h3>
             <ol>
               <li>Threads Allow dan keyin address bar dagi <b>to‘liq URL</b> ni nusxalang (code=... bo‘lishi kerak).</li>
               <li>Pastdagi formaga yopishtiring.</li>
             </ol>
             ${pasteForm(provider.id)}
             <p>Yoki terminal: <code>npm run auth -- ${esc(provider.id)} --url="PASTE_URL"</code></p>`,
          ),
        );
        return;
      }

      await exchangeAndRespond(res, provider.id, code, state);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[oauth] failed:", msg);
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(htmlPage("Token exchange failed", `<pre>${esc(msg)}</pre>`));
    }
  };

  const server = tls
    ? https.createServer(tls, handler)
    : http.createServer(handler);

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[oauth] Callback server on ${scheme}://127.0.0.1:${PORT}`);
  });

  return server;
}

function renderStatusPage(focus?: OAuthPlatform): string {
  const rows = listProviders()
    .map((p) => {
      const ready = p.isReady() ? "✅ READY" : "⏳ needs login";
      const cfg = p.isConfigured() ? "app ok" : "app missing";
      return `<tr><td>${esc(p.displayName)}</td><td>${esc(p.id)}</td><td>${cfg}</td><td>${ready}</td><td><code>${esc(p.callbackPath)}</code></td></tr>`;
    })
    .join("");
  const paste = focus
    ? `<p><a href="/auth/paste?platform=${esc(focus)}">Paste callback URL (${esc(focus)})</a></p>`
    : `<p><a href="/auth/paste?platform=threads">Paste Threads callback URL</a></p>`;
  return htmlPage(
    "OAuth Manager Status",
    `<table border="1" cellpadding="8" style="border-collapse:collapse">
      <tr><th>Platform</th><th>id</th><th>App</th><th>Tokens</th><th>Callback</th></tr>
      ${rows}
    </table>
    ${paste}
    <p>Telegram uses bot token (not OAuth). Set TELEGRAM_BOT_TOKEN in .env</p>`,
  );
}

function pasteForm(platform: string, value = ""): string {
  return `<form method="POST" action="/auth/paste" style="margin-top:1rem">
    <input type="hidden" name="platform" value="${esc(platform)}" />
    <label>Redirect URL yoki code:<br/>
      <textarea name="url_or_code" rows="4" style="width:100%;font-family:monospace">${esc(value)}</textarea>
    </label><br/><br/>
    <button type="submit">Exchange token</button>
  </form>`;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui;padding:2rem;max-width:52rem">
    <h1>${esc(title)}</h1>${body}
  </body></html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function openBrowser(url: string): void {
  import("child_process")
    .then(({ exec }) => {
      if (process.platform === "win32") exec(`start "" "${url}"`);
      else if (process.platform === "darwin") exec(`open "${url}"`);
      else exec(`xdg-open "${url}"`);
    })
    .catch(() => undefined);
}
