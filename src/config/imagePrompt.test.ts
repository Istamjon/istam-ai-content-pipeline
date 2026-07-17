import {
  buildPremiumImagePrompt,
  pickImagePreset,
  pickCompositionHook,
  topicToVisualConcepts,
  topicToCoverNarrative,
  titleToCoverHeading,
  COMPOSITION_HOOKS,
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
      "Tail Control for Agentic Workflows",
      "latency, multi-agent",
      "critical_path_glow",
      true,
    );
    expect(n).toMatch(/heading must read exactly/i);
    expect(n).toMatch(/reference photo|identity/i);
    expect(n).toMatch(/NO brand logo/i);
  });

  it("buildPremiumImagePrompt: person, heading, full-bleed, no logo", () => {
    const { prompt, preset, composition, heading } = buildPremiumImagePrompt(
      "Tail Control for Agentic Workflows",
      "latency variance in multi-agent systems",
      {
        preset: "workflow",
        composition: "critical_path_glow",
        faceRef: true,
      },
    );
    expect(preset).toBe("workflow");
    expect(composition).toBe("critical_path_glow");
    expect(heading.length).toBeGreaterThan(5);
    expect(prompt.length).toBeGreaterThan(500);

    expect(prompt).toMatch(/FULL-BLEED|full-bleed|edge-to-edge/i);
    expect(prompt).toMatch(/picture frame|phone mockup/i);
    expect(prompt).toMatch(/MUST HAVE #1 — PERSON|IDENTITY|PERSON/i);
    expect(prompt).toMatch(/reference photo|identity/i);
    expect(prompt).toMatch(/MUST HAVE #2 — HEADING|HEADING TEXT/i);
    expect(prompt).toContain(`"${heading}"`);
    expect(prompt).toMatch(/MUST NOT — LOGO|no IO|No brand badge|no logo/i);
    expect(prompt).not.toMatch(/MUST HAVE #3 — LOGO/);
    expect(prompt).toMatch(/#036158/);
  });
});
