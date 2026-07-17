/**
 * Premium social-cover image prompts (Nano Banana / Skywork / CF FLUX / Horde).
 *
 * Goal: scroll-stopping LinkedIn/Telegram covers with:
 *  1) PEOPLE — professional human figure (attention + trust)
 *  2) HEADING — readable on-image title text
 *  3) LOGO — brand monogram / wordmark
 *  + topic-true tech visual (diagram / system metaphor)
 *
 * Brand colors: #036158 teal + #5EEAD4 cyan.
 * Length targets: Horde ~1000 (lead first), CF/Skywork/Nano ~2200–3000.
 */

export const brandImageColors = {
  primary: "#036158",
  secondaryWhite: "#FFFFFF",
  darkGray: "#1F2937",
  black: "#0A0A0A",
  accentCyan: "#5EEAD4",
  hotAmber: "#F59E0B",
};

/** Brand marks rendered ON the cover (not third-party logos). */
export const brandCoverMarks = {
  name: "Istam Obidov",
  shortName: "IstamAI",
  monogram: "IO",
  tagline: "AI Engineering",
};

/** Center-subject variety */
export type ImageVisualPreset =
  | "workflow"
  | "infrastructure"
  | "engineering"
  | "agents"
  | "dataflow";

/**
 * Composition recipes — rotated by seed so posts stay fresh.
 * All hooks now reserve zones for person + heading + logo.
 */
export type ImageCompositionHook =
  | "scale_drama"
  | "diagonal_energy"
  | "radial_burst"
  | "depth_tunnel"
  | "asymmetric_thirds"
  | "critical_path_glow"
  | "bridge_gap"
  | "orbital_constellation";

export const IMAGE_PRESETS: ImageVisualPreset[] = [
  "workflow",
  "infrastructure",
  "engineering",
  "agents",
  "dataflow",
];

export const COMPOSITION_HOOKS: ImageCompositionHook[] = [
  "scale_drama",
  "diagonal_energy",
  "radial_burst",
  "depth_tunnel",
  "asymmetric_thirds",
  "critical_path_glow",
  "bridge_gap",
  "orbital_constellation",
];

/** Legacy env aliases → new presets */
const PRESET_ALIASES: Record<string, ImageVisualPreset> = {
  workflow: "workflow",
  infrastructure: "infrastructure",
  engineering: "engineering",
  agents: "agents",
  dataflow: "dataflow",
  graph: "workflow",
  abstract: "engineering",
  systems: "infrastructure",
  workspace: "engineering",
  office: "engineering",
  multiagent: "agents",
  pipeline: "dataflow",
};

export const imageAspect = {
  ratio: "1:1",
  width: 1024,
  height: 1024,
  genWidth: 1024,
  genHeight: 1024,
} as const;

type PresetSpec = {
  id: ImageVisualPreset;
  centerIdea: string;
  coverFraming: string;
  preferredHooks: ImageCompositionHook[];
};

type HookSpec = {
  id: ImageCompositionHook;
  label: string;
  layout: string;
  eyeCatch: string;
};

