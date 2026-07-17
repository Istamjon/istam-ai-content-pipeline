/**
 * Brand face reference for identity-preserving cover generation.
 * Default: data/brand/face.jpg (mounted on VDS via ./data volume).
 * Override: BRAND_FACE_IMAGE=/absolute/or/relative/path.jpg
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REL = path.join("data", "brand", "face.jpg");

export type BrandFaceRef = {
  path: string;
  buffer: Buffer;
  mimeType: string;
  base64: string;
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
 * Load brand face for image-to-image / reference. Returns null if missing.
 */
export function loadBrandFace(): BrandFaceRef | null {
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
  } else {
    console.log(
      `[AI] BRAND FACE: not found (expected data/brand/face.jpg or BRAND_FACE_IMAGE)`,
    );
  }
}
