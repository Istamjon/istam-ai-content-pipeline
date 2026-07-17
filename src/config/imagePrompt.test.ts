import {
  buildPremiumImagePrompt,
  pickImagePreset,
  pickCompositionHook,
  topicToVisualConcepts,
  topicToCoverNarrative,
  titleToCoverHeading,
  COMPOSITION_HOOKS,
  brandCoverMarks,
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

  it("topicToCoverNarrative requires person heading logo", () => {
    const n = topicToCoverNarrative(
      "Tail Control for Agentic Workflows",
      "Tail Control for Agentic Workflows",
      "latency, multi-agent",
      "critical_path_glow",
    );
    expect(n).toMatch(/heading must read exactly/i);
    expect(n).toMatch(/professional person|brand logo/i);
  });

  it("buildPremiumImagePrompt requires person, heading text, and logo", () => {
    const { prompt, preset, composition, heading } = buildPremiumImagePrompt(
      "Tail Control for Agentic Workflows",
      "latency variance in multi-agent systems",
      { preset: "workflow", composition: "critical_path_glow" },
    );
    expect(preset).toBe("workflow");
    expect(composition).toBe("critical_path_glow");
    expect(heading.length).toBeGreaterThan(5);
    expect(prompt.length).toBeGreaterThan(500);

    // Person
    expect(prompt).toMatch(/MUST HAVE #1 — PERSON|professional adult|PERSON/i);
    expect(prompt).toMatch(/face|portrait|waist-up/i);

    // Heading with exact quoted text
    expect(prompt).toMatch(/MUST HAVE #2 — HEADING|HEADING TEXT/i);
    expect(prompt).toContain(`"${heading}"`);
    expect(prompt).toMatch(/sans-serif|legible|title/i);

    // Logo / brand
    expect(prompt).toMatch(/MUST HAVE #3 — LOGO|monogram/i);
    expect(prompt).toContain(brandCoverMarks.monogram);
    expect(prompt).toMatch(/Istam|IO/);

    expect(prompt).toMatch(/#036158/);
    expect(prompt).toMatch(/scroll-stopping|premium/i);
    // Old ban on people/text/logo should be gone
    expect(prompt).not.toMatch(/Zero text, zero letters/i);
    expect(prompt).not.toMatch(/HARD NO:.*people/i);
  });
});