const HOOKS: Record<ImageCompositionHook, HookSpec> = {
  scale_drama: {
    id: "scale_drama",
    label: "scale drama",
    layout:
      "SCALE DRAMA: large professional person on the right third (waist-up), oversized glowing tech diagram on the left/center behind them; big hierarchy — person + one giant system node dominate the frame",
    eyeCatch:
      "human face/pose + giant glowing system = instant thumb-stop in social feeds",
  },
  diagonal_energy: {
    id: "diagonal_energy",
    label: "diagonal energy",
    layout:
      "DIAGONAL FLOW: person lower-left looking toward upper-right; luminous teal data path streaks diagonally past them into a tech diagram; heading sits top band along the diagonal energy",
    eyeCatch:
      "eye travels person → light path → heading — dynamic cover, not static poster",
  },
  radial_burst: {
    id: "radial_burst",
    label: "radial burst",
    layout:
      "RADIAL BURST: person slightly off-center with cyan signal rays bursting from a device/hologram near their hands toward a constellation of system nodes; logo top-left safe zone",
    eyeCatch:
      "human + energy burst = high contrast feed interrupt",
  },
  depth_tunnel: {
    id: "depth_tunnel",
    label: "depth tunnel",
    layout:
      "DEPTH TUNNEL: person in foreground sharp, AI pipeline tunnel receding behind them; heading large in upper third; logo bottom-left or top-left",
    eyeCatch:
      "depth pulls viewer in — person anchors trust, tunnel sells the tech story",
  },
  asymmetric_thirds: {
    id: "asymmetric_thirds",
    label: "rule of thirds",
    layout:
      "RULE OF THIRDS: person on left power point, tech diagram on right third, large dark negative space between; heading top spanning; logo corner mark",
    eyeCatch:
      "editorial magazine layout — professional, premium, not centered stock",
  },
  critical_path_glow: {
    id: "critical_path_glow",
    label: "critical path",
    layout:
      "CRITICAL PATH: person points or gazes toward a glowing cyan pathway through a dim system map; only one chain of edges blazes; heading top; amber pulse optional on bottleneck",
    eyeCatch:
      "storytelling cover — viewer follows the glowing path the expert is highlighting",
  },
  bridge_gap: {
    id: "bridge_gap",
    label: "bridge gap",
    layout:
      "BRIDGE: person stands as the bridge between two tech clusters (e.g. data vs agents); luminous connection passes near them; heading above; logo corner",
    eyeCatch:
      "human as the connector metaphor — curiosity + clarity",
  },
  orbital_constellation: {
    id: "orbital_constellation",
    label: "orbital constellation",
    layout:
      "ORBITAL: person centered-lower with elegant agent/module orbits around upper half; monogram logo top-left; bold heading top or mid-upper band",
    eyeCatch:
      "premium sci-fi personal brand cover — ordered complexity + human face",
  },
};

const PRESETS: Record<ImageVisualPreset, PresetSpec> = {
  workflow: {
    id: "workflow",
    centerIdea:
      "a cinematic multi-agent workflow hologram: decision hubs, glowing handoff arcs, orchestrator block as the system brain",
    coverFraming:
      "LinkedIn/Telegram square cover with person + heading + logo safe margins (~8%)",
    preferredHooks: [
      "critical_path_glow",
      "asymmetric_thirds",
      "diagonal_energy",
      "scale_drama",
    ],
  },
  infrastructure: {
    id: "infrastructure",
    centerIdea:
      "monumental layered infrastructure hologram: gateway, cache, model-serving lattice, storage bedrock as architectural slabs of light",
    coverFraming:
      "tech-magazine cover — person foreground, stack behind, bold heading",
    preferredHooks: [
      "depth_tunnel",
      "scale_drama",
      "asymmetric_thirds",
      "bridge_gap",
    ],
  },
  engineering: {
    id: "engineering",
    centerIdea:
      "precision engineering cycle hologram: build → evaluate → deploy as interlocking arcs, one stage super-bright as the active phase",
    coverFraming:
      "research × product launch cover — person + ring diagram + title",
    preferredHooks: [
      "radial_burst",
      "orbital_constellation",
      "critical_path_glow",
      "scale_drama",
    ],
  },
  agents: {
    id: "agents",
    centerIdea:
      "living agent-swarm hologram: geometric agent badges around an orchestrator core with teal signal beams mid-handoff",
    coverFraming:
      "product-launch personal brand cover — face + swarm + headline",
    preferredHooks: [
      "orbital_constellation",
      "radial_burst",
      "scale_drama",
      "diagonal_energy",
    ],
  },
  dataflow: {
    id: "dataflow",
    centerIdea:
      "high-speed data pipeline hologram: ingest → transform → retrieve → generate → guardrail stages with luminous packet trails",
    coverFraming:
      "storyboard cover — person rides the narrative spine of the pipeline with big title",
    preferredHooks: [
      "diagonal_energy",
      "critical_path_glow",
      "depth_tunnel",
      "bridge_gap",
    ],
  },
};

const PRESET_TOPIC_HINTS: Array<{ re: RegExp; preset: ImageVisualPreset }> = [
  {
    re: /\b(multi[- ]?agent|agentic|orchestrat|swarm|crew|tool[- ]?call)\b/i,
    preset: "agents",
  },
  {
    re: /\b(rag|retriev|vector|embedding|pipeline|etl|ingest|stream)\b/i,
    preset: "dataflow",
  },
  {
    re: /\b(langgraph|workflow|state\s*machine|graph|node)\b/i,
    preset: "workflow",
  },
  {
    re: /\b(infra|kubernetes|gateway|serving|latency|scalab|deploy|cloud)\b/i,
    preset: "infrastructure",
  },
  {
    re: /\b(eval|benchmark|test|observ|monitor|cicd|mlops)\b/i,
    preset: "engineering",
  },
];

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Short, punchy cover heading from post title (on-image text).
 * Kept short so models render readable letters.
 */
