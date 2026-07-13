/**
 * Premium editorial hero image prompts (Nano Banana / Cloudflare FLUX / Horde).
 * Rules:
 *  - Background: dark gray → black gradient only (NO office, NO room, NO furniture)
 *  - Center: ONE main visual idea (topic-driven production AI concept)
 *  - Brand primary: #036158
 *
 * Length targets: Horde ~1000 (lead first), CF ~2200, Nano ~2500.
 */

export const brandImageColors = {
  primary: "#036158",
  secondaryWhite: "#FFFFFF",
  darkGray: "#1F2937",
  black: "#0A0A0A",
  accentCyan: "#5EEAD4",
};

/** Center-subject variety — same dark gradient void background for all. */
export type ImageVisualPreset = "workflow" | "infrastructure" | "engineering";

export const IMAGE_PRESETS: ImageVisualPreset[] = [
  "workflow",
  "infrastructure",
  "engineering",
];

/** Legacy env aliases → new presets */
const PRESET_ALIASES: Record<string, ImageVisualPreset> = {
  workflow: "workflow",
  infrastructure: "infrastructure",
  engineering: "engineering",
  graph: "workflow",
  abstract: "engineering",
  systems: "infrastructure",
  workspace: "engineering",
  office: "engineering",
};

export const imageAspect = {
  ratio: "1:1",
  width: 1024,
  height: 1024,
  genWidth: 1024,
  genHeight: 1024,
} as const;

/** Shared background for every image — hard rule. */
const BACKGROUND_RULE =
  "pure dark gray to black vertical gradient void background (#1F2937 fading into #0A0A0A), empty negative space, no floor, no walls, no room, no office, no desk, no chair, no furniture, no windows, no people, no workplace interior";

type PresetSpec = {
  id: ImageVisualPreset;
  /** Single centered hero subject (the ONE main visual idea). */
  centerIdea: string;
};

/**
 * Three center-subject angles — always one focal object/system, same dark void bg.
 */
const PRESETS: Record<ImageVisualPreset, PresetSpec> = {
  workflow: {
    id: "workflow",
    centerIdea:
      "one centered multi-agent orchestration system: a few connected agent modules linked by teal data streams into a single clear pipeline, knowledge retrieval feeding the center, automation flow ending in one outcome node",
  },

  infrastructure: {
    id: "infrastructure",
    centerIdea:
      "one centered production AI platform core: compact cloud/model-serving mesh with retrieval layer and API gateway as a single coherent architecture object, teal health glow, clean layered structure",
  },

  engineering: {
    id: "engineering",
    centerIdea:
      "one centered AI engineering construct: a refined production pipeline sculpture showing build → evaluate → deploy as a single elegant technical form with brand teal accents, no workspace props",
  },
};

/**
 * Topic → short visual concepts (not title typography).
 */
export function topicToVisualConcepts(
  title: string,
  hint?: string,
): string {
  const raw = `${title} ${hint || ""}`
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[|/·•]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const stop = new Set(
    [
      "the",
      "a",
      "an",
      "and",
      "or",
      "of",
      "to",
      "for",
      "in",
      "on",
      "with",
      "from",
      "how",
      "why",
      "new",
      "our",
      "you",
      "your",
      "this",
      "that",
      "into",
      "over",
      "under",
      "about",
      "using",
      "drive",
      "online",
      "news",
      "blog",
      "update",
      "introducing",
      "announcing",
      "gets",
      "act",
    ].map((w) => w.toLowerCase()),
  );

  const tokens = raw
    .split(/[^A-Za-z0-9+#.-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .filter((t) => !stop.has(t.toLowerCase()))
    .filter((t) => !/^\d+$/.test(t));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(t);
    if (unique.length >= 10) break;
  }

  const concepts = unique
    .join(", ")
    .replace(/\bGemini\b/gi, "language model")
    .replace(/\bFlash\b/gi, "fast model")
    .replace(/\bGPT-?[0-9.]*\b/gi, "language model")
    .replace(/\bClaude\b/gi, "assistant model")
    .replace(/\bOpenAI\b/gi, "AI lab")
    .replace(/\bTraffic\b/gi, "network flow")
    .slice(0, 180);

  if (!concepts) {
    return "AI agents, orchestration, knowledge retrieval, automation pipelines, production systems";
  }
  return concepts;
}

export function pickImagePreset(
  seed: string,
  force?: ImageVisualPreset | string,
): ImageVisualPreset {
  const f = (force || "").toLowerCase().trim();
  if (f && PRESET_ALIASES[f]) return PRESET_ALIASES[f];

  let h = 0;
  const s = seed || "default";
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const day = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < day.length; i++) h = (h * 17 + day.charCodeAt(i)) >>> 0;
  return IMAGE_PRESETS[h % IMAGE_PRESETS.length];
}

/**
 * Build premium editorial hero prompt.
 * Hard layout: dark gray→black gradient bg + ONE centered main idea.
 */
export function buildPremiumImagePrompt(
  topicTitle: string,
  topicHint?: string,
  options?: { preset?: ImageVisualPreset | string },
): { prompt: string; preset: ImageVisualPreset } {
  const concepts = topicToVisualConcepts(topicTitle, topicHint);
  const preset = pickImagePreset(
    topicTitle + "|" + (topicHint || "") + "|" + concepts,
    options?.preset,
  );
  const p = PRESETS[preset];

  // ── Lead (must survive Horde 1000-char slice) ──────────────────────────
  // Put layout constraints first — providers often truncate the tail.
  const lead = [
    `Isolated product-hero shot on empty void: dark gray to black smooth gradient background only (#1F2937 → #0A0A0A).`,
    `NO room, NO office, NO corridor, NO floor tiles, NO walls, NO ceiling, NO desks, NO keyboards, NO people, NO architecture.`,
    `ONE single centered floating subject only — ${p.centerIdea}.`,
    `Topic (visual metaphor, never written as text): ${concepts}.`,
    `Subject floats in empty space with soft studio rim light; huge empty gradient around it; square 1:1.`,
    `Brand teal #036158 + subtle cyan glow only on the subject. Photoreal CGI, minimalist, enterprise magazine quality.`,
    `No text, no logos, no watermarks, no generic flat cloud icon.`,
  ].join(" ");

  // ── Extended (CF / Nano Banana) ──────────────────────────────
  const extended = [
    ``,
    `Creative direction:`,
    `- Exactly one hero subject in the middle — do not fill the frame with many competing objects.`,
    `- Background must stay empty dark gray → black gradient; never invent an office or workspace.`,
    `- Every part of the center object should relate to a real production AI idea for the topic.`,
    `- Communicate innovation, intelligence, trust, enterprise engineering excellence.`,
    `- Make the reader curious to click; avoid generic cloud icons and cliché robot faces.`,
    ``,
    `Visual quality: ultra realistic materials, detailed center subject, HDR, high contrast, premium corporate look.`,
    ``,
    `Negative: no office, no desk, no chair, no room interior, no walls, no floor perspective room, no people, no hands, no faces, no furniture, no windows, no keyboard, no monitors with text, no abstract-only random blobs, no crypto-art, no cartoon, no anime, no stock cliché, no oversaturation, no UI labels, no logos, no watermarks, no low quality, no blurry.`,
  ].join("\n");

  let full = (lead + "\n" + extended).trim();
  if (full.length > 2180) {
    full = full.slice(0, 2170).trimEnd();
  }
  return { prompt: full, preset };
}
