/**
 * Premium social-cover image prompts (Nano Banana / Skywork).
 *
 * Goal: scroll-stopping LinkedIn/Telegram covers with:
 *  1) PEOPLE — professional human figure (attention + trust)
 *  2) HEADING — readable on-image title text
 *  3) topic-true tech visual (diagram / system metaphor)
 *
 * Brand colors: see `BRAND_COLORS` in config/brand.ts — teal + cyan.
 * Length target: ≤ 2800 chars (Nano Banana truncates ~2500; identity must survive lead).
 * Provider pipeline: UnoRouter → Nano Banana → Skywork → xKiro.
 *
 * xKiro has no face reference, so it cannot render the brand portrait. It used
 * to compensate by drawing a technical flowchart on every single cover, which
 * was accurate but visually identical post after post. It now rotates across
 * three renderings of the same topic — editorial scene, physical metaphor and
 * technical diagram — see `buildEngagingImagePrompt`.
 */
import {
  identityClause,
  antiPoseClause,
  facialHairAvoidTerms,
} from "./brandIdentity.js";
import { BRAND_COLORS } from "./brand.js";

/**
 * Image palette, derived from the brand's single declared palette.
 *
 * This used to be a second, independent copy of the same hexes. Nothing read
 * either one — the values only ever reached a prompt as literals inside the
 * prose below — so a change to `brand.colors` would have left every generated
 * cover on the old palette with no error and no test failure. Deriving them
 * keeps the prose honest.
 */
export const brandImageColors = {
  primary: BRAND_COLORS.primary,
  secondaryWhite: BRAND_COLORS.accent,
  darkGray: BRAND_COLORS.secondary,
  black: BRAND_COLORS.background,
  accentCyan: BRAND_COLORS.accentCyan,
  hotAmber: BRAND_COLORS.hotAmber,
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
    label: "epic scale drama",
    layout:
      "SCALE DRAMA: large professional person on the right third (waist-up), oversized glowing 3D holographic tech diagram on the left/center behind them; massive size contrast — person + one colossal, monumental system node dominate the frame with cyberpunk neon lighting",
    eyeCatch:
      "human face + giant luminous system = breathtaking cinematic thumb-stop",
  },
  diagonal_energy: {
    id: "diagonal_energy",
    label: "diagonal energy",
    layout:
      "DIAGONAL FLOW: person lower-left looking toward upper-right; blindingly bright teal data streams slash diagonally past them into an intricate tech diagram; heading sits along the top edge of the energy blast",
    eyeCatch:
      "intense kinetic energy — eye travels person → light beam → heading",
  },
  radial_burst: {
    id: "radial_burst",
    label: "radial burst",
    layout:
      "RADIAL BURST: person slightly off-center with a shockwave of cyan signal rays bursting outward from a glowing core near their hands; dynamic, explosive energy filling the dark space",
    eyeCatch:
      "high-contrast explosive tech burst + human anchor = intense curiosity",
  },
  depth_tunnel: {
    id: "depth_tunnel",
    label: "depth tunnel",
    layout:
      "DEPTH TUNNEL: person in hyper-sharp foreground, infinite AI pipeline tunnel glowing and receding into the absolute black background; immense sense of scale and depth",
    eyeCatch:
      "infinite optical depth pulls viewer directly into the tech story",
  },
  asymmetric_thirds: {
    id: "asymmetric_thirds",
    label: "rule of thirds",
    layout:
      "RULE OF THIRDS: person on left power point bathed in dramatic rim light, complex holographic diagram on right third, vast dark negative space between them for extreme tension; huge typography",
    eyeCatch:
      "ultra-premium editorial magazine layout — moody, minimalist, expensive",
  },
  critical_path_glow: {
    id: "critical_path_glow",
    label: "critical path",
    layout:
      "CRITICAL PATH: person gazes intensely at a single blazing cyan pathway carving through a dark, shadowy system metropolis; the glowing path illuminates their face",
    eyeCatch:
      "masterful storytelling — viewer's eye is forced to follow the blazing light",
  },
  bridge_gap: {
    id: "bridge_gap",
    label: "bridge gap",
    layout:
      "BRIDGE: person stands as a towering bridge between two massive floating tech clusters; a high-voltage luminous arc connects the two sides passing behind the person",
    eyeCatch:
      "heroic scale — human as the ultimate architect of complex systems",
  },
  orbital_constellation: {
    id: "orbital_constellation",
    label: "orbital constellation",
    layout:
      "ORBITAL: person centered-lower with elegant, glowing agent/module orbits rotating around the upper half in a beautiful celestial tech constellation; deep space black background",
    eyeCatch:
      "gorgeous sci-fi aesthetics mixed with a sharp professional portrait",
  },
};