export function titleToCoverHeading(title: string, maxLen = 52): string {
  let t = title
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[|/·•]+/g, " — ")
    .replace(/\s+/g, " ")
    .trim();

  // Drop common blog fluff prefixes
  t = t
    .replace(/^(introducing|announcing|how to|how\s+|why\s+|what is)\s+/i, "")
    .trim();

  if (t.length <= maxLen) return t;

  // Prefer cut at word boundary
  const slice = t.slice(0, maxLen - 1);
  const sp = slice.lastIndexOf(" ");
  const cut = sp > 20 ? slice.slice(0, sp) : slice;
  return cut.trimEnd() + "…";
}

/**
 * Topic → visual concepts (tech DNA behind the person).
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
      "what",
      "when",
      "where",
      "which",
      "will",
      "can",
      "just",
      "more",
      "than",
      "also",
      "have",
      "been",
      "were",
      "was",
      "are",
      "is",
      "its",
      "their",
      "they",
      "we",
      "us",
      "maqola",
      "yangilik",
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
    if (unique.length >= 12) break;
  }

  const concepts = unique
    .join(", ")
    .replace(/\bGemini\b/gi, "language model")
    .replace(/\bFlash\b/gi, "fast model")
    .replace(/\bGPT-?[0-9.]*\b/gi, "language model")
    .replace(/\bClaude\b/gi, "assistant model")
    .replace(/\bOpenAI\b/gi, "AI lab")
    .replace(/\bTraffic\b/gi, "network flow")
    .replace(/\bBanana\b/gi, "image model")
    .slice(0, 200);

  if (!concepts) {
    return "AI agents, orchestration, knowledge retrieval, automation pipelines";
  }
  return concepts;
}

export function topicToCoverNarrative(
  title: string,
  heading: string,
  concepts: string,
  hook: ImageCompositionHook,
): string {
  const hookLine = HOOKS[hook].eyeCatch;
  return (
    `Premium personal-brand social cover for AI Engineering. ` +
    `On-image heading must read exactly: "${heading}". ` +
    `Post topic: ${title.replace(/\s+/g, " ").trim().slice(0, 120)}. ` +
    `Background system visual encodes: ${concepts}. ` +
    `Attention: ${hookLine}. ` +
    `Include a real professional person, crisp heading text, and brand logo.`
  );
}

export function pickImagePreset(
  seed: string,
  force?: ImageVisualPreset | string,
): ImageVisualPreset {
  const f = (force || "").toLowerCase().trim();
  if (f && PRESET_ALIASES[f]) return PRESET_ALIASES[f];

  for (const { re, preset } of PRESET_TOPIC_HINTS) {
    if (re.test(seed)) return preset;
  }

  const h = hashSeed(seed + "|" + new Date().toISOString().slice(0, 10));
  return IMAGE_PRESETS[h % IMAGE_PRESETS.length];
}

export function pickCompositionHook(
  seed: string,
  preset: ImageVisualPreset,
  force?: ImageCompositionHook | string,
): ImageCompositionHook {
  const f = (force || "").toLowerCase().trim() as ImageCompositionHook;
  if (f && HOOKS[f]) return f;

  const preferred = PRESETS[preset].preferredHooks;
  const h = hashSeed(seed + "|hook|" + preset);
  return preferred[h % preferred.length];
}

/** Shared MUST blocks: person + heading + logo */
function buildMustHaveBlocks(heading: string): string[] {
  const { name, shortName, monogram } = brandCoverMarks;
  return [
    `MUST HAVE #1 — PERSON: one professional adult (AI engineer / tech founder look), sharp facial features, confident calm expression, modern smart-casual or dark tech attire with subtle teal accent, cinematic portrait lighting, waist-up or three-quarter, photoreal premium quality. Person is a main attention anchor — not a tiny background figure.`,
    `MUST HAVE #2 — HEADING TEXT: render crisp, perfectly legible cover title in clean modern sans-serif (Inter / SF Pro style). Exact words in double quotes: "${heading}". High contrast white or soft white-to-cyan gradient letters, optional thin teal underline or soft glow. Large hierarchy — readable on mobile thumbnails. No misspellings, no extra words, no lorem ipsum, no random glyphs.`,
    `MUST HAVE #3 — LOGO: brand mark top-left (or top safe corner): geometric monogram "${monogram}" inside a rounded square badge filled brand teal #036158 with white "${monogram}" letters, plus small wordmark "${name}" or "${shortName}" in clean white sans next to it. Sharp, intentional brand logo — not a watermark, not a stock icon, not a third-party company logo.`,
  ];
}

