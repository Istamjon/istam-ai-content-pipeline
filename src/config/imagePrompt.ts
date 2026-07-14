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
  "dark technical blueprint background, deep indigo-black engineering grid canvas (#0A0A0C with subtle gray gridlines), clean flat schematic layout, empty space, no rooms, no offices, no walls, no floors, no people";

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
      "a clean 2D schematic diagram of a multi-agent system architecture, consisting of thin vector geometric node boxes, connected by sharp data flow lines with tiny directional arrows",
  },

  infrastructure: {
    id: "infrastructure",
    centerIdea:
      "a clean system architecture flowchart, depicting a modular cloud-serving mesh, api gateways, and database/retrieval layers as structured technical blocks on a grid",
  },

  engineering: {
    id: "engineering",
    centerIdea:
      "a scientific engineering drawing of a circular pipeline cycle, showing modular build-evaluate-deploy stages linked by precise curved pathways with minimal technical nodes",
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
    `A clean 2D vector technical blueprint schematic of an AI architecture on a dark engineering grid background (#0A0A0C with subtle gray gridlines).`,
    `NO room, NO office, NO floor tiles, NO walls, NO furniture, NO desks, NO people.`,
    `ONE main centered diagram only — ${p.centerIdea}.`,
    `Topic (conceptual schematic, never written as text): ${concepts}.`,
    `High-contrast technical drawing style, 2.5D schematic view, thin precise vector strokes, crisp lines, square 1:1 format.`,
    `Brand teal #036158 and electric cyan lines highlighting the flow pathways, minimal clean illustration, research paper figure quality.`,
    `No written text inside the diagram, no logos, no watermarks, no generic flat cloud icons.`,
  ].join(" ");

  // ── Extended (CF / Nano Banana) ──────────────────────────────
  const extended = [
    ``,
    `Creative direction:`,
    `- Exactly one clear schematic flowchart in the middle — do not clutter the diagram with unnecessary nodes.`,
    `- Background must stay a clean, dark grid canvas; never generate realistic rooms, offices, or people.`,
    `- Every line, arrow, and box must represent a clean logical component of the AI system.`,
    `- Communicate technical precision, academic depth, and elegant system design.`,
    `- Avoid literal texts, letters, words, or alphabet symbols on the diagram modules.`,
    ``,
    `Visual quality: crisp vector style, thin white and brand teal strokes, clean schematics, high contrast, research-grade look.`,
    ``,
    `Negative: realistic room, office interior, furniture, desks, keyboard, monitors, people, faces, hands, 3D CGI plastic look, messy drawings, cartoon, anime, low resolution, blurry lines, letters, text labels, alphabet words, logos, watermarks.`,
  ].join("\n");

  let full = (lead + "\n" + extended).trim();
  if (full.length > 2180) {
    full = full.slice(0, 2170).trimEnd();
  }
  return { prompt: full, preset };
}
