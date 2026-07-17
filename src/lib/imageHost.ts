import fs from "fs";
import path from "path";
import { env } from "../config/env.js";

/** Litterbox allowed expiry windows (auto-delete on their servers). */
export type TempImageHours = 1 | 12 | 24 | 72;

const LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php";
const CATBOX_API = "https://catbox.moe/user/api.php";

/**
 * Resolve a publicly reachable HTTPS URL for a local image.
 * Instagram / Threads Graph APIs need a public image_url.
 *
 * Waterfall (free hosts; first success wins):
 * 1. Already http(s) → as-is
 * 2. Litterbox temporary upload (auto-delete after IMAGE_TEMP_HOURS)
 * 3. Catbox permanent free host (Litterbox often 500 on VDS/datacenter IPs)
 * 4. 0x0.st null pointer (temporary-ish free host)
 * 5. Optional ImgBB if IMGBB_API_KEY set
 */
export async function ensurePublicImageUrl(
  imagePath?: string,
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
  const hosts: Array<{
    name: string;
    temporary: boolean;
    run: () => Promise<string>;
  }> = [
    {
      name: "litterbox",
      temporary: true,
      run: () => uploadToLitterbox(imagePath, env.IMAGE_TEMP_HOURS),
    },
    {
      name: "catbox",
      temporary: false,
      run: () => uploadToCatbox(imagePath),
    },
    {
      name: "0x0",
      temporary: true,
      run: () => uploadTo0x0(imagePath),
    },
  ];

  if (env.IMGBB_API_KEY) {
    hosts.push({
      name: "imgbb",
      temporary: false,
      run: () => uploadToImgbb(imagePath),
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
      // Some hosts rate-limit empty UA from datacenter IPs
      "User-Agent": "istam-ai-content-pipeline/1.0",
    },
    signal: AbortSignal.timeout(90_000),
  });

  const text = (await response.text()).trim();
  if (!response.ok || !/^https?:\/\//i.test(text)) {
    throw new Error(`0x0 ${response.status}: ${text.slice(0, 200)}`);
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
): Promise<{ url?: string; error?: string; temporary?: boolean; host?: string }> {
  return ensurePublicImageUrl(mediaPath);
}
