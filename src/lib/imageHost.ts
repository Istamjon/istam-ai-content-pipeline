import fs from "fs";
import path from "path";
import { env } from "../config/env.js";
import { loadTokens } from "../oauth/tokenStore.js";

/** Litterbox allowed expiry windows (auto-delete on their servers). */
export type TempImageHours = 1 | 12 | 24 | 72;

const LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php";
const CATBOX_API = "https://catbox.moe/user/api.php";
const GRAPH = "https://graph.facebook.com/v19.0";

/** Browser-like UA — free hosts block empty/datacenter default agents (403). */
const UPLOAD_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type ImageHostName =
  | "facebook"
  | "litterbox"
  | "catbox"
  | "0x0"
  | "transfer"
  | "imgbb";

export type EnsurePublicImageOptions = {
  /**
   * Host try-order. For Instagram prefer Meta CDN first:
   * `["facebook","catbox","transfer","imgbb",...]`
   */
  prefer?: ImageHostName[];
  /** Skip hosts already tried (e.g. retry after Meta reject). */
  skipHosts?: string[];
  /**
   * When true (default for IG/Threads prefer list), try Facebook Page
   * unpublished photo → fbcdn URL first (Meta can always fetch own CDN).
   */
  tryFacebookCdn?: boolean;
};

/**
 * Resolve a publicly reachable HTTPS URL for a local image.
 * Instagram / Threads Graph APIs need a public image_url.
 *
 * Waterfall (first success wins):
 * 1. Already http(s)
 * 2. Facebook Page unpublished photo → scontent.fbcdn (best for IG)
 * 3. Catbox / transfer.sh / ImgBB / Litterbox / 0x0
 */