/**
 * Build premium social-cover prompt WITH person + heading + logo.
 */
export function buildPremiumImagePrompt(
  topicTitle: string,
  topicHint?: string,
  options?: {
    preset?: ImageVisualPreset | string;
    composition?: ImageCompositionHook | string;
    /** Override on-image heading (defaults from title). */
    heading?: string;
  },
): {
  prompt: string;
  preset: ImageVisualPreset;
  composition: ImageCompositionHook;
  heading: string;
} {
  const concepts = topicToVisualConcepts(topicTitle, topicHint);
  const heading =
    (options?.heading && options.heading.trim()) ||
    titleToCoverHeading(topicTitle);
  const seed = topicTitle + "|" + (topicHint || "") + "|" + concepts + "|" + heading;
  const preset = pickImagePreset(seed, options?.preset);
  const composition = pickCompositionHook(seed, preset, options?.composition);
  const p = PRESETS[preset];
  const hook = HOOKS[composition];
  const narrative = topicToCoverNarrative(
    topicTitle,
    heading,
    concepts,
    composition,
  );
  const must = buildMustHaveBlocks(heading);

  // ── Lead (Horde-safe head; strongest requirements first) ───────────────
  const lead = [
    `Scroll-stopping ultra-premium editorial social media cover, square 1:1, magazine/LinkedIn grade, photoreal person + bold title + brand logo.`,
    `Dark premium tech backdrop: deep indigo-black (#0A0A0C) with subtle teal ambient glow and faint micro-grid — cinematic void, not a messy room.`,
    must[0],
    must[1],
    must[2],
    `TECH VISUAL (behind/beside person): ${p.centerIdea}. Topic DNA: ${concepts}.`,
    `COMPOSITION (${hook.label}): ${hook.layout}.`,
    `Eye-catch: ${hook.eyeCatch}.`,
    `${p.coverFraming}.`,
    `Colors: brand teal #036158, cyan #5EEAD4 glows, white heading, deep black field, optional amber #F59E0B single accent.`,
    `Style: premium keynote × Behance tech poster × cinematic portrait — sharp, modern, trustworthy.`,
  ].join(" ");

  // ── Extended ───────────────────────────────────────────────────────────
  const extended = [
    ``,
    `Cover narrative:`,
    narrative,
    ``,
    `Layout zones (required):`,
    `- TOP: large HEADING "${heading}" — 1–2 lines max, perfect kerning, razor-sharp letters.`,
    `- CORNER: LOGO monogram "${brandCoverMarks.monogram}" + "${brandCoverMarks.shortName}" wordmark.`,
    `- MAIN: professional PERSON interacting with or standing before the tech visual.`,
    `- SECONDARY: glowing system diagram related to ${concepts} — supports story, does not cover face or title.`,
    ``,
    `Text rendering quality (critical):`,
    `- Only the heading and logo text — no body paragraphs, no fake UI chrome, no random captions.`,
    `- Letters must be correct English spelling of: "${heading}".`,
    `- Avoid warped, melted, or gibberish typography; prefer bold geometric sans.`,
    ``,
    `Person quality:`,
    `- Natural skin, sharp eyes, professional presence; looks like a real AI engineer creator brand.`,
    `- No crowd, no extra people, no celebrity lookalikes, no hands covering the face.`,
    ``,
    `Attention design:`,
    `- 0.3s stop: face + big title silhouette wins the feed.`,
    `- Then logo + glowing system reward a longer look.`,
    `- High contrast, clean margins (~8%), no cluttered corners.`,
    ``,
    `Hard avoid: dirty office mess, chaotic furniture pile, cartoon/anime, stickers, low-res, blurry face, rainbow neon spam, third-party logos (Google/OpenAI/etc), watermarks, QR codes, unreadable gibberish text, extra random words, misspelled title.`,
  ].join("\n");

  let full = (lead + "\n" + extended).trim();
  if (full.length > 3000) {
    full = full.slice(0, 2990).trimEnd();
  }
  return { prompt: full, preset, composition, heading };
}
