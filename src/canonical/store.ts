/**
 * Persist Canonical Content: SQLite index + JSON files under data/canonical/.
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { env } from "../config/env.js";
import type { CanonicalContent, CanonicalListItem } from "./types.js";

const root = process.cwd();
const canonicalDir = path.resolve(root, "data/canonical");
const dbPath = path.resolve(env.DB_PATH);

if (!fs.existsSync(canonicalDir)) {
  fs.mkdirSync(canonicalDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS canonical_content (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL UNIQUE,
    title TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    content_hash TEXT,
    body_path TEXT,
    created_at TEXT,
    updated_at TEXT
  )
`);

function filePathFor(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return path.join(canonicalDir, `${safe}.json`);
}

export function saveCanonical(doc: CanonicalContent): CanonicalContent {
  if (!fs.existsSync(canonicalDir)) {
    fs.mkdirSync(canonicalDir, { recursive: true });
  }
  const fp = filePathFor(doc.id);
  fs.writeFileSync(fp, JSON.stringify(doc, null, 2), "utf8");

  db.prepare(
    `INSERT INTO canonical_content (id, source_url, title, version, content_hash, body_path, created_at, updated_at)
     VALUES (@id, @source_url, @title, @version, @content_hash, @body_path, @created_at, @updated_at)
     ON CONFLICT(source_url) DO UPDATE SET
       id = excluded.id,
       title = excluded.title,
       version = excluded.version,
       content_hash = excluded.content_hash,
       body_path = excluded.body_path,
       updated_at = excluded.updated_at`,
  ).run({
    id: doc.id,
    source_url: doc.sourceUrl,
    title: doc.title,
    version: doc.version,
    content_hash: doc.contentHash,
    body_path: fp,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  });

  console.log(
    `[canonical] saved id=${doc.id} v${doc.version} → ${path.relative(root, fp)}`,
  );
  return doc;
}

export function loadCanonical(id: string): CanonicalContent | null {
  const fp = filePathFor(id);
  if (fs.existsSync(fp)) {
    return JSON.parse(fs.readFileSync(fp, "utf8")) as CanonicalContent;
  }
  const row = db
    .prepare("SELECT body_path FROM canonical_content WHERE id = ?")
    .get(id) as { body_path: string } | undefined;
  if (row?.body_path && fs.existsSync(row.body_path)) {
    return JSON.parse(fs.readFileSync(row.body_path, "utf8")) as CanonicalContent;
  }
  return null;
}

export function loadCanonicalByUrl(sourceUrl: string): CanonicalContent | null {
  const row = db
    .prepare("SELECT body_path FROM canonical_content WHERE source_url = ?")
    .get(sourceUrl) as { body_path: string } | undefined;
  if (row?.body_path && fs.existsSync(row.body_path)) {
    return JSON.parse(fs.readFileSync(row.body_path, "utf8")) as CanonicalContent;
  }
  if (!fs.existsSync(canonicalDir)) return null;
  for (const name of fs.readdirSync(canonicalDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const doc = JSON.parse(
        fs.readFileSync(path.join(canonicalDir, name), "utf8"),
      ) as CanonicalContent;
      if (doc.sourceUrl === sourceUrl) return doc;
    } catch {
      /* skip */
    }
  }
  return null;
}

export function listCanonical(limit = 50): CanonicalListItem[] {
  return db
    .prepare(
      `SELECT id, source_url as sourceUrl, title, version, updated_at as updatedAt, content_hash as contentHash
       FROM canonical_content
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as CanonicalListItem[];
}

/** Update master body → bump version → clear derived (caller re-formats). */
export function updateCanonicalBody(
  sourceUrl: string,
  newBody: string,
  extra?: Partial<
    Pick<CanonicalContent, "title" | "summary" | "imagePath" | "imagePrompt" | "tags">
  >,
): CanonicalContent | null {
  const existing = loadCanonicalByUrl(sourceUrl);
  if (!existing) return null;

  const hash = createHash("sha256").update(newBody).digest("hex").slice(0, 32);
  const now = new Date().toISOString();
  const next: CanonicalContent = {
    ...existing,
    ...extra,
    body: newBody,
    contentHash: hash,
    version: existing.version + 1,
    updatedAt: now,
    derived: undefined,
  };
  return saveCanonical(next);
}
