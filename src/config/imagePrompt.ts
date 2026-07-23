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

  // Drop common blog fluff prefixes (EN + UZ)
  t = t
    .replace(/^(introducing|announcing|how to|how\s+|why\s+|what is)\s+/i, "")
    .replace(/^(yangi\s+maqola[:\s]+|maqola[:\s]+)/i, "")
    .trim();

  if (t.length <= maxLen) return t;

  // Prefer cut at word boundary
  const slice = t.slice(0, maxLen - 1);
  const sp = slice.lastIndexOf(" ");
  const cut = sp > 20 ? slice.slice(0, sp) : slice;
  return cut.trimEnd() + "…";
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
 * Prefer Uzbek (Latin) on-image heading.
 * 1) explicit options.heading
 * 2) first hook line from rewritten Uzbek post
 * 3) title if already Uzbek
 * 4) short technical EN fallback (prompt still asks model for Uzbek — avoided when possible)
 */
export function pickCoverHeading(input: {
  title: string;
  rewritten?: string;
  heading?: string;
  maxLen?: number;
}): string {
  const maxLen = input.maxLen ?? 48;
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
      .filter((l) => l.length >= 12 && !/^manba\b/i.test(l));

    for (const line of lines.slice(0, 4)) {
      // Skip pure English tech dump lines
      if (looksLikeUzbekLatin(line) || !/^[A-Za-z0-9 ,.:;+\-/()]+$/.test(line)) {
        return titleToCoverHeading(line, maxLen);
      }
    }
    // Any first solid line if Uzbek-looking body overall
    if (looksLikeUzbekLatin(body.slice(0, 400)) && lines[0]) {
      return titleToCoverHeading(lines[0], maxLen);
    }
  }

  const title = (input.title || "").trim();
  if (looksLikeUzbekLatin(title)) {
    return titleToCoverHeading(title, maxLen);
  }

  // Last resort: shortened source title (may be EN) — caller should prefer rewritten
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
    ? `Person MUST match reference image face.jpg (ORIGINAL FACE REFERENCE): same face, age, skin, hair — NEW pose/angle only; never clone face.jpg stance/background.`
    : `Include one professional person as attention anchor with a varied editorial pose.`;
  return (
    `Premium personal-brand social cover for AI Engineering. ` +
    `On-image title text MUST match exactly these words in quotes (nothing else): "${heading}". ` +
    `Post topic: ${title.replace(/\s+/g, " ").trim().slice(0, 120)}. ` +
    `Background system visual encodes: ${concepts}. ` +
    `Attention: ${hookLine}. ` +
    `${personLine} ${poseLine} Full-bleed scene, sharp on-image title only, NO brand logo monogram.`
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
  const personBlock = faceRef
    ? `MUST HAVE #1 — PERSON (IDENTITY + NEW POSE): Use reference image face.jpg as the ORIGINAL FACE REFERENCE (face identity only: structure, age, skin, hair, likeness). Do NOT copy face.jpg pose, hands, crop, clothes, or background. NEW POSE — ${poseSpec.label}: ${poseSpec.body}. Full-bleed editorial with tech hologram; outfit may change (dark smart-casual + teal). Cinematic light. No different face; no frame; no flat cutout of face.jpg.`
    : `MUST HAVE #1 — PERSON + POSE: one professional adult (AI engineer look) integrated INTO the scene with the tech hologram — full-bleed editorial, NOT a cutout on a poster. Pose — ${poseSpec.label}: ${poseSpec.body}. Sharp face, modern smart-casual with teal accent, cinematic lighting, waist-up.`;

  return [
    `MUST HAVE #0 — FULL-BLEED CANVAS (critical): The final image IS the social cover — edge-to-edge 1:1. NOT a photo of a poster. NOT artwork inside a wooden/gold/metal picture frame. NOT floating framed art on a wall. NOT phone/laptop/browser mockup. NOT double borders, matte, polaroid, drop-shadow card. Scene fills the square directly.`,
    personBlock,
    // Do NOT put language names (e.g. "Uzbek") as visual title hints — models paint them as literal cover text.
    `MUST HAVE #2 — ON-IMAGE TITLE: exact words only in quotes: "${heading}". Clean modern sans-serif, white or white-to-cyan, large for mobile. Latin letters only (no Cyrillic). No extra words, no paraphrase, no gibberish.`,
    `MUST NOT — LOGO / META TEXT: no IO/IstamAI monogram, badge, watermark, or logo. Never paint language/meta labels as text (forbidden words on image: Uzbek, Oʻzbek, Latin, English, Cyrillic).`,
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
    maxLen: 48,
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

  // ── Lead (Horde-safe head; strongest requirements first) ───────────────
  // Lead with face.jpg first (Nano Banana truncates ~2500; identity must survive).
  const faceLead = faceRef
    ? `REFERENCE IMAGE: face.jpg — ORIGINAL FACE REFERENCE. Preserve exact facial identity from face.jpg only. New pose/scene — never clone face.jpg body pose or background.`
    : "";
  const lead = [
    faceLead,
    `Scroll-stopping ultra-premium FULL-BLEED social media cover, square 1:1, LinkedIn/Telegram ready — the canvas itself is the cover, not a framed photo.`,
    `Dark premium tech environment: deep indigo-black (#0A0A0C), subtle teal glow, faint micro-grid — immersive to the edges, no outer border.`,
    must[0],
    must[1],
    must[2],
    must[3],
    `POSE LOCK (${poseSpec.label}): ${poseSpec.body}. Different from any previous post and from the face.jpg reference pose.`,
    `TECH VISUAL (same 3D space as person, holographic layers): ${p.centerIdea}. Topic DNA: ${concepts}.`,
    `COMPOSITION (${hook.label}): ${hook.layout}.`,
    `Eye-catch: ${hook.eyeCatch}.`,
    `${p.coverFraming}.`,
    `Colors: brand teal #036158, cyan #5EEAD4, white title text, deep black field.`,
    `Style: Apple keynote hero + Behance tech editorial — sharp, modern, NO frames, NO logos.`,
  ]
    .filter(Boolean)
    .join(" ");

  // ── Extended ───────────────────────────────────────────────────────────
  const extended = [
    ``,
    `Cover narrative:`,
    narrative,
    ``,
    `Professional framing rules:`,
    `- Full bleed to all edges — zero picture-frame, zero white margin card.`,
    `- Person and holograms in ONE continuous scene (same light, same depth).`,
    `- Title is on-canvas overlay only — not paper inside a frame.`,
    `- Absolutely no IO / IstamAI / monogram logo anywhere.`,
    ``,
    `Layout zones:`,
    `- TOP: TITLE "${heading}" — 1–2 lines, sharp sans, Latin letters only.`,
    `- MAIN: PERSON in pose "${poseSpec.label}" + tech hologram mid-ground.`,
    `- No nested rectangles, no poster-on-wall, no device bezel, no logo corner.`,
    ``,
    `Text rule: the ONLY readable words on the image are exactly: "${heading}". No other labels, no language names, no logo text, no gibberish.`,
    ``,
    faceRef
      ? `Identity vs pose: reference image face.jpg = FACE ONLY (ORIGINAL FACE REFERENCE). High likeness from face.jpg. New pose (${poseSpec.label}); no cloning face.jpg stance/hands/crop/background.`
      : `Person: photoreal professional AI creator vibe. ONE person only. Pose: ${poseSpec.label}.`,
    ``,
    `Hard avoid: same pose as face.jpg, picture frame, poster on wall, phone/laptop mockup, double border, IO/monogram/IstamAI logo, watermarks, third-party logos, QR, cartoon, anime, painting the words Uzbek/Oʻzbek/Latin/English/Cyrillic, misspelled/gibberish text, any title not equal to the quoted heading.`,
  ].join("\n");

  let full = (lead + "\n" + extended).trim();
  // Prefer keeping lead (identity + colors + pose) intact when trimming.
  // 3200: leave room for longer MUST blocks without cutting brand teal / title rules.
  const maxLen = 3200;
  if (full.length > maxLen) {
    const leadLen = lead.length;
    if (leadLen >= maxLen - 40) {
      // Keep color + title anchors even if lead is huge
      const colorLine = ` Colors: brand teal #036158, cyan #5EEAD4, white title text, deep black field.`;
      const titleAnchor = ` Exact on-image title: "${heading}".`;
      const body = lead.slice(0, maxLen - colorLine.length - titleAnchor.length - 20).trimEnd();
      full = (body + colorLine + titleAnchor).trimEnd();
    } else {
      const budget = maxLen - leadLen - 2;
      full = (lead + "\n" + extended.slice(0, Math.max(0, budget))).trimEnd();
    }
  }
  return { prompt: full, preset, composition, pose, heading };
}
