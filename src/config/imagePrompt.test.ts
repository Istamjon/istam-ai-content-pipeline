import {
  buildPremiumImagePrompt,
  buildSchematicImagePrompt,
  buildWorkflowImagePrompt,
  pickDiagramSubject,
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
    );
    expect(h.length).toBeLessThanOrEqual(32);
    expect(h.split(/\s+/).length).toBeLessThanOrEqual(5);
    expect(h.toLowerCase()).not.toMatch(/^introducing/);
    expect(h).toMatch(/GPU|RAG|Agentic|Top-K/i);
  });

  it("pickCoverHeading prefers short power phrase from Uzbek hook", () => {
    const h = pickCoverHeading({
      title: "Introducing Multi-Agent Orchestration in Production",
      rewritten:
        "Agentlar zanjiri ishlab chiqarishda qanday ishlaydi?\n\nAsosiy faktlar:\n• LangGraph\n• orchestrator",
    });
    expect(h.length).toBeLessThanOrEqual(32);
    expect(h.split(/\s+/).length).toBeLessThanOrEqual(5);
    expect(h.toLowerCase()).toMatch(/agentlar|zanjiri/);
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
    expect(n).toMatch(/NO brand logo|no logo/i);
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
    expect(heading.length).toBeGreaterThan(3);
    expect(heading.length).toBeLessThanOrEqual(32);
    expect(heading.split(/\s+/).length).toBeLessThanOrEqual(5);
    expect(heading.toLowerCase()).toMatch(/agent|oqim|boshqar|ishlab/);
    expect(prompt.length).toBeGreaterThan(500);
    // Length upper bound: Nano Banana safe limit
    expect(prompt.length).toBeLessThanOrEqual(2800);

    expect(prompt).toMatch(/FULL-BLEED|full-bleed|edge-to-edge/i);
    expect(prompt).toMatch(/picture frame|phone mockup/i);
    // Prompt must include [MANDATORY PERSON] or [IDENTITY + NEW POSE]
    expect(prompt).toMatch(/\[MANDATORY PERSON|MANDATORY PERSON|IDENTITY \+|MUST appear/i);
    expect(prompt).toMatch(/face\.jpg/);
    expect(prompt).toMatch(/ORIGINAL FACE REFERENCE/i);
    expect(prompt).toMatch(/NEW POSE|POSE LOCK|face identity|NEW POSE/i);
    // Title text section with spell-exactly rule
    expect(prompt).toMatch(/\[TITLE TEXT\]|POWER TITLE/i);
    expect(prompt).toMatch(/spell exactly|character by character/i);
    expect(prompt).toContain(`"${heading}"`);
    expect(prompt).toMatch(/single line|ONE line|one line/i);
    // No logo
    expect(prompt).toMatch(/\[NO LOGO\]|no IO|no logo/i);
    expect(prompt).not.toMatch(/MUST HAVE #3 — LOGO/);
    expect(prompt).toMatch(/#036158/);
    expect(prompt).toMatch(/pointing|critical path/i);
    expect(prompt).not.toMatch(/white Uzbek heading|crisp Uzbek heading|HEADING in Oʻzbek|UZBEK HEADING/i);
    expect(prompt).toMatch(/forbidden words on image: Uzbek|Never paint language\/meta/i);
    // Must not reference removed providers
    expect(prompt).not.toMatch(/Cloudflare|\bHorde\b|AI Horde|Pollinations image/i);
    // Person must NOT be blocked
    expect(prompt).not.toMatch(/HARD NO: people|HARD NO: faces|NO: people, faces/i);
  });

  it("buildWorkflowImagePrompt: no humans, topic-aware diagram, minimal glow", () => {
    const { prompt, preset, heading } = buildWorkflowImagePrompt(
      "StateGraph Orchestration for Multi-Agent Systems",
      "cyclic workflow state transitions and decision routers",
      {
        heading: "Multi Agent Workflow",
        rewritten: "Ishlab chiqarishda ko'p agentli ish oqimlari.",
      },
    );
    expect(preset).toBe("workflow");
    expect(heading).toBe("Multi Agent Workflow");
    // No humans — any variant of the instruction
    expect(prompt).toMatch(/NO HUMANS|NO PEOPLE|NO FACES|ZERO/i);
    // Must contain WORKFLOW DIAGRAM section
    expect(prompt).toMatch(/WORKFLOW DIAGRAM/i);
    // Topic-mapped nodes must appear (multi-agent case)
    expect(prompt).toMatch(/Orchestrator|orchestrat|multi.?agent/i);
    // Must contain node sequence arrow notation
    expect(prompt).toMatch(/\u2192/);
    // Title exact match
    expect(prompt).toContain('"Multi Agent Workflow"');
    // Anti-effect rule explicitly stated. The wording was replaced wholesale: the
    // old block asked for blurred orbs and "layered depth" while banning glow,
    // which is a contradiction the model resolved by over-serving the effects.
    expect(prompt).toMatch(/FORBIDDEN EFFECTS/i);
    expect(prompt).toMatch(/no glow, no bloom, no neon/i);
    // Legibility contract, which the old prompt lacked entirely.
    expect(prompt).toMatch(/TYPOGRAPHY/i);
    expect(prompt).toMatch(/horizontal, upright/i);
    // Micro-text generators are gone: they cannot be rendered legibly.
    expect(prompt).not.toMatch(/add a small legend|tiny shape legend|include a tiny/i);
    // Brand teal required
    expect(prompt).toMatch(/#036158/);
    // Dark background
    expect(prompt).toMatch(/#0A0A0A/i);
    // Length safe — see the budget suite below for the full invariant.
    expect(prompt.length).toBeLessThanOrEqual(2800);
  });
});

describe("the diagram prompt is never truncated mid-rule", () => {
  // Both diagram builders used to end with `(...).slice(0, 2500)`. The rules had
  // grown past the budget, so the cut landed inside [ACCURACY — MANDATORY] and
  // the model received "...Node lab" followed by nothing — the one rule that
  // makes the diagram match the article, arriving as gibberish. Every assertion
  // here fails against that old implementation.

  const cases: Array<[string, string]> = [
    [
      "Making agent-friendly pages with content negotiation",
      "AI agents fetching web pages; HTTP Accept header; markdown endpoints; token cost",
    ],
    [
      "StateGraph Orchestration for Multi-Agent Systems",
      "cyclic workflow state transitions and decision routers",
    ],
    [
      // A deliberately long headline, to push the budget hard.
      "Building a production-grade retrieval augmented generation pipeline with re-ranking and evaluation",
      "RAG chunking embeddings vector store re-ranker eval",
    ],
  ];

  it.each(cases)("ends on a complete sentence: %s", (title, hint) => {
    for (const build of [buildSchematicImagePrompt, buildWorkflowImagePrompt]) {
      const { prompt } = build(title, hint);
      // Atomic blocks each end in a period, so a truncated prompt cannot.
      expect(prompt.endsWith(".")).toBe(true);
      expect(prompt).not.toMatch(/[a-z]$/);
      expect(prompt).not.toMatch(/Node lab$|\w+ w$/);
    }
  });

  it.each(cases)("stays inside the budget: %s", (title, hint) => {
    for (const build of [buildSchematicImagePrompt, buildWorkflowImagePrompt]) {
      expect(build(title, hint).prompt.length).toBeLessThanOrEqual(2800);
    }
  });

  it.each(cases)("keeps every P0 rule even when the tail is dropped: %s", (title, hint) => {
    for (const build of [buildSchematicImagePrompt, buildWorkflowImagePrompt]) {
      const { prompt, heading } = build(title, hint);
      // The headline the cover is judged on.
      expect(prompt).toContain(`"${heading}"`);
      // The topic — the diagram must be about this article.
      expect(prompt).toMatch(/DIAGRAM SUBJECT|WORKFLOW DIAGRAM/);
      // The accuracy contract, in full. This is the rule the slice was eating.
      expect(prompt).toContain("[ACCURACY — MANDATORY]");
      expect(prompt).toContain("never invent, merge, drop or duplicate one");
      // The legibility contract, in full.
      expect(prompt).toContain("[TYPOGRAPHY — MANDATORY]");
      expect(prompt).toContain("never abbreviate into gibberish");
      // The anti-effect contract, in full.
      expect(prompt).toContain("[FORBIDDEN EFFECTS]");
      expect(prompt).toContain("no cyberpunk styling");
    }
  });

  it("finishes the load-bearing blocks inside the earliest provider cut-off", () => {
    // Nano Banana truncates around 2500 chars. Everything a cover is judged on
    // must therefore be finished before that point, even though the budget is
    // 2800 — otherwise the fix would just move the truncation one block later.
    for (const build of [buildSchematicImagePrompt, buildWorkflowImagePrompt]) {
      const { prompt } = build(
        "Making agent-friendly pages with content negotiation",
        "AI agents fetching web pages; HTTP Accept header; markdown endpoints; token cost",
      );
      const typographyEnd = prompt.indexOf("never abbreviate into gibberish");
      expect(typographyEnd).toBeGreaterThan(-1);
      expect(typographyEnd).toBeLessThan(2500);
    }
  });

  it("keeps the two builders in step about what is droppable", () => {
    // They share `assembleDiagramPrompt` and the same priority order. If one
    // grows a block the other lacks, this catches the divergence.
    const title = "Making agent-friendly pages with content negotiation";
    const hint = "HTTP Accept header markdown endpoints token cost";
    const s = buildSchematicImagePrompt(title, hint).prompt;
    const w = buildWorkflowImagePrompt(title, hint).prompt;
    for (const block of ["[ACCURACY — MANDATORY]", "[TYPOGRAPHY — MANDATORY]", "[FORBIDDEN EFFECTS]"]) {
      expect(s).toContain(block);
      expect(w).toContain(block);
    }
  });
});

describe("pickDiagramSubject — the diagram must be about the article", () => {
  it("does not draw a multi-agent diagram for an agent-FRIENDLY web article", () => {
    // The defect: the branch order let the broad keyword "agent" win, so
    // "Making agent-friendly pages with content negotiation" was drawn as a
    // multi-agent orchestrator — a diagram of something the article was not
    // about. "content negotiation" is the precise term and must win.
    const s = pickDiagramSubject(
      "Making agent-friendly pages with content negotiation",
      "AI agents fetching web pages; HTTP Accept header; markdown endpoints",
    );

    expect(s.nodes).toMatch(/Accept Header/i);
    expect(s.nodes).not.toMatch(/Orchestrator|Worker Agents/i);
  });

  it("still routes a genuine multi-agent article to orchestration", () => {
    const s = pickDiagramSubject(
      "StateGraph Orchestration for Multi-Agent Systems",
      "cyclic workflow state transitions and decision routers",
    );
    expect(s.nodes).toMatch(/Orchestrator/i);
  });

  it("keeps the re-ranker in a RAG diagram", () => {
    // Dropping the re-ranker is the classic plausible-but-wrong RAG diagram.
    const s = pickDiagramSubject(
      "GPU-Resident Top-K for Agentic RAG Pipelines",
      "vector search and retrieval",
    );
    expect(s.nodes).toMatch(/Re-rank/i);
  });

  it("draws the LangGraph retry as a loop, not a straight line to END", () => {
    const s = pickDiagramSubject("LangGraph state machine in production");
    expect(s.detail).toMatch(/retry loop/i);
  });

  it("never falls back to a generic placeholder pipeline", () => {
    // The old fallback was "Input → Processing → AI Model → Output → Feedback",
    // which claimed to be the article's architecture and was wrong for all of them.
    const topics: Array<[string, string]> = [
      ["A gentle introduction to embeddings", "vector representations"],
      ["Why your build is slow", "caching and incremental compilation"],
      ["Designing a CLI for humans", "argument parsing and help text"],
      ["Postgres indexes explained", "b-tree and partial indexes"],
    ];
    for (const [t, h] of topics) {
      const s = pickDiagramSubject(t, h);
      expect(s.nodes).not.toMatch(/Input → Processing → AI Model/i);
      expect(s.nodes.length).toBeGreaterThan(0);
    }
  });

  it("keeps every branch to at most 5 nodes, so labels can be set large", () => {
    // A 1:1 cover cannot render eight legible labels; asking for them is what
    // comes back as broken letterforms.
    const topics = [
      "Making agent-friendly pages with content negotiation",
      "Multi-Agent Orchestration in Production",
      "GPU-Resident Top-K for Agentic RAG Pipelines",
      "LangGraph state machine with checkpointers",
      "Model Context Protocol servers",
      "LLM evaluation with LangSmith judges",
      "Deploying model servers at low latency",
      "HTTP caching for token cost",
      "Something entirely unrelated to any branch",
    ];
    for (const t of topics) {
      const nodes = pickDiagramSubject(t).nodes.split("→").length;
      expect(nodes).toBeLessThanOrEqual(5);
    }
  });

  it("gives both builders the same topology for the same article", () => {
    const title = "Making agent-friendly pages with content negotiation";
    const hint = "HTTP Accept header and markdown endpoints";
    const a = buildSchematicImagePrompt(title, hint).prompt;
    const b = buildWorkflowImagePrompt(title, hint).prompt;

    // The two builders used to carry private copies of the routing table.
    expect(a).toContain(pickDiagramSubject(title, hint).nodes);
    expect(b).toContain(pickDiagramSubject(title, hint).nodes);
  });
});

describe("titleToCoverHeading — the headline printed on the cover", () => {
  it("keeps a hyphenated compound instead of cutting the phrase in half", () => {
    // The defect that shipped: the first hyphen was treated as a subtitle
    // separator, so "Making agent-friendly pages with content negotiation"
    // became the on-image headline "Making Agent" — a meaningless fragment in
    // large type. Only a SPACED dash introduces a subtitle.
    const h = titleToCoverHeading(
      "Making agent-friendly pages with content negotiation",
    );

    expect(h.toLowerCase()).not.toBe("making agent");
    expect(h.toLowerCase()).toMatch(/agent-friendly|pages/);
    expect(h.length).toBeLessThanOrEqual(32);
  });

  it("never opens the headline on a determiner", () => {
    // A cover headline is a label, not a sentence. On a long title the fit stops
    // mid-phrase, and "A production-grade retrieval" reads as a broken fragment
    // where "Production-grade retrieval" reads as a subject.
    const h = titleToCoverHeading(
      "Building a production-grade retrieval augmented generation pipeline with re-ranking and evaluation",
    );
    expect(h.split(/\s+/)[0].toLowerCase()).not.toBe("a");
    expect(h).toMatch(/production-grade/i);
  });

  it("still strips a real subtitle after a colon or a spaced dash", () => {
    expect(
      titleToCoverHeading("The Reliability Layer: Common LangSmith Use Cases"),
    ).not.toMatch(/Use Cases/i);
    expect(titleToCoverHeading("Caching — the cheap win")).not.toMatch(/cheap win/i);
  });

  it("never ends the headline on a glue word", () => {
    // "…pages with" is not a headline.
    for (const t of [
      "Making agent-friendly pages with content negotiation",
      "Building reliable pipelines for production systems",
    ]) {
      const last = titleToCoverHeading(t).split(/\s+/).pop()!.toLowerCase();
      expect(["with", "for", "of", "and", "the", "in", "on", "to"]).not.toContain(last);
    }
  });
});