const PRESETS: Record<ImageVisualPreset, PresetSpec> = {
  workflow: {
    id: "workflow",
    centerIdea:
      "a cinematic multi-agent workflow hologram: immense floating decision hubs, glowing high-voltage handoff arcs, an orchestrator block pulsing like a system brain in deep cyber space",
    coverFraming:
      "epic LinkedIn/Telegram square cover with person + massive typography",
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
      "monumental layered infrastructure hologram: monolithic gateways, caches, and model-serving lattices rendered as colossal architectural slabs of light",
    coverFraming:
      "high-end tech-magazine cover — person in sharp foreground, monolithic stack behind, gigantic bold heading",
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
      "precision engineering cycle hologram: colossal interlocking neon arcs of build → evaluate → deploy, with one stage blazing super-bright as the active phase",
    coverFraming:
      "dramatic product launch cover — person + epic ring diagram + title",
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
      "ONE professional person (the brand expert, face visible, waist-up) gesturing toward a living, breathing agent-swarm hologram — maximum 5 distinct geometric floating agent cores around an orchestrator brain with thick teal energy beams. Person is the visual anchor bathed in dramatic light.",
    coverFraming:
      "premium personal brand cover — cinematic person + swarm hologram + ultra-massive headline",
    preferredHooks: [
      "orbital_constellation",
      "scale_drama",
      "diagonal_energy",
      "critical_path_glow",
    ],
  },
  dataflow: {
    id: "dataflow",
    centerIdea:
      "ONE professional person (brand expert, face visible, waist-up) riding the epic narrative spine of a high-speed data pipeline hologram — massive data streams blasting through ingest → transform → retrieve stages with blinding packet trails.",
    coverFraming:
      "cyberpunk storyboard cover — person + huge blazing data pipeline + gigantic title",
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

/** Default on-image title budget — short = readable + premium on mobile. */
export const COVER_HEADING_MAX_LEN = 32;
/** Prefer 2–6 words for power headlines. */
export const COVER_HEADING_MAX_WORDS = 5;

const HEADING_STOP = new Set(
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
    "what",
    "when",
    "your",
    "you",
    "our",
    "this",
    "that",
    "into",
    "using",
    "va",
    "uchun",
    "bilan",
    "yoki",
    "ham",
    "shu",
    "bu",
    "esa",
    "deb",
    "da",
    "ga",
    "ni",
    "ning",
  ].map((w) => w.toLowerCase()),
);

/**
 * Short, punchy cover heading for on-image text.
 * Goal: 2–5 strong words, ~≤32 chars — large premium type, not a paragraph.
 */
export function titleToCoverHeading(
  title: string,
  maxLen = COVER_HEADING_MAX_LEN,
): string {
  let t = title
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[|/·•]+/g, " ")
    .replace(/[?!…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Drop blog fluff / weak openers (EN + UZ).
  // The leading verbs are here because a cover headline reads better as the
  // subject than as the act: "Agent-friendly pages" beats "Making agent-friendly".
  t = t
    .replace(
      /^(introducing|announcing|making|building|creating|designing|writing|how to|how\s+|why\s+|what is|a playbook for|the complete guide to)\s+/i,
      "",
    )
    .replace(/^(yangi\s+maqola[:\s]+|maqola[:\s]+)/i, "")
    .replace(
      /^(ishlab\s+chiqarishda|productionda|amaliyotda|bugun|endi|nima\s+uchun|qanday\s+)/i,
      "",
    )
    .replace(/\s+(qanday\s+ishlaydi|nima\s+uchun\s+muhim)\??$/i, "")
    // Subtitle separators must be SPACED.
    //
    // A bare hyphen is almost always part of a compound — "agent-friendly",
    // "GPU-Resident", "state-of-the-art". Treating it as a separator cut
    // "Making agent-friendly pages with content negotiation" down to the
    // on-image headline "Making Agent": a meaningless fragment printed in large
    // type on the cover. Only a colon or a *spaced* dash introduces a subtitle.
    .replace(/\s*[:;]\s+.*$/, "")
    .replace(/\s+[—–]\s+.*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .trim();

  // Prefer first clause if sentence is long
  const clause = t.split(/[.!?]/)[0]?.trim() || t;
  t = clause;

  const words = t
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9oʻgʻOʻGʻ']+|[^A-Za-z0-9oʻgʻOʻGʻ']+$/gi, ""))
    .filter(Boolean);

  if (!words.length) return "AI Engineering";

  // Greedy fit over the ORIGINAL word order, so the phrase stays grammatical.
  //
  // The previous version filtered the glue words out and then concatenated what
  // was left, which silently rewrote the phrase: "…pages with content" became
  // "…pages content". Keeping order and stopping at the budget reads correctly.
  const kept: string[] = [];
  for (const w of words) {
    if (kept.length >= COVER_HEADING_MAX_WORDS) break;
    const next = [...kept, w].join(" ");
    if (next.length > maxLen && kept.length) break;
    kept.push(w);
  }
  // Never end on a glue word — "…pages with" is not a headline.
  while (
    kept.length > 1 &&
    HEADING_STOP.has(kept[kept.length - 1].toLowerCase())
  ) {
    kept.pop();
  }

  // A cover headline is a label, not a sentence, so drop a leading determiner.
  // On a long title the greedy fit stops mid-phrase, and "A production-grade
  // retrieval" reads as a broken fragment where "Production-grade retrieval"
  // reads as a subject. Same rule as the glue-word trim above, at the other end.
  if (kept.length > 1 && /^(a|an|the)$/i.test(kept[0])) kept.shift();

  t = kept.join(" ").trim();
  if (!t) t = "AI Engineering";

  // Sentence case. Premium editorial covers do not Title Case every word, and
  // doing so produced mid-phrase capitals like "Pages With Content".
  t = t
    .split(" ")
    .map((w, i) => {
      if (/^[A-Z0-9+.-]{2,}$/.test(w)) return w; // API, RAG, GPT-4
      if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1);
      return w;
    })
    .join(" ");

  if (t.length <= maxLen) return t;

  // Hard cut at word boundary — no ugly mid-word; avoid "…" when possible
  const slice = t.slice(0, maxLen);
  const sp = slice.lastIndexOf(" ");
  const cut = sp >= 8 ? slice.slice(0, sp) : slice.trimEnd();
  return cut.replace(/[.,;:]+$/, "").trim();
}

/** Heuristic: Latin-script Uzbek (oʻ/gʻ marks + common function words). */
export function looksLikeUzbekLatin(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  // Cyrillic → not our target script for covers
  if (/[\u0400-\u04FF]/.test(t)) return false;
  // Apostrophe letters common in Latin Uzbek
  if (/[oʻoʼʻʼ'‘’]g|[gʻgʼʻʼ'‘’]|o'|g'/i.test(t)) {
    return true;
  }
  const hits = (
    t.match(
      /\b(va|uchun|bilan|yoki|qanday|nima|qachon|kerak|mumkin|emas|ham|shu|bu|endi|juda|yaxshi|muhim|asosiy|qadam|tizim|ishlab|chiqarish|saqlash|agentlar|zanjiri|boshqar)\w*\b/gi,
    ) || []
  ).length;
  return hits >= 2;
}

/**
 * Prefer short power heading for covers (Latin Uzbek when possible).
 * 1) explicit options.heading
 * 2) first hook line from rewritten post (compressed to power phrase)
 * 3) title compressed
 */
