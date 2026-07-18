/**
 * Telegra.ph API — long-form pages for Telegram posts (with optional hero image).
 * @see https://telegra.ph/api
 */
import fs from "fs";
import path from "path";
import { brand, buildBrandFooter } from "../config/brand.js";
import { env } from "../config/env.js";
import { ensurePublicImageUrl } from "./imageHost.js";
import {
  stripFooterAndTags,
  stripMarkdownNoise,
  stripSourceIntros,
} from "./contentClean.js";

const API = "https://api.telegra.ph";
const tokenFile = path.resolve(process.cwd(), "data/tokens/telegraph.json");

type TelegraphAccount = {
  access_token: string;
  short_name?: string;
  author_name?: string;
  auth_url?: string;
};

type TelegraphPage = {
  path: string;
  url: string;
  title: string;
};

type NodeElement = {
  tag: string;
  children?: Array<string | NodeElement>;
  attrs?: Record<string, string>;
};

function loadStoredToken(): string {
  if (env.TELEGRAPH_ACCESS_TOKEN) return env.TELEGRAPH_ACCESS_TOKEN;
  try {
    if (fs.existsSync(tokenFile)) {
      const j = JSON.parse(fs.readFileSync(tokenFile, "utf8")) as {
        access_token?: string;
      };
      if (j.access_token) return j.access_token;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function saveToken(account: TelegraphAccount): void {
  const dir = path.dirname(tokenFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tokenFile, JSON.stringify(account, null, 2), "utf8");
  process.env.TELEGRAPH_ACCESS_TOKEN = account.access_token;
  const envPath = path.resolve(process.cwd(), ".env");
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `TELEGRAPH_ACCESS_TOKEN=${account.access_token}`;
  if (/^TELEGRAPH_ACCESS_TOKEN=/m.test(content)) {
    content = content.replace(/^TELEGRAPH_ACCESS_TOKEN=.*$/m, line);
  } else {
    content = content.trimEnd() + `\n${line}\n`;
  }
  fs.writeFileSync(envPath, content, "utf8");
}

async function ensureAccessToken(): Promise<string> {
  let token = loadStoredToken();
  if (token) return token;

  const shortName = (env.TELEGRAPH_SHORT_NAME || "IstamAI").slice(0, 32);
  const authorName = brand.name;
  const authorUrl = brand.socialLinks.telegram || brand.socialLinks.linkedin;

  const url =
    `${API}/createAccount` +
    `?short_name=${encodeURIComponent(shortName)}` +
    `&author_name=${encodeURIComponent(authorName)}` +
    `&author_url=${encodeURIComponent(authorUrl)}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const json = (await res.json()) as {
    ok?: boolean;
    result?: TelegraphAccount;
    error?: string;
  };
  if (!json.ok || !json.result?.access_token) {
    throw new Error(json.error || "Telegraph createAccount failed");
  }
  saveToken(json.result);
  console.log("[telegraph] Account created, token saved");
  return json.result.access_token;
}

/** Convert plain text to Telegraph Node list (paragraphs + optional hero image). */
export function textToTelegraphNodes(
  text: string,
  imageUrl?: string,
): NodeElement[] {
  let plain = stripFooterAndTags(text);
  plain = stripSourceIntros(plain);
  plain = stripMarkdownNoise(plain);

  const nodes: NodeElement[] = [];

  // Layout: hero image FIRST, then article body paragraphs
  if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
    nodes.push({
      tag: "figure",
      children: [{ tag: "img", attrs: { src: imageUrl } }],
    });
  }

  const blocks = plain
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  for (const block of blocks) {
    // Skip leftover footer / social lines
    if (/^Author:/i.test(block)) continue;
    if (/^AI Engineering\s*\|/i.test(block)) continue;
    if (/^LinkedIn:|^Telegram:|^YouTube:|^Threads:|^Instagram:|^X:/i.test(block))
      continue;
    if (/^https?:\/\/(www\.)?(linkedin|t\.me|threads|instagram|x\.com|youtube)/i.test(block))
      continue;

    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith("#") && /^#[\w\u0400-\u04FF]+(\s+#[\w\u0400-\u04FF]+)*$/.test(line)) {
        continue;
      }
      nodes.push({ tag: "p", children: [line] });
    }
  }

  if (nodes.length === 0 || (nodes.length === 1 && nodes[0].tag === "figure")) {
    nodes.push({
      tag: "p",
      children: [plain.slice(0, 800) || "AI Engineering — Istam Obidov"],
    });
  }

  // Clean footer block on the page (plain text links)
  const foot = buildBrandFooter("linkedin");
  for (const line of foot.split("\n").filter(Boolean)) {
    nodes.push({ tag: "p", children: [line] });
  }

  return nodes.slice(0, 100);
}

function cleanTitle(raw: string, fallback: string): string {
  let t = stripSourceIntros(raw)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Avoid using long first paragraph as title
  if (t.length > 80) {
    const cut = t.slice(0, 80);
    const sp = cut.lastIndexOf(" ");
    t = (sp > 40 ? cut.slice(0, sp) : cut).trim();
  }
  if (t.length < 8) t = fallback.slice(0, 80);
  // Ban "Yangi X maqolasi" style titles
  t = stripSourceIntros(t);
  return t.slice(0, 256) || brand.name;
}

export async function createTelegraphPage(options: {
  title: string;
  content: string;
  imagePath?: string;
  authorName?: string;
  authorUrl?: string;
}): Promise<{ url: string; path: string }> {
  const accessToken = await ensureAccessToken();
  const title = cleanTitle(options.title, brand.name);

  let publicImage: string | undefined;
  if (options.imagePath) {
    try {
      const hosted = await ensurePublicImageUrl(options.imagePath);
      if (hosted.url) {
        publicImage = hosted.url;
        console.log("[telegraph] Hero image:", publicImage);
      } else {
        console.warn("[telegraph] Image host failed:", hosted.error);
      }
    } catch (e) {
      console.warn("[telegraph] Image host error:", e);
    }
  }

  const content = textToTelegraphNodes(options.content, publicImage);

  const body = new URLSearchParams({
    access_token: accessToken,
    title,
    content: JSON.stringify(content),
    author_name: options.authorName || brand.name,
    author_url:
      options.authorUrl ||
      brand.socialLinks.telegram ||
      brand.socialLinks.linkedin,
    return_content: "false",
  });

  const res = await fetch(`${API}/createPage`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    result?: TelegraphPage;
    error?: string;
  };
  if (!json.ok || !json.result?.url) {
    throw new Error(json.error || "Telegraph createPage failed");
  }
  console.log("[telegraph] Page:", json.result.url);
  return { url: json.result.url, path: json.result.path };
}

/**
 * Channel teaser: complete-thought hook + optional Telegraph link + compact footer.
 * Always aims to stay under Telegram photo caption hard limit (1024).
 */
export function buildTelegramTeaser(fullText: string, telegraphUrl: string): string {
  const CAPTION_HARD = 1024;
  let plain = stripFooterAndTags(fullText);
  plain = stripSourceIntros(plain);
  plain = plain.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const linkBlock = telegraphUrl
    ? `\n\n📖 <b>Toʻliq maqola</b>\n<a href="${escapeHtml(telegraphUrl)}">${escapeHtml(telegraphUrl)}</a>`
    : "";
  const footer = buildBrandFooter("telegram", "compact");
  const reserved = linkBlock.length + (footer ? footer.length + 2 : 0);
  const hookBudget = Math.max(80, CAPTION_HARD - reserved - 8);

  const paras = plain.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  let hook = "";
  for (const p of paras) {
    if (/^Author:/i.test(p) || /^AI Engineering/i.test(p)) break;
    const next = hook ? `${hook} ${p}` : p;
    if (next.length > hookBudget) break;
    hook = next;
    if (hook.length >= Math.min(320, hookBudget)) break;
  }
  if (!hook) {
    hook = plain.slice(0, hookBudget);
    const sp = hook.lastIndexOf(" ");
    if (sp > 40) hook = hook.slice(0, sp);
  }
  hook = stripSourceIntros(hook)
    .replace(/\n*#[\w\u0400-\u04FF]+(\s+#[\w\u0400-\u04FF]+)*\s*$/g, "")
    .trim();

  let out = `${escapeHtml(hook)}${linkBlock}`;
  if (footer) out = `${out}\n\n${footer}`;
  if (out.length > CAPTION_HARD) {
    out = `${escapeHtml(hook.slice(0, Math.max(40, hookBudget - 20)))}${linkBlock}`;
  }
  if (out.length > CAPTION_HARD) {
    const sp = out.lastIndexOf(" ", CAPTION_HARD - 1);
    out = (sp > 40 ? out.slice(0, sp) : out.slice(0, CAPTION_HARD - 1)).trim() + "…";
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
