import fs from "fs";
import path from "path";
import { env } from "../config/env.js";

/** Litterbox allowed expiry windows (auto-delete on their servers). */
export type TempImageHours = 1 | 12 | 24 | 72;

const LITTERBOX_API = "https://litterbox.catbox.moe/resources/internals/api.php";

/**
 * Resolve a publicly reachable HTTPS URL for a local image.
 * Uses temporary hosting so files auto-expire remotely (default 24h).
 *
 * Priority:
 * 1. Already http(s) → as-is
 * 2. Litterbox temporary upload (free, auto-deletes after time=)
 * 3. Optional ImgBB if IMGBB_API_KEY set (fallback)
 */
export async function ensurePublicImageUrl(
  imagePath?: string,
): Promise<{ url?: string; error?: string; temporary?: boolean }> {
  if (!imagePath) {
    return { error: "No image path provided" };
  }

  if (/^https?:\/\//i.test(imagePath)) {
    return { url: imagePath, temporary: false };
  }

  if (!fs.existsSync(imagePath)) {
    return { error: `Image file not found: ${imagePath}` };
  }

  try {
    const url = await uploadToLitterbox(imagePath, env.IMAGE_TEMP_HOURS);
    return { url, temporary: true };
  } catch (litterboxError) {
    console.warn("[imageHost] Litterbox failed:", litterboxError);

    if (env.IMGBB_API_KEY) {
      try {
        const url = await uploadToImgbb(imagePath);
        return { url, temporary: false };
      } catch (imgbbError) {
        return {
          error: `Temp image upload failed (litterbox + imgbb): ${String(imgbbError)}`,
        };
      }
    }

    return {
      error: `Temporary image upload failed: ${String(litterboxError)}`,
    };
  }
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
 * Remove old files from data/images older than maxAgeMs (default 24h).
 * Call occasionally so disk does not grow if a run crashes mid-way.
 */
export function cleanupOldLocalImages(imagesDir: string, maxAgeMs = 24 * 60 * 60 * 1000): number {
  if (!fs.existsSync(imagesDir)) return 0;
  const now = Date.now();
  let removed = 0;
  for (const name of fs.readdirSync(imagesDir)) {
    const full = path.join(imagesDir, name);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(full);
        removed += 1;
      }
    } catch {
      // ignore per-file errors
    }
  }
  return removed;
}

function normalizeTempHours(hours: number): TempImageHours {
  if (hours <= 1) return 1;
  if (hours <= 12) return 12;
  if (hours <= 24) return 24;
  return 72;
}

/**
 * Litterbox — temporary free hosting; file disappears after the chosen window.
 * @see https://litterbox.catbox.moe/
 */
async function uploadToLitterbox(imagePath: string, hours: number): Promise<string> {
  const time = `${normalizeTempHours(hours)}h`;
  // Node native FormData + Blob (form-data package breaks with undici fetch → 412)
  const buf = fs.readFileSync(imagePath);
  const blob = new Blob([buf], { type: contentTypeFor(imagePath) });
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("time", time);
  form.append("fileToUpload", blob, path.basename(imagePath));

  const response = await fetch(LITTERBOX_API, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(90_000),
  });

  const text = (await response.text()).trim();
  if (!response.ok || !/^https?:\/\//i.test(text)) {
    throw new Error(`Litterbox upload failed: ${response.status} ${text.slice(0, 200)}`);
  }
  return text;
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
  return "image/png";
}
