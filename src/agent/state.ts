import { Annotation } from "@langchain/langgraph";
import type { CanonicalContent } from "../canonical/types.js";

export type Platform =
  | "telegram"
  | "linkedin"
  | "facebook"
  | "instagram"
  | "x"
  | "threads"
  | "blogger";

export interface Article {
  url: string;
  title: string;
  rawText: string;
  summary?: string;
  translated?: string;
  rewritten?: string;
  imagePrompt?: string;
  imagePath?: string;
}

/** Re-export for graph consumers */
export type { CanonicalContent };

export interface FormattedPost {
  /** Primary text (root post / full body). */
  text: string;
  hasImage: boolean;
  /**
   * Threads multi-post chain (part 0 = text).
   * When set, publisher posts replies for parts[1..].
   */
  parts?: string[];
  /**
   * Media caption when different from text (e.g. Telegram photo ≤1024).
   * If omitted, publisher uses text (may teaser internally).
   */
  caption?: string;
}

export interface QualityResult {
  ok: boolean;
  issues: string[];
}

export interface PublishResult {
  platform: Platform;
  status: "success" | "failed" | "skipped" | "pending";
  error?: string;
}

/** Append-only for new items (do not re-include previous state in updates). */
const appendReducer = <T>(left: T[], right: T | T[]) => [
  ...left,
  ...(Array.isArray(right) ? right : [right]),
];

/** Replace array entirely (for per-article publishResults that must not accumulate). */
const replaceArrayReducer = <T>(left: T[] | undefined, right: T[] | undefined): T[] =>
  right ?? left ?? [];

const emptyFormatted = (): Record<Platform, FormattedPost | null> => ({
  telegram: null,
  linkedin: null,
  facebook: null,
  instagram: null,
  x: null,
  threads: null,
  blogger: null,
});

export const StateAnnotation = Annotation.Root({
  sources: Annotation<string[]>({
    reducer: appendReducer,
    default: () => [],
  }),
  newArticles: Annotation<Article[]>({
    reducer: replaceArrayReducer,
    default: () => [],
  }),
  articleIndex: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  current: Annotation<Article | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  formatted: Annotation<Record<Platform, FormattedPost | null>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: emptyFormatted,
  }),
  /**
   * Canonical Content — master document for the current article.
   * Platform posts in `formatted` are always derived from this.
   */
  canonical: Annotation<CanonicalContent | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  quality: Annotation<QualityResult | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  /** Per-article results — replaced, not concatenated. */
  publishResults: Annotation<PublishResult[]>({
    reducer: replaceArrayReducer,
    default: () => [],
  }),
  /** Append only the new error string(s); do not re-send the full errors array. */
  errors: Annotation<string[]>({
    reducer: appendReducer,
    default: () => [],
  }),
  retryCount: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
});

export type GraphState = typeof StateAnnotation.State;
export type GraphUpdate = typeof StateAnnotation.Update;

export function createEmptyState(): GraphState {
  return {
    sources: [],
    newArticles: [],
    articleIndex: 0,
    current: null,
    formatted: emptyFormatted(),
    canonical: null,
    quality: null,
    publishResults: [],
    errors: [],
    retryCount: 0,
  };
}

/** Reset per-article fields when moving to the next article. */
export function articleLoopReset(): Partial<GraphState> {
  return {
    current: null,
    formatted: emptyFormatted(),
    canonical: null,
    quality: null,
    publishResults: [],
    retryCount: 0,
  };
}
