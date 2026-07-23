import {
  buildPremiumImagePrompt,
  pickImagePreset,
  pickCompositionHook,
  pickImagePose,
  pickCoverHeading,
  looksLikeUzbekLatin,
  topicToVisualConcepts,
  topicToCoverNarrative,
  titleToCoverHeading,
  COMPOSITION_HOOKS,
  IMAGE_POSES,
} from "./imagePrompt.js";

describe("imagePrompt", () => {
  it("topicToVisualConcepts strips noise and keeps technical terms", () => {
    const c = topicToVisualConcepts(
      "Introducing GPU-Resident Top-K for Agentic RAG",
      "CUDA kernel multi-agent retrieval",
    );
    expect(c.toLowerCase()).toMatch(/rag|gpu|agentic|cuda/);
    expect(c.toLowerCase()).not.toContain("introducing");
  });

  it("titleToCoverHeading shortens and cleans titles", () => {
    const h = titleToCoverHeading(
      "Introducing GPU-Resident Top-K for Agentic RAG Pipelines in Production",
      52,
    );
    expect(h.length).toBeLessThanOrEqual(53);
    expect(h.toLowerCase()).not.toMatch(/^introducing/);
    expect(h).toMatch(/GPU|RAG|Agentic|Top-K/i);
  });

  it("pickCoverHeading prefers Uzbek rewritten hook over English title", () => {
    const h = pickCoverHeading({
      title: "Introducing Multi-Agent Orchestration in Production",
      rewritten:
        "Agentlar zanjiri ishlab chiqarishda qanday ishlaydi?\n\nAsosiy faktlar:\n• LangGraph\n• orchestrator",
    });
    expect(h.toLowerCase()).toMatch(/agentlar|zanjiri|ishlab/);
    expect(h.toLowerCase()).not.toMatch(/^introducing/);
    expect(looksLikeUzbekLatin(h) || /agentlar/i.test(h)).toBe(true);
  });

  it("pickImagePose rotates and accepts force", () => {
    expect(pickImagePose("seed", "arms_crossed_confident")).toBe(
      "arms_crossed_confident",
    );
    const a = pickImagePose("seed-a-unique");
    const b = pickImagePose("seed-b-different");
    expect(IMAGE_POSES).toContain(a);
    expect(IMAGE_POSES).toContain(b);
  });

  it("pickImagePreset accepts legacy aliases", () => {
    expect(pickImagePreset("x", "graph")).toBe("workflow");
    expect(pickImagePreset("x", "agents")).toBe("agents");
    expect(pickImagePreset("x", "dataflow")).toBe("dataflow");
  });

  it("pickImagePreset biases by topic keywords", () => {
    expect(pickImagePreset("multi-agent orchestration swarm tools")).toBe(
      "agents",
    );
    expect(pickImagePreset("RAG retrieval vector embedding pipeline")).toBe(
      "dataflow",
    );
  });

  it("pickCompositionHook accepts force and preferred sets", () => {
    expect(pickCompositionHook("seed", "agents", "radial_burst")).toBe(
      "radial_burst",
    );
    const h = pickCompositionHook("unique-seed-xyz", "workflow");
    expect(COMPOSITION_HOOKS).toContain(h);
  });

  it("topicToCoverNarrative requires person heading no logo", () => {
    const n = topicToCoverNarrative(
      "Tail Control for Agentic Workflows",
      "Agent oqimida kechikishni boshqarish",
      "latency, multi-agent",
      "critical_path_glow",
      true,
      "pointing_critical_path",
    );
    expect(n).toMatch(/title text MUST match|exactly these words/i);
    expect(n).toMatch(/face\.jpg|ORIGINAL FACE REFERENCE|identity/i);
    expect(n).toMatch(/NEW body pose|NEW POSE|pose recipe/i);
    expect(n).toMatch(/NO brand logo/i);
    // Language name must not appear as "draw this" title copy
    expect(n).not.toMatch(/MUST be Uzbek|white Uzbek|crisp Uzbek/i);
  });

  it("buildPremiumImagePrompt: person, exact heading, pose, full-bleed, no logo, no language-label text", () => {
    const { prompt, preset, composition, pose, heading } =
      buildPremiumImagePrompt(
        "Tail Control for Agentic Workflows",
        "latency variance in multi-agent systems",
        {
          preset: "workflow",
          composition: "critical_path_glow",
          pose: "pointing_critical_path",
          faceRef: true,
          rewritten:
            "Ishlab chiqarishda agent oqimlarini qanday boshqaramiz?\n\nAsosiy faktlar:\n• latency\n• tail control",
        },
      );
    expect(preset).toBe("workflow");
    expect(composition).toBe("critical_path_glow");
    expect(pose).toBe("pointing_critical_path");
    expect(heading.length).toBeGreaterThan(5);
    expect(heading.toLowerCase()).toMatch(/ishlab|agent|boshqaramiz|oqim/);
    expect(prompt.length).toBeGreaterThan(500);

    expect(prompt).toMatch(/FULL-BLEED|full-bleed|edge-to-edge/i);
    expect(prompt).toMatch(/picture frame|phone mockup/i);
    expect(prompt).toMatch(/MUST HAVE #1 — PERSON|IDENTITY|PERSON/i);
    expect(prompt).toMatch(/face\.jpg/);
    expect(prompt).toMatch(/ORIGINAL FACE REFERENCE/i);
    expect(prompt).toMatch(/NEW POSE|POSE LOCK|ORIGINAL FACE REFERENCE|face identity/i);
    expect(prompt).toMatch(/MUST HAVE #2 — ON-IMAGE TITLE|ON-IMAGE TITLE/i);
    expect(prompt).toContain(`"${heading}"`);
    expect(prompt).toMatch(/MUST NOT — LOGO|no IO|No brand badge|no logo/i);
    expect(prompt).not.toMatch(/MUST HAVE #3 — LOGO/);
    expect(prompt).toMatch(/#036158/);
    expect(prompt).toMatch(/pointing|critical path/i);
    // Models were painting "Uzbek" on covers when the word was in the visual brief
    expect(prompt).not.toMatch(/white Uzbek heading|crisp Uzbek heading|HEADING in OʻZBEK|UZBEK HEADING/i);
    expect(prompt).toMatch(/forbidden words on image: Uzbek|Never paint language\/meta/i);
  });
});
