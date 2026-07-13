import {
  buildPremiumImagePrompt,
  pickImagePreset,
  topicToVisualConcepts,
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

  it("pickImagePreset accepts legacy aliases", () => {
    expect(pickImagePreset("x", "graph")).toBe("workflow");
    expect(pickImagePreset("x", "abstract")).toBe("engineering");
    expect(pickImagePreset("x", "systems")).toBe("infrastructure");
    expect(pickImagePreset("x", "workflow")).toBe("workflow");
  });

  it("buildPremiumImagePrompt enforces void bg and single center idea", () => {
    const { prompt, preset } = buildPremiumImagePrompt(
      "Tail Control for Agentic Workflows",
      "latency variance in multi-agent systems",
      { preset: "workflow" },
    );
    expect(preset).toBe("workflow");
    expect(prompt.length).toBeGreaterThan(200);
    expect(prompt).toMatch(/dark gray to black|gradient/i);
    expect(prompt).toMatch(/#036158/);
    expect(prompt).toMatch(/NO room|no office|NO office/i);
    expect(prompt).toMatch(/ONE single centered|ONE main visual|one centered/i);
    expect(prompt).not.toMatch(/office interior with desks/i);
  });
});
