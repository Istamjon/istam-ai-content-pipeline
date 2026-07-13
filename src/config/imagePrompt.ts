/**
 * Premium AI Engineering image prompts for Cloudflare FLUX.2 / social covers.
 * 3 presets — NO office, NO readable text on image.
 * Topic drives visual metaphor (not on-image typography).
 * Brand color: #036158
 */

export const brandImageColors = {
  primary: "#036158",
  secondaryWhite: "#FFFFFF",
  darkGray: "#1F2937",
  black: "#0A0A0A",
  accentCyan: "#5EEAD4",
};

export type ImageVisualPreset = "graph" | "abstract" | "systems";

export const IMAGE_PRESETS: ImageVisualPreset[] = [
  "graph",
  "abstract",
  "systems",
];

export const imageAspect = {
  ratio: "1:1",
  width: 1024,
  height: 1024,
  genWidth: 1024,
  genHeight: 1024,
} as const;

/** Hard ban: models often paint gibberish words when UI/dashboard is mentioned. */
const NEGATIVE_BLOCK = `Negative:
absolutely no text, no letters, no words, no numbers, no alphabet, no typography, no captions, no labels, no watermarks, no logos, no signs, no UI screens with text, no keyboard, no code on screen, no charts with axis labels, no readable interface, no people, no faces, no hands, no office, no desk, no chair, no workplace, no room interior, no furniture, no low quality, no blurry, no cartoon, no anime, no stock photo, no oversaturation, no chaotic collage, no third-party brand marks`;

const COLOR_BLOCK = `Color:
brand teal #036158, white, dark gray #1F2937, black #0A0A0A, soft cyan accents only — no rainbow neon`;

const QUALITY_BLOCK = `Quality:
ultra detailed, sharp, clean edges, professional social post visual, square 1:1, photoreal CGI hybrid`;

type PresetSpec = {
  id: ImageVisualPreset;
  environment: string;
  composition: string;
  style: string;
  lighting: string;
  details: string;
  camera: string;
  subjectLead: string;
};

const PRESETS: Record<ImageVisualPreset, PresetSpec> = {
  graph: {
    id: "graph",
    subjectLead:
      "visual metaphor of multi-agent orchestration as glowing connected nodes and flowing edges",
    environment: `Environment:
dark premium void, translucent geometric planes, pure technical space, no rooms`,
    composition: `Composition:
centered node graph, teal modules linked by soft data streams, hierarchical, clear structure, generous negative space`,
    style: `Style:
premium systems architecture illustration, 3D CGI, minimal enterprise editorial, high clarity`,
    lighting: `Lighting:
soft studio glow on nodes, gentle edge light, light haze for depth`,
    details: `Details:
smooth unlabeled nodes, abstract connectors, no screens, no keyboards, no readable panels, polished materials`,
    camera: `Camera:
slight isometric view, sharp main path, square crop`,
  },

  abstract: {
    id: "abstract",
    subjectLead:
      "abstract premium AI concept form made of neural lattice and teal energy flows",
    environment: `Environment:
deep black to charcoal gradient, soft volumetric atmosphere, no interiors`,
    composition: `Composition:
bold central abstract sculpture, asymmetric balance, poster-like, strong negative space`,
    style: `Style:
gallery-quality abstract tech art, refined CGI, elegant minimalism, not crypto-art`,
    lighting: `Lighting:
soft key light, teal subsurface glow, cinematic contrast`,
    details: `Details:
neural filaments, particle streams, glass-like surfaces, no symbols, no glyphs, no text fragments`,
    camera: `Camera:
centered product portrait framing, shallow depth of field, square crop`,
  },

  systems: {
    id: "systems",
    subjectLead:
      "abstract cloud infrastructure layers and intelligent data beams in free space",
    environment: `Environment:
open dark digital expanse, floating layers, soft horizon grid, no buildings interiors`,
    composition: `Composition:
layered constellation of unlabeled modules connected by teal beams, clean uncluttered systems map`,
    style: `Style:
high-end infrastructure CGI, enterprise cloud aesthetic, modern reliable minimal`,
    lighting: `Lighting:
cool soft overhead light, teal emissive accents, premium product lighting`,
    details: `Details:
abstract server-like blocks without labels, smooth tunnels, polished metal-glass, no monitors with text`,
    camera: `Camera:
slightly elevated wide technical view, square crop`,
  },
};

/**
 * Turn title/hint into short visual concepts — avoid feeding full titles
 * that models try to paint as letters.
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
      "gets",
      "gets",
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
      "price",
      "pricey",
      "delays",
      "act",
      "news",
      "blog",
      "update",
      "introducing",
      "announcing",
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
    if (unique.length >= 8) break;
  }

  // Prefer technical concepts; avoid brand names models try to spell as letters
  const concepts = unique
    .join(", ")
    .replace(/\bGemini\b/gi, "language model")
    .replace(/\bFlash\b/gi, "fast model")
    .replace(/\bGPT-?[0-9.]*\b/gi, "language model")
    .replace(/\bClaude\b/gi, "assistant model")
    .replace(/\bOpenAI\b/gi, "AI lab")
    .replace(/\bTraffic\b/gi, "network flow")
    .slice(0, 160);

  if (!concepts) {
    return "AI agents, automation pipelines, production systems";
  }
  return concepts;
}

export function pickImagePreset(
  seed: string,
  force?: ImageVisualPreset | string,
): ImageVisualPreset {
  const f = (force || "").toLowerCase().trim();
  if (f === "graph" || f === "abstract" || f === "systems") return f;
  if (f === "workspace" || f === "office") return "systems";

  let h = 0;
  const s = seed || "default";
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const day = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < day.length; i++) h = (h * 17 + day.charCodeAt(i)) >>> 0;
  return IMAGE_PRESETS[h % IMAGE_PRESETS.length];
}

/**
 * Build structured premium prompt — topic as visual metaphor only.
 * Never ask the model to render the article title as text.
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

  const subject = `Subject:
${p.subjectLead}, visually expressing these ideas (metaphor only, not written text): ${concepts}.
Image must contain zero readable text of any kind.`;

  const sections = [
    subject,
    p.environment,
    p.composition,
    p.style,
    p.lighting,
    COLOR_BLOCK,
    p.details,
    p.camera,
    QUALITY_BLOCK,
    NEGATIVE_BLOCK,
  ];

  let full = sections.join("\n\n").trim();
  if (full.length > 2000) {
    full = full.slice(0, 1990).trimEnd() + "…";
  }
  return { prompt: full, preset };
}
