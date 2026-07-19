/**
 * Brand face reference for identity-preserving cover generation.
 * Default: data/brand/face.jpg (mounted on VDS via ./data volume).
 * Override: BRAND_FACE_IMAGE=/absolute/or/relative/path.jpg
 *
 * Multimodal identity works only with Nano Banana + Skywork (image+text).
 * Pollinations / Cloudflare / Horde receive text only — they cannot "see" face.jpg.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REL = path.join("data", "brand", "face.jpg");

/** Max long-edge for API payloads (Gemini / Skywork). Full 1.8MB originals often fail or degrade. */
const API_MAX_EDGE = 1024;
/** Target JPEG quality after downscale. */
const API_JPEG_QUALITY = 88;
/** Warn / try compress when raw file exceeds this. */
const LARGE_FACE_BYTES = 400_000;

export type BrandFaceRef = {
  path: string;
  buffer: Buffer;
  mimeType: string;
  base64: string;
  /** True when buffer was downscaled/recompressed for multimodal APIs. */
  prepared?: boolean;
};

function guessMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

/** Resolve face image path (env or default under project data/). */
export function resolveBrandFacePath(): string {
  const fromEnv = (process.env.BRAND_FACE_IMAGE || "").trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv)
      ? fromEnv
      : path.resolve(process.cwd(), fromEnv);
  }
  // Prefer cwd (Docker: /app + volume ./data)
  const cwdPath = path.resolve(process.cwd(), DEFAULT_REL);
  if (fs.existsSync(cwdPath)) return cwdPath;
  // Fallback: relative to package (dist/lib → ../../data/brand/face.jpg)
  return path.resolve(__dirname, "../../", DEFAULT_REL);
}

export function isBrandFaceConfigured(): boolean {
  try {
    const p = resolveBrandFacePath();
    return fs.existsSync(p) && fs.statSync(p).size > 1000;
  } catch {
    return false;
  }
}

/**
 * Downscale/recompress face for multimodal APIs when sharp is available.
 * Large originals (e.g. 1.8MB) bloat base64 (~2.4MB+) and can cause timeouts
 * or weaker identity adherence on Gemini/Skywork.
 */
async function prepareFaceBuffer(
  raw: Buffer,
  filePath: string,
): Promise<{ buffer: Buffer; mimeType: string; prepared: boolean }> {
  const rawMime = guessMime(filePath);
  if (raw.length <= LARGE_FACE_BYTES) {
    return { buffer: raw, mimeType: rawMime, prepared: false };
  }

  try {
    const sharpMod = await import("sharp").catch(() => null);
    if (!sharpMod?.default) {
      console.warn(
        `[brandFace] large face ${raw.length} bytes — install sharp for auto-downscale ` +
          `(or use a ~512–1024px JPEG under ~400KB for better identity APIs)`,
      );
      return { buffer: raw, mimeType: rawMime, prepared: false };
    }
    const buffer = await sharpMod
      .default(raw)
      .rotate()
      .resize(API_MAX_EDGE, API_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: API_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    console.log(
      `[brandFace] prepared for API: ${raw.length} → ${buffer.length} bytes ` +
        `(maxEdge=${API_MAX_EDGE}, q=${API_JPEG_QUALITY})`,
    );
    return { buffer, mimeType: "image/jpeg", prepared: true };
  } catch (e) {
    console.warn(
      `[brandFace] prepare failed, using original: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return { buffer: raw, mimeType: rawMime, prepared: false };
  }
}

/**
 * Load brand face for image-to-image / reference. Returns null if missing.
 * Async so large faces can be downscaled before base64.
 */
export async function loadBrandFace(): Promise<BrandFaceRef | null> {
  const filePath = resolveBrandFacePath();
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`[brandFace] not found: ${filePath}`);
      return null;
    }
    const raw = fs.readFileSync(filePath);
    if (raw.length < 1000) {
      console.warn(`[brandFace] file too small: ${filePath}`);
      return null;
    }
    const { buffer, mimeType, prepared } = await prepareFaceBuffer(
      raw,
      filePath,
    );
    return {
      path: filePath,
      buffer,
      mimeType,
      base64: buffer.toString("base64"),
      prepared,
    };
  } catch (e) {
    console.warn(
      `[brandFace] load failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

/** Sync check-only helper (no prepare). Prefer loadBrandFace for generation. */
export function loadBrandFaceSync(): BrandFaceRef | null {
  const filePath = resolveBrandFacePath();
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`[brandFace] not found: ${filePath}`);
      return null;
    }
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 1000) {
      console.warn(`[brandFace] file too small: ${filePath}`);
      return null;
    }
    const mimeType = guessMime(filePath);
    return {
      path: filePath,
      buffer,
      mimeType,
      base64: buffer.toString("base64"),
      prepared: false,
    };
  } catch (e) {
    console.warn(
      `[brandFace] load failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

export function logBrandFace(): void {
  if (isBrandFaceConfigured()) {
    const p = resolveBrandFacePath();
    let size = 0;
    try {
      size = fs.statSync(p).size;
    } catch {
      /* ignore */
    }
    console.log(`[AI] BRAND FACE: ${p} (${size} bytes)`);
    if (size > LARGE_FACE_BYTES) {
      console.log(
        `[AI] BRAND FACE: large file — pipeline will downscale for Nano/Skywork when sharp is available`,
      );
    }
  } else {
    console.log(
      `[AI] BRAND FACE: not found (expected data/brand/face.jpg or BRAND_FACE_IMAGE)`,
    );
  }
}
