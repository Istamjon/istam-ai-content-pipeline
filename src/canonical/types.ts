import type { Platform, FormattedPost } from "../agent/state.js";

/**
 * Canonical Content — single master source of truth for one article.
 * All platform posts are derived from this document only.
 * Update body/facts here → re-format → re-publish consistently.
 */
export interface CanonicalContent {
  /** Stable id (hash of source URL + content version) */
  id: string;
  /** Original article URL */
  sourceUrl: string;
  /** Original or brand title */
  title: string;
  /**
   * Master body in output language (Uzbek Latin).
   * Facts and claims live only here — platform texts must not invent new facts.
   */
  body: string;
  /** Short analysis summary (optional context) */
  summary?: string;
  /** Content type from analyzer, e.g. tech_deep */
  contentType?: string;
  /** Language of body */
  language: string;
  /** Image generation prompt (visual only; does not change facts) */
  imagePrompt?: string;
  /** Local path or public URL of hero image */
  imagePath?: string;
  /** Brand hashtag seeds (optional) */
  tags?: string[];
  /** Version increments on every body update */
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Content hash of body for change detection */
  contentHash: string;
  /**
   * Last derived platform posts (cache).
   * Regenerated when body/version changes.
   */
  derived?: Record<Platform, FormattedPost | null>;
}

export interface CanonicalListItem {
  id: string;
  sourceUrl: string;
  title: string;
  version: number;
  updatedAt: string;
  contentHash: string;
}
