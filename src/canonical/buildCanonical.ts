import { createHash } from "crypto";
import type { Article } from "../agent/state.js";
import { brand } from "../config/brand.js";
import { cleanPostBody } from "../lib/contentClean.js";
import type { CanonicalContent } from "./types.js";
import { loadCanonicalByUrl, saveCanonical } from "./store.js";
import { formatAllFromCanonical } from "./formatFromCanonical.js";

function idFromUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function contentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 32);
}

/**
 * Build / upsert Canonical Content from pipeline article state.
 * Master body = rewritten (quality-approved) text only — cleaned of markdown noise.
 */
export function buildAndSaveCanonical(
  article: Article,
  meta?: { contentType?: string; summary?: string },
): CanonicalContent {
  const raw = (
    article.rewritten ||
    article.translated ||
    article.rawText ||
    ""
  ).trim();
  const body = cleanPostBody(raw);
  if (!body) {
    throw new Error("Cannot build canonical: empty body");
  }

  const now = new Date().toISOString();
  const hash = contentHash(body);
  const existing = loadCanonicalByUrl(article.url);

  let doc: CanonicalContent;
  if (existing && existing.contentHash === hash) {
    // Same facts — only refresh image / title if needed
    doc = {
      ...existing,
      title: article.title || existing.title,
      body: existing.body !== body ? body : existing.body,
      imagePath: article.imagePath || existing.imagePath,
      imagePrompt: article.imagePrompt || existing.imagePrompt,
      summary: meta?.summary || existing.summary,
      contentType: meta?.contentType || existing.contentType,
      updatedAt: now,
    };
  } else if (existing) {
    doc = {
      ...existing,
      title: article.title || existing.title,
      body,
      summary: meta?.summary || existing.summary,
      contentType: meta?.contentType || existing.contentType,
      imagePath: article.imagePath || existing.imagePath,
      imagePrompt: article.imagePrompt || existing.imagePrompt,
      language: brand.outputLanguage || "Uzbek (Latin)",
      version: existing.version + 1,
      contentHash: hash,
      updatedAt: now,
      derived: undefined,
    };
  } else {
    doc = {
      id: idFromUrl(article.url),
      sourceUrl: article.url,
      title: article.title || "Untitled",
      body,
      summary: meta?.summary,
      contentType: meta?.contentType,
      language: brand.outputLanguage || "Uzbek (Latin)",
      imagePrompt: article.imagePrompt,
      imagePath: article.imagePath,
      tags: brand.hashtags,
      version: 1,
      createdAt: now,
      updatedAt: now,
      contentHash: hash,
    };
  }

  // Always re-derive platform posts from master body
  doc.derived = formatAllFromCanonical(doc);
  return saveCanonical(doc);
}

/**
 * Re-format platforms after manual body edit (no AI).
 * Also re-cleans master body (strips leftover ** markdown from older saves).
 */
export function regenerateDerived(doc: CanonicalContent): CanonicalContent {
  const cleaned = cleanPostBody(doc.body || "");
  const bodyChanged = cleaned !== (doc.body || "").trim();
  const nextBody = cleaned || doc.body;
  const base: CanonicalContent = {
    ...doc,
    body: nextBody,
    contentHash: contentHash(nextBody),
    version: bodyChanged ? doc.version + 1 : doc.version,
    updatedAt: new Date().toISOString(),
  };
  const next: CanonicalContent = {
    ...base,
    derived: formatAllFromCanonical(base),
  };
  return saveCanonical(next);
}