export async function ensurePublicImageUrl(
  imagePath?: string,
  options?: EnsurePublicImageOptions,
): Promise<{ url?: string; error?: string; temporary?: boolean; host?: string }> {
  if (!imagePath) {
    return { error: "No image path provided" };
  }

  if (/^https?:\/\//i.test(imagePath)) {
    return { url: imagePath, temporary: false, host: "remote" };
  }

  if (!fs.existsSync(imagePath)) {
    return { error: `Image file not found: ${imagePath}` };
  }

  const errors: string[] = [];
  const tryFb =
    options?.tryFacebookCdn !== false &&
    !(options?.skipHosts || []).some((h) => h.toLowerCase() === "facebook");

  // Prefer Meta CDN when FB page credentials exist (fixes VDS free-host 403)
  if (tryFb) {
    try {
      const fb = await uploadToFacebookCdn(imagePath);
      console.log(
        `[imageHost] OK host=facebook url=${fb.url.slice(0, 80)}`,
      );
      return {
        url: fb.url,
        temporary: true,
        host: "facebook",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`facebook: ${msg.slice(0, 160)}`);
      console.warn(`[imageHost] facebook CDN failed:`, msg.slice(0, 200));
    }
  }

  const allHosts: Array<{
    name: ImageHostName;
    temporary: boolean;
    run: () => Promise<string>;
  }> = [
    {
      name: "catbox",
      temporary: false,
      run: () => uploadToCatbox(imagePath),
    },
    {
      name: "transfer",
      temporary: true,
      run: () => uploadToTransferSh(imagePath),
    },
    {
      name: "litterbox",
      temporary: true,
      run: () => uploadToLitterbox(imagePath, env.IMAGE_TEMP_HOURS),
    },
    {
      name: "0x0",
      temporary: true,
      run: () => uploadTo0x0(imagePath),
    },
  ];

  if (env.IMGBB_API_KEY) {
    // Prefer ImgBB early when key is set (reliable for Meta crawlers)
    allHosts.unshift({
      name: "imgbb",
      temporary: false,
      run: () => uploadToImgbb(imagePath),
    });
  }

  const skip = new Set((options?.skipHosts || []).map((h) => h.toLowerCase()));
  skip.add("facebook"); // already tried above
  const prefer = options?.prefer;
  let hosts = allHosts.filter((h) => !skip.has(h.name));
  if (prefer?.length) {
    const order = new Map(prefer.map((n, i) => [n, i]));
    hosts = [...hosts].sort((a, b) => {
      const ia = order.has(a.name) ? (order.get(a.name) as number) : 100;
      const ib = order.has(b.name) ? (order.get(b.name) as number) : 100;
      return ia - ib;
    });
  }

  for (const host of hosts) {
    try {
      const url = await host.run();
      console.log(`[imageHost] OK host=${host.name} url=${url.slice(0, 80)}`);
      return { url, temporary: host.temporary, host: host.name };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${host.name}: ${msg.slice(0, 160)}`);
      console.warn(`[imageHost] ${host.name} failed:`, msg.slice(0, 200));
    }
  }

  return {
    error: `Public image upload failed (all hosts): ${errors.join(" | ")}`,
  };
}

const PIPELINE_IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
]);

function isPipelineMediaFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (!base || base.startsWith(".")) return false;
  if (base === ".gitkeep" || base === "README.md") return false;
  return PIPELINE_IMAGE_EXT.has(path.extname(base).toLowerCase());
}

/**
 * Delete a local image file after platforms no longer need it.
 * Safe to call multiple times; ignores missing files.
 */
export function deleteLocalImage(imagePath?: string | null): boolean {
  if (!imagePath || /^https?:\/\//i.test(imagePath)) {
    return false;
  }
  try {
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
      return true;
    }
  } catch (error) {
    console.warn("[imageHost] Failed to delete local image:", imagePath, error);
  }
  return false;
}

/**
 * Remove pipeline media from data/images.
 * - maxAgeMs omitted / 0 → delete all matching media (post-publish purge)
 * - maxAgeMs > 0 → only files older than that (orphan crash recovery)
 * Never touches data/brand (face.jpg lives there).
 */
export function cleanupOldLocalImages(
  imagesDir: string,
  maxAgeMs = 30 * 60 * 1000,
): number {
  if (!fs.existsSync(imagesDir)) return 0;
  const now = Date.now();
  const ageGate = maxAgeMs > 0;
  let removed = 0;
  for (const name of fs.readdirSync(imagesDir)) {
    const full = path.join(imagesDir, name);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      if (!isPipelineMediaFile(full)) continue;
      if (ageGate && now - stat.mtimeMs <= maxAgeMs) continue;
      fs.unlinkSync(full);
      removed += 1;
    } catch {
      // ignore per-file errors
    }
  }
  return removed;
}

/**
 * After publish: drop the used file and wipe remaining pipeline images in dir.
 * Keeps disk free — remote hosts (Litterbox/Catbox) already have the bytes for IG/Threads.
 */
export function purgePipelineImagesAfterPublish(
  imagesDir: string,
  justPublishedPath?: string | null,
): { deletedCurrent: boolean; purged: number } {
  const deletedCurrent = justPublishedPath
    ? deleteLocalImage(justPublishedPath)
    : false;
  // maxAgeMs=0 → all remaining media files in data/images
  const purged = cleanupOldLocalImages(imagesDir, 0);
  return { deletedCurrent, purged };
}

function normalizeTempHours(hours: number): TempImageHours {
  if (hours <= 1) return 1;
  if (hours <= 12) return 12;
  if (hours <= 24) return 24;
  return 72;
}

function readImageBlob(imagePath: string): { blob: Blob; filename: string } {
  const buf = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath) || "image.png";
  const blob = new Blob([buf], { type: contentTypeFor(imagePath) });
  return { blob, filename };
}

/**
 * Upload unpublished photo to Facebook Page → return fbcdn source URL.
 * Instagram Graph can always fetch Meta CDN (fixes free-host 403 from VDS).
 */
async function uploadToFacebookCdn(
  imagePath: string,
): Promise<{ url: string }> {
  const fb = loadTokens("facebook");
  const token = (fb?.accessToken || env.FACEBOOK_PAGE_TOKEN || "").trim();
  const pageId = String(fb?.userId || env.FACEBOOK_PAGE_ID || "").trim();
  if (!token || !pageId || pageId === "0") {
    throw new Error("Facebook page token/id missing (run npm run auth:facebook)");
  }

  const buf = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath) || "cover.jpg";
  const form = new FormData();
  form.append(
    "source",
    new Blob([buf], { type: contentTypeFor(imagePath) }),
    filename,
  );
  form.append("published", "false");
  form.append("temporary", "true");
  form.append("access_token", token);

  const createRes = await fetch(
    `${GRAPH}/${encodeURIComponent(pageId)}/photos`,
    {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    },
  );
  const created = (await createRes.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (created.error?.message || !created.id) {
    throw new Error(
      created.error?.message || `FB photo upload HTTP ${createRes.status}`,
    );
  }

  const metaRes = await fetch(
    `${GRAPH}/${encodeURIComponent(created.id)}?fields=images&access_token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  const meta = (await metaRes.json()) as {
    images?: Array<{ source?: string; width?: number; height?: number }>;
    error?: { message?: string };
  };
  if (meta.error?.message) {
    throw new Error(meta.error.message);
  }
  const images = meta.images || [];
  // Prefer largest
  images.sort((a, b) => (b.width || 0) - (a.width || 0));
  const url = images[0]?.source;
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("FB photo has no images[].source URL");
  }
  return { url };
}

/**
 * Litterbox — temporary free hosting; file disappears after the chosen window.
 * @see https://litterbox.catbox.moe/
 */
async function uploadToLitterbox(imagePath: string, hours: number): Promise<string> {
  const time = `${normalizeTempHours(hours)}h`;
  const { blob, filename } = readImageBlob(imagePath);
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("time", time);
  form.append("fileToUpload", blob, filename);

  const response = await fetch(LITTERBOX_API, {
    method: "POST",
    body: form,
    headers: { "User-Agent": UPLOAD_UA },
    signal: AbortSignal.timeout(90_000),
  });

  const text = (await response.text()).trim();
  if (!response.ok || !/^https?:\/\//i.test(text)) {
    throw new Error(`Litterbox ${response.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

/**
 * Catbox — free permanent host (same family as Litterbox; more reliable from VPS).
 * @see https://catbox.moe/tools.php
 */
async function uploadToCatbox(imagePath: string): Promise<string> {
  const { blob, filename } = readImageBlob(imagePath);
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("fileToUpload", blob, filename);

  const response = await fetch(CATBOX_API, {
    method: "POST",
    body: form,
    headers: { "User-Agent": UPLOAD_UA },
    signal: AbortSignal.timeout(90_000),
  });

  const text = (await response.text()).trim();
  if (!response.ok || !/^https?:\/\//i.test(text)) {
    throw new Error(`Catbox ${response.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

/**
 * 0x0.st — free null pointer file host.
 * @see https://0x0.st/
 */
async function uploadTo0x0(imagePath: string): Promise<string> {
  const { blob, filename } = readImageBlob(imagePath);
  const form = new FormData();
  form.append("file", blob, filename);

  const response = await fetch("https://0x0.st", {
    method: "POST",
    body: form,
    headers: {
      "User-Agent": UPLOAD_UA,
    },
    signal: AbortSignal.timeout(90_000),
  });

  const text = (await response.text()).trim();
  if (!response.ok || !/^https?:\/\//i.test(text)) {
    throw new Error(`0x0 ${response.status}: ${text.slice(0, 200)}`);
  }
  return text.split(/\s+/)[0];
}

/**
 * transfer.sh — free temp file host (good Meta image_url fallback when catbox rejected).
 * @see https://transfer.sh/
 */
async function uploadToTransferSh(imagePath: string): Promise<string> {
  const buf = fs.readFileSync(imagePath);
  const filename =
    path.basename(imagePath).replace(/[^a-zA-Z0-9._-]/g, "_") || "image.jpg";
  const response = await fetch(`https://transfer.sh/${filename}`, {
    method: "PUT",
    headers: {
      "Content-Type": contentTypeFor(imagePath),
      "User-Agent": UPLOAD_UA,
      "Max-Downloads": "20",
      "Max-Days": "1",
    },
    body: buf,
    signal: AbortSignal.timeout(90_000),
  });
  const text = (await response.text()).trim();
  if (!response.ok || !/^https?:\/\//i.test(text)) {
    throw new Error(`transfer.sh ${response.status}: ${text.slice(0, 200)}`);
  }
  return text.split(/\s+/)[0];
}

async function uploadToImgbb(imagePath: string): Promise<string> {
  const buffer = fs.readFileSync(imagePath);
  const base64 = buffer.toString("base64");

  const body = new URLSearchParams();
  body.set("key", env.IMGBB_API_KEY);
  body.set("image", base64);
  body.set("name", path.basename(imagePath, path.extname(imagePath)));

  const response = await fetch("https://api.imgbb.com/1/upload", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(60_000),
  });

  const data = (await response.json()) as {
    success?: boolean;
    data?: { url?: string; display_url?: string };
    error?: { message?: string };
  };

  if (!response.ok || !data.success) {
    throw new Error(data.error?.message || `ImgBB HTTP ${response.status}`);
  }

  const url = data.data?.display_url || data.data?.url;
  if (!url) {
    throw new Error("ImgBB returned no URL");
  }
  return url;
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".png") return "image/png";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mkv") return "video/x-matroska";
  return "application/octet-stream";
}

/**
 * Public HTTPS URL for image or video (same free hosts as images).
 * Instagram Reels / Threads VIDEO need a public video_url.
 */
export async function ensurePublicMediaUrl(
  mediaPath?: string,
  options?: EnsurePublicImageOptions,
): Promise<{ url?: string; error?: string; temporary?: boolean; host?: string }> {
  return ensurePublicImageUrl(mediaPath, options);
}