export function pickCoverHeading(input: {
  title: string;
  rewritten?: string;
  heading?: string;
  maxLen?: number;
}): string {
  const maxLen = input.maxLen ?? COVER_HEADING_MAX_LEN;
  if (input.heading?.trim()) {
    return titleToCoverHeading(input.heading.trim(), maxLen);
  }

  const body = (input.rewritten || "").trim();
  if (body) {
    // First non-empty lines = post hook (already Uzbek from rewrite node)
    const lines = body
      .split(/\n+/)
      .map((l) =>
        l
          .replace(/^[#>*\-\d.)\s]+/, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*\n]+)\*/g, "$1")
          .replace(/`([^`]+)`/g, "$1")
          .replace(/^Asosiy faktlar:.*$/i, "")
          .replace(/https?:\/\/\S+/gi, "")
          .trim(),
      )
      .filter((l) => l.length >= 8 && !/^manba\b/i.test(l));

    for (const line of lines.slice(0, 4)) {
      // Skip pure English tech dump lines
      if (looksLikeUzbekLatin(line) || !/^[A-Za-z0-9 ,.:;+\-/()]+$/.test(line)) {
        return titleToCoverHeading(line, maxLen);
      }
    }
    if (looksLikeUzbekLatin(body.slice(0, 400)) && lines[0]) {
      return titleToCoverHeading(lines[0], maxLen);
    }
  }

  const title = (input.title || "").trim();
  return titleToCoverHeading(title || "AI Engineering", maxLen);
}

/** Explicit body/camera poses — rotated so face ref does not freeze one pose. */
export type ImagePoseId =
  | "three_quarter_gesture_right"
  | "arms_crossed_confident"
  | "pointing_critical_path"
  | "open_hands_explain"
  | "chin_down_side_think"
  | "frame_hologram_hands"
  | "shoulder_cam_look_lens"
  | "step_in_profile_glance";

export const IMAGE_POSES: ImagePoseId[] = [
  "three_quarter_gesture_right",
  "arms_crossed_confident",
  "pointing_critical_path",
  "open_hands_explain",
  "chin_down_side_think",
  "frame_hologram_hands",
  "shoulder_cam_look_lens",
  "step_in_profile_glance",
];

type PoseSpec = {
  id: ImagePoseId;
  label: string;
  body: string;
};

const POSES: Record<ImagePoseId, PoseSpec> = {
  three_quarter_gesture_right: {
    id: "three_quarter_gesture_right",
    label: "three-quarter + gesture",
    body: "waist-up, torso angled ~35° to camera-right, right hand open gesturing toward the tech hologram, left arm relaxed, chin slightly up, eyes toward hologram then soft catch-light",
  },
  arms_crossed_confident: {
    id: "arms_crossed_confident",
    label: "arms crossed",
    body: "waist-up, arms lightly crossed (confident mentor), shoulders square-ish but not stiff, head turned 15° toward camera, calm half-smile, hologram glows beside him",
  },
  pointing_critical_path: {
    id: "pointing_critical_path",
    label: "pointing path",
    body: "three-quarter view, index finger pointing at a glowing critical path in the diagram (not at camera), focused expression, other hand near waist, dynamic editorial stance",
  },
  open_hands_explain: {
    id: "open_hands_explain",
    label: "teaching hands",
    body: "both hands open at mid-chest as if explaining a system, body 20° left, looking just past camera (presenter energy), friendly professional expression",
  },
  chin_down_side_think: {
    id: "chin_down_side_think",
    label: "side think",
    body: "profile-ish three-quarter, chin slightly down toward a floating node, one hand near chin/jaw (thinking mentor), contemplative not sad, side key light",
  },
  frame_hologram_hands: {
    id: "frame_hologram_hands",
    label: "frame hologram",
    body: "hands framing or holding a small holographic panel in front of torso, looking at panel then camera, inventive engineer vibe, elbows out slightly",
  },
  shoulder_cam_look_lens: {
    id: "shoulder_cam_look_lens",
    label: "look at lens",
    body: "over-shoulder composition: body turned away 40°, head rotated back to look straight into lens, one shoulder closer to camera, intimate premium portrait energy with tech behind",
  },
  step_in_profile_glance: {
    id: "step_in_profile_glance",
    label: "step-in glance",
    body: "walking-into-frame energy (frozen mid-step), side stance, head glancing toward camera over near shoulder, one hand slightly forward, cinematic motion without blur",
  },
};

export function pickImagePose(
  seed: string,
  force?: ImagePoseId | string,
): ImagePoseId {
  const f = (force || "").toLowerCase().trim() as ImagePoseId;
  if (f && POSES[f]) return f;
  const h = hashSeed(seed + "|pose");
  return IMAGE_POSES[h % IMAGE_POSES.length];
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
  faceRef: boolean,
  pose?: ImagePoseId,
): string {
  const hookLine = HOOKS[hook].eyeCatch;
  const poseLine = pose
    ? `Pose recipe (${POSES[pose].label}): ${POSES[pose].body}.`
    : "";
  const personLine = faceRef
    ? `MANDATORY: ONE professional person (face from face.jpg reference — same likeness, NEW pose) MUST be prominently visible in the cover.`
    : `MANDATORY: ONE professional adult person MUST be prominently visible in the cover — face sharp, waist-up, editorial.`;
  return (
    `Premium personal-brand social cover for AI Engineering. ` +
    `On-image power title MUST match exactly these words in quotes (nothing else): "${heading}". ` +
    `Title style: short, bold, elegant — one line, huge type. ` +
    `Post topic: ${title.replace(/\s+/g, " ").trim().slice(0, 120)}. ` +
    `Background system visual encodes: ${concepts}. ` +
    `Attention: ${hookLine}. ` +
    `${personLine} ${poseLine} Full-bleed scene, sharp short title only, NO brand logo monogram.`
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

/** Shared MUST blocks: person + heading + full-bleed (no IO logo). */
function buildMustHaveBlocks(
  heading: string,
  faceRef: boolean,
  pose: ImagePoseId,
): string[] {
  const poseSpec = POSES[pose];
  // NOTE: the identity wording and the anti-pose rule live ONCE, in the [IDENTITY]
  // lead block that precedes this one, and the pose is stated here — so the
  // separate [POSE LOCK] block was pure duplication. Repeating them pushed the
  // P0 block set past the prompt budget, which silently cut [TECH VISUAL],
  // [COMPOSITION] and [EYE-CATCH] off the end (see the assembly code below).
  const personBlock = faceRef
    ? `[MANDATORY PERSON — IDENTITY + NEW POSE]: MUST appear — the SAME person as face.jpg (see [IDENTITY] above), face prominently visible (minimum 25% of canvas), waist-up. NEW POSE — ${poseSpec.label}: ${poseSpec.body}. Outfit: dark smart-casual with teal accent. Dramatic cinematic key light on the face. Sharp, highly detailed editorial portrait.`
    : `[MANDATORY PERSON + POSE]: MUST appear — one professional adult (AI engineer vibe, sharp face, modern attire), prominently visible waist-up (minimum 25% of canvas). Integrated INTO the scene with the tech hologram — full-bleed editorial, NOT a flat cutout. Pose — ${poseSpec.label}: ${poseSpec.body}. Teal accent outfit, extreme dramatic cinematic lighting making the face pop against the dark background.`;

  return [
    `[FULL-BLEED CANVAS] The final image IS the cover — edge-to-edge 1:1. NOT a framed poster or picture frame on a wall, NOT a phone/laptop/browser mockup, NOT a double border, matte or polaroid card.`,
    personBlock,
    // Do NOT put language names as visual title hints — models paint them as literal cover text.
    `[TITLE TEXT] ONE line only. Spell exactly, character by character: "${heading}". Ultra-massive premium sans-serif, extreme high contrast white/cyan on black, tight tracking. Latin letters only — no paraphrase, no subtitle, no second line, no gibberish.`,
    `[NO LOGO] No IO/IstamAI monogram, badge or watermark. Never paint language/meta labels (forbidden words on image: Uzbek, Oʻzbek, Latin, English, Cyrillic).`,
  ];
}

/**
 * Build premium social-cover prompt: person + Uzbek heading, full-bleed, NO logo.
 * When faceRef=true: identity from face.jpg + rotated NEW pose (not reference pose).
 */
export function buildPremiumImagePrompt(
  topicTitle: string,
  topicHint?: string,
  options?: {
    preset?: ImageVisualPreset | string;
    composition?: ImageCompositionHook | string;
    pose?: ImagePoseId | string;
    /** Override on-image heading (Uzbek Latin preferred). */
    heading?: string;
    /** Rewritten Uzbek post body — used to derive cover heading. */
    rewritten?: string;
    /** Reference face available (data/brand/face.jpg). */
    faceRef?: boolean;
  },
): {
  prompt: string;
  preset: ImageVisualPreset;
  composition: ImageCompositionHook;
  pose: ImagePoseId;
  heading: string;
} {
  const faceRef = Boolean(options?.faceRef);
  const concepts = topicToVisualConcepts(topicTitle, topicHint);
  const heading = pickCoverHeading({
    title: topicTitle,
    rewritten: options?.rewritten,
    heading: options?.heading,
    maxLen: COVER_HEADING_MAX_LEN,
  });
  const seed =
    topicTitle +
    "|" +
    (topicHint || "") +
    "|" +
    concepts +
    "|" +
    heading +
    "|" +
    (options?.rewritten || "").slice(0, 80);
  const preset = pickImagePreset(seed, options?.preset);
  const composition = pickCompositionHook(seed, preset, options?.composition);
  const pose = pickImagePose(seed, options?.pose);
  const p = PRESETS[preset];
  const hook = HOOKS[composition];
  const poseSpec = POSES[pose];
  const narrative = topicToCoverNarrative(
    topicTitle,
    heading,
    concepts,
    composition,
    faceRef,
    pose,
  );
  const must = buildMustHaveBlocks(heading, faceRef, pose);

  // ── Prompt assembly (priority-ordered) ─────────────────────────────────
  // Blocks are appended in priority order and the loop stops BEFORE the budget
  // would be exceeded, so the prompt is never cut mid-sentence.
  //
  // The previous implementation built one giant `lead` and then either kept it
  // whole or sliced it at an arbitrary character offset. Because the lead had
  // grown past the budget, it was silently chopping off [COMPOSITION],
  // [EYE-CATCH] and [STYLE/COLORS] — every cover got the same composition and
  // lost its palette instructions, while the code still reported success. The
  // cover *looked* fine, so nobody noticed.
  //
  // 2800 chars: Nano Banana truncates around 2500, so identity + title must sit
  // in the first blocks.
  const MAX_PROMPT = 2800;

  // Identity block goes first: Nano Banana (Gemini) truncates long prompts, and
  // identity is the one requirement that must never be the part that gets lost.
  const faceLead = faceRef
    ? `[IDENTITY] REFERENCE IMAGE: face.jpg = ORIGINAL FACE REFERENCE. Preserve exact facial identity: ${identityClause()}. ${antiPoseClause()}`
    : "";

  // P0 — never dropped: identity, full-bleed, person, title, logo ban, pose, palette.
  const criticalBlocks = [
    faceLead,
    `Scroll-stopping ultra-premium FULL-BLEED social media cover, square 1:1, LinkedIn/Telegram ready — the canvas itself is the cover, not a framed photo.`,
    must[0], // [FULL-BLEED CANVAS]
    must[1], // [IDENTITY + NEW POSE] or [PERSON + POSE]
    must[2], // [TITLE TEXT] exact heading
    must[3], // [NO LOGO]
    // (No [POSE LOCK] block: personBlock above already carries the pose recipe.)
    `[STYLE/COLORS]: brand teal ${brandImageColors.primary}, cyan ${brandImageColors.accentCyan}, white title text, deep black field. Apple keynote hero + Behance tech editorial — sharp, modern, NO frames, NO logos.`,
  ].filter(Boolean);

  // P1 — visual variety. This is what stops every cover looking identical, so it
  // ranks above the supporting rules.
  const visualBlocks = [
    `[TECH VISUAL] (same 3D space as person, holographic layers): ${p.centerIdea}. Topic DNA: ${concepts}.`,
    `[COMPOSITION (${hook.label})]: ${hook.layout}.`,
    `[EYE-CATCH]: ${hook.eyeCatch}.`,
    `${p.coverFraming}.`,
  ].filter(Boolean);

  // P2 — supporting rules, added only while they fit (least important last).
  const supportingBlocks = [
    `Hard avoid: ${facialHairAvoidTerms()}same pose as face.jpg, picture frame, poster on wall, phone/laptop mockup, double border, IO/monogram/IstamAI logo, watermarks, third-party logos, QR, cartoon, anime, painting the words Uzbek/Oʻzbek/Latin/English/Cyrillic, misspelled/gibberish text, any title not equal to the quoted heading, more than 5 agent nodes, duplicate node labels, missing person.`,
    `Framing rules: full bleed to all edges (zero picture-frame, zero white margin card); person and holograms in ONE continuous scene with the same light and depth; title is an on-canvas overlay only, never paper inside a frame; absolutely no IO / IstamAI / monogram logo anywhere.`,
    `Text rule: the ONLY readable words on the image are exactly "${heading}" — no subtitle, no other labels, no language names, no logo text, no gibberish.`,
    `Layout zones: TOP band = POWER TITLE "${heading}" (single line, oversized); MAIN = person in pose "${poseSpec.label}" + tech hologram mid-ground; generous negative space around the title; no nested rectangles, no poster-on-wall, no device bezel.`,
    faceRef
      ? `[IDENTITY vs POSE] face.jpg = FACE ONLY (ORIGINAL FACE REFERENCE); high likeness required, identity only. New pose (${poseSpec.label}). UnoRouter, Nano Banana and Skywork all receive this reference; xKiro does not (it gets a face-free scene instead).`
      : `Person: photoreal professional AI creator vibe. ONE person only. Pose: ${poseSpec.label}.`,
    `Cover narrative: ${narrative}`,
  ].filter(Boolean);

  const parts: string[] = [];
  let used = 0;
  const addBlock = (block: string): boolean => {
    const cost = block.length + 1; // +1 for the joining space
    if (used + cost > MAX_PROMPT) return false;
    parts.push(block);
    used += cost;
    return true;
  };

  // Strict priority order: the FIRST block that does not fit ends assembly.
  // (Skipping it and continuing would let a low-priority block in while a
  // higher-priority one was dropped — which is how [TECH VISUAL] used to vanish
  // while "Hard avoid" still made it into the prompt.)
  let saturated = false;
  for (const b of [...criticalBlocks, ...visualBlocks, ...supportingBlocks]) {
    if (saturated) break;
    if (!addBlock(b)) saturated = true;
  }

  const full = parts.join(" ").trim();

  if (full.length > MAX_PROMPT) {
    // Only reachable if the P0 blocks alone exceed the budget — a real
    // configuration error, so say so instead of shipping a truncated prompt.
    console.warn(
      `[imagePrompt] P0 blocks exceed ${MAX_PROMPT} chars (${full.length}) — ` +
        `shorten BRAND_IDENTITY_DESCRIPTION or the pose/heading text.`,
    );
  }

  return { prompt: full, preset, composition, pose, heading };
}

/**
 * Shared visual style for BOTH diagram prompts:
 *   buildSchematicImagePrompt → providers 1–3 when no face is available
 *   buildWorkflowImagePrompt  → xKiro (absolute last resort)
 *
 * Flat and restrained, deliberately. The previous wording asked for "2–3 heavily
 * blurred teal/cyan orbs", "layered depth" and "soft diffuse shadows so panels
 * float", and then also banned excessive glow. That is a contradiction, and a
 * model resolves it by over-serving the positive instructions — which is exactly
 * the over-rendered, exaggerated look that shipped. Every positive line below is
 * something a print designer would actually do; every effect is a named negative.
 */
const GLASS_STYLE = [
  `[STYLE] Premium editorial infographic — matte, never glossy. Cards are solid panels a few percent lighter than the backdrop, 12–16px radius, one hairline border.`,
  `Background: near-black ${brandImageColors.black} with at most ONE very soft teal ${brandImageColors.primary} wash in a corner at low opacity.`,
  `Restraint IS the premium signal: generous empty space, no decoration, no filler icons; one accent colour — teal ${brandImageColors.primary}, cyan ${brandImageColors.accentCyan} only on the single highlighted path, amber ${brandImageColors.hotAmber} only on a decision node.`,
  `[FORBIDDEN EFFECTS] No glow, no bloom, no neon, no lens flare, no light streaks, no bokeh, no particles, no sparkles, no swirls, no 3D perspective, no bevel, no emboss, no stacked drop shadows, no reflections, no gradient mesh, no motion blur, no cyberpunk styling.`,
].join(" ");

/**
 * Legibility contract.
 *
 * The single biggest cause of a garbled diagram is text the model cannot fit:
 * too many labels, set too small, sometimes rotated or drawn in perspective. A
 * cover is read at thumbnail size in a feed, so the fix is fewer, larger, flatter
 * labels — never more detail. The earlier prompts asked for up to eight nodes
 * PLUS a legend PLUS zone captions in a 1:1 square, which cannot be rendered
 * legibly and comes back as broken letterforms.
 */
const TYPOGRAPHY_RULES = [
  `[TYPOGRAPHY — MANDATORY] Every label is horizontal, upright, flat, one clean sans-serif. Never rotate, skew, arc, curve or perspective-warp text.`,
  `At most 5 node labels, each 1–2 words and at most ~14 characters, set LARGE. If a label would need to shrink to fit, use a shorter word; if it still cannot be set legibly, omit that node — never abbreviate into gibberish.`,
  `The title is the largest element on the canvas; node labels at least a quarter of the title's height.`,
  `No blur, glow or shadow behind any letter. Keep clear space around every label; never overlap a label with a line or an icon.`,
].join(" ");

/**
 * Shared accuracy contract for both diagram prompts.
 *
 * The node list is authoritative. Left to itself a model happily invents
 * plausible-but-wrong nodes (dropping the re-ranker, reversing an arrow, adding
 * a fake API name), which makes a technical cover look authoritative while being
 * factually wrong. These rules pin the topology down.
 */
const ACCURACY_RULES = [
  `[ACCURACY — MANDATORY] Draw EXACTLY the nodes below, in that order — never invent, merge, drop or duplicate one.`,
  `Every arrow follows real data/control flow and is labelled; no unreachable node, no orphan arrow; a backward arrow ONLY as a labelled retry loop.`,
  `Rounded rectangle = step, diamond = decision, dashed = async. No legend, no key, no caption block: extra micro-text is unreadable at feed size.`,
].join(" ");

/**
 * Topic → diagram topology. ONE routing table for both diagram prompts.
 *
 * Two defects lived in the old routing. First, the two builders each carried a
 * private copy, so they could disagree about the same article. Second, the match
 * ran against a comma-joined keyword soup in an order that let a broad keyword
 * win: "Making agent-friendly pages with content negotiation" contains "agent",
 * so it was drawn as a **multi-agent orchestrator** — a diagram of something the
 * article was not about. (The workflow builder did worse: it fell through to
 * "Input → Processing → AI Model → Output → Feedback".)
 *
 * Matching runs on the raw title + hint, most specific term first, and each
 * branch is capped at 5 nodes so every label can be set large.
 */
export type DiagramSubject = {
  /** Ordered node chain. At most 5 labels — see TYPOGRAPHY_RULES. */
  nodes: string;
  /** One sentence describing the flow, for the model's understanding. */
  detail: string;
  /** Optional grouping, at most two short labels. */
  zones?: string;
};

export function pickDiagramSubject(
  title: string,
  topicHint?: string,
): DiagramSubject {
  const raw = `${title} ${topicHint || ""}`.toLowerCase();

  // 1. Content negotiation / machine-readable web. Before the generic "agent"
  //    branch, because "content negotiation" is a precise term and "agent" is not.
  if (/content\s*negotiat|agent.?friendly|agentic web|accept header|markdown endpoint/.test(raw)) {
    return {
      nodes: "Agent Request → Accept Header → Server Route → Markdown Response",
      detail:
        "Content negotiation: the agent asks for markdown through the Accept header and the server returns the same content in a cheaper, cleaner format",
      zones: "Client (left): agent + Accept header; Server (right): router + renderer",
    };
  }

  // 2. Retrieval. Keeps the re-ranker: dropping it is the classic wrong RAG diagram.
  if (/rag|retriev|vector|embed|re-?rank|knowledge base|chunk/.test(raw)) {
    return {
      nodes: "Query → Embed → Vector Search → Re-rank → LLM Answer",
      detail:
        "Retrieval-augmented generation: embed the query, retrieve the top-k chunks, re-rank them, then answer from the assembled context",
      zones: "Query (left) → Retrieval (center) → Answer (right)",
    };
  }

  // 3. Multi-agent orchestration.
  if (/multi.?agent|swarm|crew|orchestrat|supervisor/.test(raw)) {
    return {
      nodes: "Request → Orchestrator → Worker Agents → Aggregate → Answer",
      detail:
        "Multi-agent orchestration: a supervisor plans, delegates to specialist workers, then aggregates their results; shared memory is read and written by every worker (dashed two-way link)",
      zones: "Supervisor (center) → Workers (ring) → Tools (outer)",
    };
  }

  // 4. LangGraph / state machine. The retry is drawn as a loop, not a line to END.
  if (/langgraph|state.?graph|state.?machine|conditional edge|checkpoint/.test(raw)) {
    return {
      nodes: "START → Agent Node → Tool Node → Router → END",
      detail:
        "LangGraph state machine: typed shared state, conditional edges, and a dashed retry loop from the router back to the agent node",
      zones: "State (top-left); Graph (center); Checkpointer (bottom-right)",
    };
  }

  // 5. MCP.
  if (/mcp|model.?context|tool.?call|function.?call|json.?rpc/.test(raw)) {
    return {
      nodes: "Host LLM → MCP Client → MCP Server → Tool Result",
      detail:
        "Model Context Protocol: the host's client talks to a server that exposes tools, resources and prompts over JSON-RPC",
      zones: "Host (left) → Bridge (center) → Servers (right)",
    };
  }

  // 6. Evaluation / observability.
  if (/eval|benchmark|llm.?judge|observab|tracing|trace|langsmith/.test(raw)) {
    return {
      nodes: "Eval Dataset → Model Under Test → LLM Judge → Report",
      detail:
        "Evaluation loop: run the dataset, score the responses with a judge, aggregate the metrics, then iterate on the weak cases",
      zones: "Data (left) → Inference (center) → Evaluation (right)",
    };
  }

  // 7. Deployment / serving.
  if (/deploy|infra|serving|latency|scale|k8s|kubernetes|gateway|throughput/.test(raw)) {
    return {
      nodes: "Client → Gateway → Model Server → Response Cache",
      detail:
        "Production AI serving: gateway, model servers and a response cache, with monitoring alongside",
      zones: "Edge (top) → Compute (middle) → Storage (bottom)",
    };
  }

  // 8. Web delivery / cost.
  if (/http|caching|cache|cdn|bandwidth|token cost|payload/.test(raw)) {
    return {
      nodes: "Request → Cache Check → Origin → Response",
      detail:
        "Request path with a cache in front of the origin, and the payload size that decides the token cost",
      zones: "Edge (left) → Origin (right)",
    };
  }

  // 9. Fallback. A three-node chain labelled with the topic's own leading
  //    concept — honest about being minimal, instead of the old generic
  //    "Input → Processing → AI Model → Output → Feedback", which pretended to
  //    be the article's architecture and was wrong for every article.
  const primary =
    topicToVisualConcepts(title, topicHint)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)[0] || "Request";
  return {
    nodes: `Request → ${primary.slice(0, 14)} → Response`,
    detail: `Minimal three-step flow for ${primary}. Keep it to three nodes and do NOT invent architecture the article does not describe`,
  };
}

/**
 * Character budget for the diagram prompts.
 *
 * Two tiers, deliberately:
 *  - The strictest provider (Nano Banana) truncates around 2500 chars, so every
 *    P0 block is ordered to finish well inside that — nothing load-bearing can
 *    be lost even by the provider that cuts earliest.
 *  - The budget itself is 2800, matching `MAX_PROMPT` in
 *    `buildPremiumImagePrompt`, so the P2 polish (the thumbnail self-check) is
 *    still sent to the providers that accept it instead of being dropped
 *    locally for everyone.
 */
const MAX_DIAGRAM_PROMPT = 2800;

/**
 * Assemble a diagram prompt from priority-ordered blocks, stopping BEFORE the
 * budget would be exceeded. A block is atomic: it either fits whole or is
 * dropped whole.
 *
 * Both diagram builders used to end with `(...).trim().slice(0, 2500)`, which
 * cuts at an arbitrary character offset. The rules had grown past the budget, so
 * the slice landed inside `[ACCURACY — MANDATORY]` and the model was handed a
 * rule that stopped mid-word ("...Node lab"), followed by nothing. The prompt
 * still reported success and the cover still rendered — it just silently
 * ignored every rule after the cut, which is exactly the kind of failure that
 * reads as "the model is bad at text" instead of "we truncated the rules".
 *
 * `buildPremiumImagePrompt` was already fixed for this; the two diagram
 * builders were never migrated. This is that fix, shared by both.
 */
function assembleDiagramPrompt(
  blocks: string[],
  budget = MAX_DIAGRAM_PROMPT,
): string {
  const parts: string[] = [];
  let used = 0;

  for (const block of blocks) {
    if (!block) continue;
    const cost = block.length + 1; // +1 for the joining space
    if (used + cost > budget) break;
    parts.push(block);
    used += cost;
  }

  const full = parts.join(" ").trim();

  if (full.length > budget) {
    // Only reachable if the P0 blocks alone overflow — a real configuration
    // error, so say so rather than shipping a prompt with rules missing.
    console.warn(
      `[imagePrompt] diagram P0 blocks exceed ${budget} chars (${full.length}) — ` +
        `shorten GLASS_STYLE / TYPOGRAPHY_RULES or the heading text.`,
    );
  }

  return full;
}

/**
 * Build human-less technical schematic / diagram cover prompt.
 * Used when face identity is unavailable.
 * STRICTLY NO PEOPLE / NO FACES — flat editorial architecture diagram, system
 * node graph, technical flowchart. Precise, accurate and readable.
 */
export function buildSchematicImagePrompt(
  topicTitle: string,
  topicHint?: string,
  options?: {
    preset?: ImageVisualPreset | string;
    composition?: ImageCompositionHook | string;
    heading?: string;
    rewritten?: string;
  },
): {
  prompt: string;
  preset: ImageVisualPreset;
  composition: ImageCompositionHook;
  heading: string;
} {
  const concepts = topicToVisualConcepts(topicTitle, topicHint);
  const heading = pickCoverHeading({
    title: topicTitle,
    rewritten: options?.rewritten,
    heading: options?.heading,
    maxLen: COVER_HEADING_MAX_LEN,
  });
  const seed = topicTitle + "|schematic|" + concepts;
  const preset = pickImagePreset(seed, options?.preset || "workflow");
  const composition = pickCompositionHook(seed, preset, options?.composition);

  // Topology comes from the shared routing table, so this builder and the xKiro
  // builder can never disagree about the same article.
  const subject = pickDiagramSubject(topicTitle, topicHint);

  // Priority order, most load-bearing first — see assembleDiagramPrompt.
  //
  // [ACCURACY] is in P0, not P1, because it is the block that pins the diagram
  // to the article — and it is the block the old `.slice(0, 2500)` was cutting
  // in half, so the one rule that made the cover topic-true was the one arriving
  // broken. The two blocks the covers visibly failed on (restraint, legible
  // type) sit in P1, above the polish, so they cannot fall off either.
  const prompt = assembleDiagramPrompt([
    // P0 — genre, headline, topic and topology. Never droppable.
    `[NO HUMANS. NO FACES. NO PEOPLE. NO BODIES. NO CHARACTERS. NO AVATARS.]`,
    `A flat editorial architecture diagram for an AI Engineering cover — precise, legible, one clear left-to-right flow. NOT abstract art, NOT a 3D render.`,
    `Full-bleed 1:1 social media cover. Canvas IS the cover: no frames, no mockups, no device bezels.`,
    `[TITLE] Exact text, one line only: "${heading}". The largest element on the canvas, high-contrast white on the dark background.`,
    `[NO LOGO] No IO/IstamAI monogram, badge, or watermark anywhere.`,
    `[DIAGRAM SUBJECT] ${subject.detail}. Node sequence: ${subject.nodes}.${subject.zones ? ` Grouping: ${subject.zones}.` : ""}`,
    ACCURACY_RULES,
    // P1 — premium restraint and legibility: the two things that were wrong.
    GLASS_STYLE,
    TYPOGRAPHY_RULES,
    // P2 — polish, dropped first if the budget runs out.
    // No second "Requirements:" block restating the same rules. Repeating an
    // instruction does not strengthen it, and the earlier duplicate both burned
    // the character budget and contradicted the style block. This adds only what
    // is genuinely new: the thumbnail test.
    `FINAL CHECK: at thumbnail size the title and every node label must still be readable; if not, drop the least important node rather than shrinking the type.`,
  ]);

  return { prompt, preset, composition, heading };
}


/**
 * Build dedicated AI Workflow schematic cover prompt for xKiro.
 * Topic-aware: the topology comes from the shared `pickDiagramSubject` table, so
 * this and the schematic builder always agree.
 * Flat editorial style — restrained palette, generous space, large legible type.
 * STRICTLY NO HUMANS / NO FACES — pure technical diagram.
 */
export function buildWorkflowImagePrompt(
  topicTitle: string,
  topicHint?: string,
  options?: {
    composition?: ImageCompositionHook | string;
    heading?: string;
    rewritten?: string;
  },
): {
  prompt: string;
  preset: "workflow";
  composition: ImageCompositionHook;
  heading: string;
} {
  const concepts = topicToVisualConcepts(topicTitle, topicHint);
  const heading = pickCoverHeading({
    title: topicTitle,
    rewritten: options?.rewritten,
    heading: options?.heading,
    maxLen: COVER_HEADING_MAX_LEN,
  });
  const seed = topicTitle + "|workflow|" + concepts;
  const composition = pickCompositionHook(seed, "workflow", options?.composition);

  // Topology comes from the SAME shared routing table as the schematic builder.
  // This used to be a second, independent copy of the routing, which is how the
  // two diagrams could disagree about one article — and how this one fell
  // through to a generic "Input → Processing → AI Model → Output" placeholder
  // for a topic about HTTP content negotiation.
  const subject = pickDiagramSubject(topicTitle, topicHint);

  // Same priority order and the same budget helper as the schematic builder, so
  // the two can never disagree about what matters. See assembleDiagramPrompt for
  // why this replaced `.slice(0, 2500)` and why [ACCURACY] is in P0.
  const prompt = assembleDiagramPrompt([
    // P0 — genre, headline, topic and topology. Never droppable.
    `[NO HUMANS. NO FACES. NO PEOPLE. NO BODIES. NO CHARACTERS. NO AVATARS. ZERO.]`,
    `A flat editorial AI workflow diagram for an Engineering cover — precise, legible, one clear left-to-right flow. NOT abstract art, NOT a 3D render.`,
    `Full-bleed 1:1 social media cover. Canvas IS the cover: no frames, no mockups, no device bezels.`,
    `[TITLE] Exact text, one line: "${heading}". The largest element on the canvas, maximum contrast, top of image.`,
    `[NO LOGO] No IO/IstamAI monogram, badge, or watermark.`,
    `[WORKFLOW DIAGRAM] ${subject.detail}. Node sequence: ${subject.nodes}.`,
    subject.zones ? `[LAYOUT ZONES] ${subject.zones}.` : "",
    ACCURACY_RULES,
    // P1 — premium restraint and legibility: the two things that were wrong.
    GLASS_STYLE,
    TYPOGRAPHY_RULES,
    // P2 — polish, dropped first if the budget runs out.
    // No duplicate "Requirements:" restatement — see the schematic builder.
    `FINAL CHECK: at thumbnail size the title and every node label must still be readable; if not, drop the least important node rather than shrinking the type.`,
  ]);

  return { prompt, preset: "workflow", composition, heading };
}

// ══════════════════════════════════════════════════════════════════════════
//  xKiro — content-matched, feed-optimised covers
// ══════════════════════════════════════════════════════════════════════════
//
// xKiro is the one provider that cannot see face.jpg, so the identity cover is
// out of reach for it. It used to compensate by drawing a technical flowchart
// on EVERY cover: accurate, but the same flat infographic post after post, and
// a weak performer in a feed where the cover is the only thing competing for a
// scroll.
//
// It now renders the SAME topic three different ways and rotates between them:
//
//   editorial — a cinematic hero scene of the article's subject
//   metaphor  — the core mechanism as one physical object the viewer knows
//   diagram   — the original technical flowchart (kept, no longer the default)
//
// Topic truth is not reinvented here: every mode reads its subject matter from
// `pickDiagramSubject`, the same routing table the two diagram builders use. So
// no mode can invent architecture the post never claimed, and the three modes
// describe the same article rather than three different ones.

export type XkiroVisualMode = "editorial" | "metaphor" | "diagram";

export const XKIRO_VISUAL_MODES: XkiroVisualMode[] = [
  "editorial",
  "metaphor",
  "diagram",
];

/**
 * Weighted rotation — diagrams are deliberately a minority.
 *
 * The flowchart is the right answer for an architecture deep-dive and the wrong
 * one for a "why this matters" post, and the pipeline cannot tell those apart
 * cheaply. Rotating means each mode gets used where it happens to fit, and the
 * feed stops repeating one look. `XKIRO_VISUAL_MODE` pins a single mode.
 */
const XKIRO_MODE_ROTATION: XkiroVisualMode[] = [
  "editorial",
  "metaphor",
  "editorial",
  "diagram",
];

export function pickXkiroVisualMode(
  seed: string,
  force?: XkiroVisualMode | string,
): XkiroVisualMode {
  const f = (force || "").toLowerCase().trim() as XkiroVisualMode;
  if (XKIRO_VISUAL_MODES.includes(f)) return f;
  const h = hashSeed(seed + "|xkiro-mode");
  return XKIRO_MODE_ROTATION[h % XKIRO_MODE_ROTATION.length];
}

/** Scene structures for the non-diagram modes. */
export type XkiroSceneHook =
  | "hero_object"
  | "split_contrast"
  | "depth_corridor"
  | "exploded_layers"
  | "macro_mechanism"
  | "threshold_portal";

type SceneSpec = {
  id: XkiroSceneHook;
  label: string;
  layout: string;
  eyeCatch: string;
};

const SCENES: Record<XkiroSceneHook, SceneSpec> = {
  hero_object: {
    id: "hero_object",
    label: "hero object",
    layout:
      "HERO OBJECT: one colossal, physically real object embodying the subject, centred and filling two thirds of the canvas at a low three-quarter camera angle; a single hard key light from upper left, deep falloff into black on the right, the object's leading edge picked out in brand teal",
    eyeCatch:
      "one unmistakable silhouette — at thumbnail size the shape alone carries the story",
  },
  split_contrast: {
    id: "split_contrast",
    label: "split contrast",
    layout:
      "SPLIT CONTRAST: a hard vertical division — the left half shows the problem as a dim, cluttered, desaturated mass; the right half shows the same system resolved into one clean lit structure; the seam is a thin cyan line, not a gradient",
    eyeCatch:
      "the before/after seam opens a 'what changed?' gap the viewer has to resolve",
  },
  depth_corridor: {
    id: "depth_corridor",
    label: "depth corridor",
    layout:
      "DEPTH CORRIDOR: a long receding passage of repeated structural frames — racks, arch ribs or pipeline segments — converging on one bright point; the camera sits low and slightly off-axis so the repetition reads as speed",
    eyeCatch:
      "forced perspective pulls the eye to the vanishing point and into the topic",
  },
  exploded_layers: {
    id: "exploded_layers",
    label: "exploded layers",
    layout:
      "EXPLODED VIEW: the subject's three or four layers pulled apart along one axis, floating and aligned, each a different matte material — one layer lit, the rest in shadow; separation shown by light, never by drawn annotation lines",
    eyeCatch:
      "a system shown as its parts reads as 'I can understand this at a glance'",
  },
  macro_mechanism: {
    id: "macro_mechanism",
    label: "macro mechanism",
    layout:
      "MACRO MECHANISM: an extreme close-up of the one physical detail that carries the idea — a connector, a valve, a fibre bundle, a latch — filling the frame, razor-sharp, with the rest of the machine dissolving into bokeh behind",
    eyeCatch:
      "familiar material at an unfamiliar scale stops the scroll before the title is read",
  },
  threshold_portal: {
    id: "threshold_portal",
    label: "threshold",
    layout:
      "THRESHOLD: a single doorway, hatch or aperture standing alone in a dark field, warm teal light spilling out of it across the floor; the space beyond is implied and never shown",
    eyeCatch:
      "an open threshold is an unresolved question — the viewer steps through it mentally",
  },
};

export function pickSceneHook(
  seed: string,
  force?: XkiroSceneHook | string,
): XkiroSceneHook {
  const f = (force || "").toLowerCase().trim() as XkiroSceneHook;
  if (f && SCENES[f]) return f;
  const all = Object.keys(SCENES) as XkiroSceneHook[];
  const h = hashSeed(seed + "|scene");
  return all[h % all.length];
}

/**
 * Cinematic style for editorial/metaphor covers.
 *
 * Deliberately the opposite of `GLASS_STYLE`: a diagram earns its premium look
 * from restraint, a cover earns it from light. The two are never mixed into one
 * prompt, which is why the glow ban stays scoped to the diagram builders.
 */
const CINEMATIC_STYLE = [
  `[STYLE] Cinematic 3D editorial key art — photoreal materials, one hard directional key light, deep ${brandImageColors.black} field, brand teal ${brandImageColors.primary} and cyan ${brandImageColors.accentCyan} as the only accent hues, amber ${brandImageColors.hotAmber} only on the single point of tension.`,
  `Surface detail over effects: brushed metal, frosted glass, woven cable, matte plastic. Shallow depth of field, hero tack-sharp.`,
  `[FORBIDDEN] No neon outlines, lens flare, particles, HUD overlays, glowing wireframe grid, holographic panels, cyberpunk city, collage, tiled panel grid, clip-art icons, cartoon or comic style.`,
].join(" ");

/**
 * Feed-performance and monetisation contract.
 *
 * "Monetisable" here means one specific, checkable thing: the cover survives a
 * 200px thumbnail AND passes platform ad policy. Both halves matter — a cover
 * that only reads full-size loses the click, and one that trips a policy filter
 * loses the reach the click was paying for. Every rule below is either a
 * legibility constraint or an explicit ad-safety ban.
 */
const FEED_PERFORMANCE_RULES = [
  `[FEED PERFORMANCE — MANDATORY] This image is judged at ~200px wide in a scrolling feed. Exactly ONE focal point; at most three visual elements; at least 35% clean negative space. Strong luminance separation between hero and field — the subject must never sit at the background's brightness.`,
  `Curiosity, never deception: no fake dashboards, metrics, screenshots or chat windows; no arrows or circles drawn over the image; no before/after the article does not support.`,
  `Advertiser-safe: no gore, violence, weapons, nudity, drugs, gambling, political or religious symbols, medical or financial claims, cryptocurrency logos, stock-photo watermarks, and no third-party mark beyond those listed in [MARKS].`,
].join(" ");

/**
 * People are allowed — but never as an author portrait.
 *
 * The earlier rule banned faces outright. That kept identity honest but made
 * every cover feel like an empty showroom: a control room with nobody in it.
 * People are what makes a scene read as a place. The guard is now narrower and
 * more useful: a face may be incidental, never the hero, and never framed as a
 * portrait of the author — because this provider has no face reference, and an
 * invented portrait would put a stranger's face on a personal brand.
 */
const PEOPLE_RULE = `[PEOPLE] Include people when they make the idea clearer — an engineer at a terminal, a hand on a control, a small team around a lit table, a figure walking the corridor. They must look like real professionals caught mid-task, not stock-photo models: natural posture, no forced smiles, no posing at the camera. Faces are allowed at mid or full-body scale. NEVER make a large close-up face the focal point, and NEVER frame anyone as the author of the post — no name badge, no presenter stance. No crowd filling the frame, no visible brand apparel.`;

/**
 * Product marks the article may legitimately show.
 *
 * A cover about LangGraph that refuses to show the LangGraph mark is less
 * informative, not safer. What actually matters is that the mark is (a) one the
 * article names, (b) small and attached to the thing it belongs to, and (c)
 * never implying a partnership. Matching runs over title + summary + rewritten
 * text, so the list is grounded in the post rather than in the model's priors —
 * an image model asked for "AI logos" will otherwise invent a dozen.
 *
 * Aliases are matched on word boundaries and deliberately conservative: a loose
 * alias like "torch" or "lambda" fires on ordinary prose and puts a logo on a
 * post that never mentioned the product.
 */
type TechMark = { name: string; aliases: string[] };

const TECH_MARKS: TechMark[] = [
  { name: "OpenAI", aliases: ["openai", "chatgpt", "gpt-4", "gpt-5", "gpt-image", "dall-e"] },
  { name: "Anthropic", aliases: ["anthropic", "claude"] },
  { name: "Google Gemini", aliases: ["gemini", "vertex ai", "google ai studio"] },
  { name: "Meta Llama", aliases: ["llama"] },
  { name: "Mistral", aliases: ["mistral", "mixtral"] },
  { name: "Qwen", aliases: ["qwen"] },
  { name: "DeepSeek", aliases: ["deepseek"] },
  { name: "LangChain", aliases: ["langchain", "langgraph", "langsmith", "langserve"] },
  { name: "Hugging Face", aliases: ["hugging face", "huggingface"] },
  { name: "PyTorch", aliases: ["pytorch"] },
  { name: "TensorFlow", aliases: ["tensorflow"] },
  { name: "NVIDIA", aliases: ["nvidia", "cuda"] },
  { name: "Docker", aliases: ["docker"] },
  { name: "Kubernetes", aliases: ["kubernetes", "k8s"] },
  { name: "PostgreSQL", aliases: ["postgres", "postgresql"] },
  { name: "Redis", aliases: ["redis"] },
  { name: "Kafka", aliases: ["kafka"] },
  { name: "AWS", aliases: ["aws", "amazon web services", "s3"] },
  { name: "Azure", aliases: ["azure"] },
  { name: "GitHub", aliases: ["github"] },
  { name: "Vercel", aliases: ["vercel"] },
  { name: "Supabase", aliases: ["supabase"] },
  { name: "Ollama", aliases: ["ollama"] },
  { name: "vLLM", aliases: ["vllm"] },
  { name: "TypeScript", aliases: ["typescript"] },
  { name: "Python", aliases: ["python"] },
  { name: "Rust", aliases: ["rust"] },
];

/**
 * Marks actually named by the article, in registry order (deterministic), capped
 * at `limit`. Returning [] is the common case and is a real answer: it means
 * "draw no mark at all", not "pick some".
 */
export function detectTechMarks(
  title: string,
  hint?: string,
  rewritten?: string,
  limit = 3,
): string[] {
  const haystack = [title, hint, rewritten]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const found: string[] = [];
  for (const mark of TECH_MARKS) {
    if (found.length >= limit) break;
    const hit = mark.aliases.some((alias) =>
      new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(
        haystack,
      ),
    );
    if (hit) found.push(mark.name);
  }
  return found;
}

/**
 * Marks block. With no detected marks this is an explicit ban, because "add
 * relevant AI logos" without a grounding list is exactly how a cover ends up
 * wearing six logos for products the post never mentioned.
 */
function buildMarksBlock(marks: string[]): string {
  if (marks.length === 0) {
    return `[MARKS] This article names no specific product or company. Add NO logo, badge or wordmark of any kind — an invented mark is worse than an empty panel.`;
  }
  return `[MARKS] This article names: ${marks.join(", ")}. You may render AT MOST TWO of these marks, each small, flat, and attached to the object it actually belongs to — a terminal window, a rack label, a case badge. Never larger than a quarter of the title's height, never floating in empty space, never arranged as a row of partner logos. If a mark cannot be drawn accurately, set its name in clean sans-serif instead of a distorted glyph. Add no other company or product mark, and never imply sponsorship, partnership or endorsement.`;
}

/**
 * `pickDiagramSubject().detail` is written for a flowchart — it talks about
 * "dashed two-way links" and labelled arrows. Left verbatim in a scene prompt,
 * those words make the model paint diagram furniture (dashed lines, arrowheads)
 * into what should be a photograph. The scene modes strip them; the diagram
 * mode keeps the detail untouched.
 */
function detailToScene(detail: string): string {
  return detail
    .replace(/\s*\((?:[^()]*(?:dashed|arrow|link|loop|edge|label)[^()]*)\)/gi, "")
    .replace(/\bdashed\b\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * xKiro slices prompts at 4000 chars. The people + marks blocks added ~500
 * chars, so the budget moved up — but it stays 150 under that hard cut, and
 * `FEED_PERFORMANCE_RULES` sits early enough in the block order that a future
 * growth spurt drops polish, never the ad-safety contract.
 */
const MAX_ENGAGING_PROMPT = 3850;

/**
 * Build the cover prompt xKiro actually receives.
 *
 * `diagram` mode delegates to `buildWorkflowImagePrompt`, so the flowchart
 * branch keeps its accuracy and legibility contracts unchanged instead of
 * being re-implemented (and quietly drifting) here.
 */
export function buildEngagingImagePrompt(
  topicTitle: string,
  topicHint?: string,
  options?: {
    heading?: string;
    rewritten?: string;
    mode?: XkiroVisualMode | string;
    scene?: XkiroSceneHook | string;
    composition?: ImageCompositionHook | string;
  },
): {
  prompt: string;
  mode: XkiroVisualMode;
  scene: XkiroSceneHook | null;
  heading: string;
  /** Product marks the article actually names (empty = draw none). */
  marks: string[];
} {
  const concepts = topicToVisualConcepts(topicTitle, topicHint);
  const heading = pickCoverHeading({
    title: topicTitle,
    rewritten: options?.rewritten,
    heading: options?.heading,
    maxLen: COVER_HEADING_MAX_LEN,
  });
  const seed = topicTitle + "|engaging|" + concepts + "|" + heading;
  const mode = pickXkiroVisualMode(seed, options?.mode);
  // Grounded in the article text, never in the model's idea of "AI brands".
  // Computed before the branch so the caller can log it on every path.
  const marks = detectTechMarks(topicTitle, topicHint, options?.rewritten);

  if (mode === "diagram") {
    const w = buildWorkflowImagePrompt(topicTitle, topicHint, {
      heading,
      rewritten: options?.rewritten,
      composition: options?.composition,
    });
    return {
      prompt: w.prompt,
      mode,
      scene: null,
      heading: w.heading,
      marks,
    };
  }

  const scene = pickSceneHook(seed, options?.scene);
  const spec = SCENES[scene];
  // Same subject matter as the diagram builders — only the rendering changes.
  const subject = pickDiagramSubject(topicTitle, topicHint);
  const sceneStory = detailToScene(subject.detail);

  const story =
    mode === "metaphor"
      ? `[STORY — METAPHOR] Turn this mechanism into ONE physical object or place the viewer already understands, and let the metaphor carry the idea: ${sceneStory}. The metaphor must be literal and instantly readable — not surreal, not symbolic in two ways at once.`
      : `[STORY — SCENE] Render this system as a single real scene in one continuous 3D space — never a flowchart, never a row of labelled boxes: ${sceneStory}.`;

  const prompt = assembleDiagramPrompt(
    [
      // P0 — genre, headline, story, people, marks. Never droppable.
      `A cinematic editorial key-art cover for an AI Engineering post — one hero subject, dramatic light, premium tech-brand aesthetic. NOT a diagram, NOT a flowchart, NOT an infographic.`,
      `Full-bleed 1:1 social media cover. Canvas IS the cover: no frames, no poster on a wall, no device mockup, no double border.`,
      `[TITLE] Exact text, one line only: "${heading}". The largest element on the canvas, high-contrast white, tight tracking, placed in clean negative space so it never crosses the hero subject.`,
      `[NO BRAND LOGO] No IO/IstamAI monogram, badge or watermark anywhere. Third-party product marks are governed separately by [MARKS].`,
      story,
      PEOPLE_RULE,
      buildMarksBlock(marks),
      // P0 continued — the monetisation contract. Deliberately placed BEFORE the
      // style block: the assembler drops from the tail, and losing ad-safety
      // rules silently demonetises the post. This must never be the casualty.
      FEED_PERFORMANCE_RULES,
      // P1 — look and composition: what makes it stop the scroll.
      CINEMATIC_STYLE,
      `[SCENE (${spec.label})] ${spec.layout}. Eye-catch: ${spec.eyeCatch}.`,
      // P2 — polish, dropped first if the budget runs out.
      `[TEXT BUDGET] Apart from the title and at most two [MARKS] wordmarks, no other readable words: no subtitle, no caption, no object labels, no numbers, no arrows, no legend.`,
      `FINAL CHECK: squint at thumbnail size — if the hero and the title are not both instantly readable, simplify the scene instead of adding detail.`,
    ],
    MAX_ENGAGING_PROMPT,
  );

  return { prompt, mode, scene, heading, marks };
}


