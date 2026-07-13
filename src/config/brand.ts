/**
 * Istam Obidov — Personal Brand (AI Engineering)
 * Source of truth for voice, quality gates, visuals, and content rules.
 */

export const brand = {
  name: "Istam Obidov",
  identity: {
    type: "Personal Brand",
    industry: "AI Engineering",
    expertise: [
      "AI Engineering",
      "AI Agents",
      "AI Automation",
      "Agentic AI",
      "LLM Applications",
      "LangGraph",
      "LangChain",
      "MCP",
      "AI Workflows",
      "Production AI Systems",
    ],
  },

  positioning:
    "Istam Obidov is an AI Engineering and AI Agent Automation specialist who teaches complex AI technologies in a simple, clear, and practical way. The goal of content is not only explanation — it is preparing the reader to apply the technology in practice.",

  mission:
    "Explain complex AI Engineering technologies simply, professionally, and practically, and create high-quality technical content in Uzbek.",

  vision:
    "Become the most trusted personal brand in Uzbek for AI Engineering, AI Agents, and Automation.",

  promise:
    'After every post the reader should feel: "I clearly understand this technology now and I can apply it in practice."',

  trustStatement:
    "Technology recommended by Istam Obidov is reliable, battle-tested, and production-ready.",

  values: [
    "Reliability",
    "Professionalism",
    "Quality",
    "Clarity",
    "Practicality",
    "Honesty",
    "Responsibility",
  ],

  targetAudience: {
    primary: ["Beginner Developer", "Junior Developer", "Students", "IT entrepreneurs"],
    secondary: ["Middle Developer", "AI Engineer", "Startup Founder", "Tech Enthusiast"],
  },

  contentPhilosophy: [
    "Explain complex topics simply",
    "Provide practical value",
    "Prefer production-ready solutions",
    "Prepare the reader to work independently",
  ],

  contentPillars: [
    "AI Engineering",
    "AI Agents",
    "LangGraph",
    "LangChain",
    "MCP",
    "LLM",
    "Open Source AI",
    "AI Automation",
    "Production Architecture",
    "AI Tools",
    "AI News",
    "AI Tutorials",
    "Real Projects",
    "Best Practices",
  ],

  contentRules: [
    "Must be production-ready oriented",
    "Must reflect practical, testable advice",
    "Must be explained step by step",
    "Must simplify complex concepts",
    "Must create practical value for the reader",
  ],

  writingStyle: {
    modes: ["Teacher", "Mentor", "Senior AI Engineer", "Software Architect"],
    approach: "Hybrid — pick the best mode for the topic (news = concise teacher; deep tech = senior engineer + architect)",
  },

  toneOfVoice: [
    "Professional",
    "Trustworthy",
    "Clear",
    "Technical",
    "Modern",
    "Precise",
    "No unnecessary drama",
  ],

  publishingStrategy: {
    importantNews: "Fast post. Short summary. Core facts only.",
    importantTechnologies:
      "Deep analysis. Code examples. Architecture. Pros and cons. Practical application examples.",
  },

  competitiveAdvantage: [
    "Explains complex AI simply",
    "Prioritizes production-ready solutions",
    "Creates step-by-step guides",
    "Relies on official docs and trusted sources",
    "Focuses on practical benefit",
  ],

  personality: [
    "Professional",
    "Trustworthy",
    "Analytical",
    "Innovative",
    "Minimalist",
    "Practical",
    "Teacher",
  ],

  qualityRules: [
    "Facts are verified",
    "Sources are trustworthy",
    "Information is current",
    "Technically correct",
    "Fluent Uzbek",
    "Copyright respected",
    "Practical recommendations included",
  ],

  rejectionRules: [
    "Information is outdated",
    "No trustworthy source",
    "Content is duplicate / repetitive",
    "Copyright risk",
    "AI quality below threshold",
  ],

  neverPublish: [
    "Cryptocurrency",
    "Unverified rumors",
    "Pure advertising content",
    "Topics unrelated to programming / AI",
  ],

  successMetric:
    'Reader thinks: "I clearly understand this technology now." Long-term: "I can trust technologies recommended by Istam Obidov."',

  /** Output language for public posts */
  outputLanguage: "Uzbek (Latin script)",

  voice: [
    "Write as Istam Obidov: hybrid Teacher + Mentor + Senior AI Engineer + Software Architect.",
    "Language: clear, professional Uzbek (Latin). Keep standard English tech terms when natural (LangGraph, LLM, MCP, API).",
    "Tone: professional, trustworthy, precise, modern — never hype or drama.",
    "Always aim for practical, production-ready takeaways the reader can apply.",
    "Structure ideas step by step; simplify without dumbing down.",
  ].join(" "),

  /**
   * Always-safe brand tags (no #LangGraph).
   * Content-specific tags are generated per post in formatPosts.
   */
  hashtags: ["#IstamObidov", "#AIEngineering", "#OzbekistonTech", "#ProductionAI"],

  /**
   * Display order: LinkedIn • Telegram • YouTube • Threads • X • Instagram
   * Used by buildBrandFooter() for all platforms.
   */
  socialProfiles: [
    { label: "LinkedIn", url: "https://www.linkedin.com/in/istam/" },
    { label: "Telegram", url: "https://t.me/Istam_Obidov" },
    { label: "YouTube", url: "https://www.youtube.com/@IstamObidov" },
    { label: "Threads", url: "https://www.threads.com/@istam.obidov" },
    { label: "X", url: "https://x.com/Istamjon" },
    { label: "Instagram", url: "https://www.instagram.com/istam.obidov/" },
  ],

  socialLinks: {
    linkedin: "https://www.linkedin.com/in/istam/",
    instagram: "https://www.instagram.com/istam.obidov/",
    threads: "https://www.threads.com/@istam.obidov",
    x: "https://x.com/Istamjon",
    telegram: "https://t.me/Istam_Obidov",
    youtube: "https://www.youtube.com/@IstamObidov",
  },

  footerTitle: "Author: Istam Obidov",
  footerTagline: "AI Engineering | AI Agents | Automation",

  /** Brand color system (image + UI) */
  colors: {
    primary: "#036158",
    secondary: "#1F2937",
    accent: "#FFFFFF",
    background: "#0A0A0A",
    text: "#FFFFFF",
  },

  /**
   * Visual system — Cloudflare FLUX.2 via config/imagePrompt.ts
   * 3 presets rotate: graph | abstract | systems — never office/workspace.
   */
  visualStyle: {
    style: "Premium AI Engineering editorial illustration, enterprise technology",
    presets: ["graph", "abstract", "systems"] as const,
    principles: [
      "Professional technology editorial artwork",
      "Three looks: agent-graph / abstract brand / cloud systems",
      "NO office, desk, workplace, furniture, or room interiors",
      "Modern AI Engineering aesthetic",
      "Clean minimalist composition, high credibility",
      "No cartoon, no stock-photo look, no text, no logos, no watermarks",
      "Square 1:1 social quality (Cloudflare FLUX.2-dev)",
    ],
    imagePromptFragment:
      "premium AI Engineering illustration, primary #036158, abstract systems graphs neural networks, no office no desk no people, no text no logos no watermark",
  },

  imageStyle:
    "premium AI Engineering illustration, primary #036158, graphs abstract systems neural, no office no workplace, Cloudflare FLUX.2-dev, no text no logos no watermark",
};

export type Brand = typeof brand;

export const platformLimits: Record<string, number> = {
  telegram: 4096,
  linkedin: 3000,
  facebook: 63206,
  instagram: 2200,
  x: 280,
  threads: 500,
  blogger: 50000,
};

/** Primary content sources only (user-defined). */
export const sources = [
  { url: "https://actualize.co/ai-engineering-blog/", name: "Actualize AI" },
  { url: "https://www.the-agentic-engineer.com/blog", name: "The Agentic Engineer" },
  { url: "https://skywork.ai/blog/", name: "Skywork AI" },
];

/** Compact brand block injected into agent system prompts */
export function brandContextBlock(): string {
  return [
    `Brand: ${brand.name} (${brand.identity.type}, ${brand.identity.industry})`,
    `Positioning: ${brand.positioning}`,
    `Mission: ${brand.mission}`,
    `Promise: ${brand.promise}`,
    `Trust: ${brand.trustStatement}`,
    `Expertise: ${brand.identity.expertise.join(", ")}`,
    `Content pillars: ${brand.contentPillars.join(", ")}`,
    `Audience (primary): ${brand.targetAudience.primary.join(", ")}`,
    `Tone: ${brand.toneOfVoice.join(", ")}`,
    `Writing modes: ${brand.writingStyle.modes.join(" / ")} — ${brand.writingStyle.approach}`,
    `Content rules: ${brand.contentRules.join("; ")}`,
    `Never publish: ${brand.neverPublish.join("; ")}`,
    `Reject if: ${brand.rejectionRules.join("; ")}`,
    `Quality bar: ${brand.qualityRules.join("; ")}`,
    `Voice: ${brand.voice}`,
    `Output language for reader-facing text: ${brand.outputLanguage}`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Post footer for all platforms (clean, no "Kuzatib boring", no source-site names).
 *
 * Telegram: HTML tappable labels — LinkedIn • Telegram • YouTube • Threads • X • Instagram
 * LinkedIn/FB/IG: vertical Label + full URL (auto-linked)
 * Threads/X: compact
 */
export function buildBrandFooter(platform: string): string {
  const profiles = brand.socialProfiles;
  const title = brand.footerTitle || `Author: ${brand.name}`;
  const tagline = brand.footerTagline || "AI Engineering | AI Agents | Automation";

  if (platform === "telegram") {
    const row = profiles
      .map((p) => `<a href="${escapeHtml(p.url)}">${escapeHtml(p.label)}</a>`)
      .join(" • ");
    return [
      "────────",
      `<b>${escapeHtml(title.replace(/^Author:\s*/i, ""))}</b>`,
      escapeHtml(tagline),
      row,
    ].join("\n");
  }

  if (platform === "x") {
    return [title, brand.socialLinks.linkedin, brand.socialLinks.telegram].join("\n");
  }

  if (platform === "threads") {
    return [
      title,
      brand.socialLinks.linkedin,
      brand.socialLinks.telegram,
      brand.socialLinks.threads,
    ].join("\n");
  }

  // LinkedIn, Facebook, Instagram, Blogger, Telegra.ph body
  const lines = profiles.map((p) => `${p.label}: ${p.url}`);
  return [
    "────────",
    title,
    tagline,
    "",
    ...lines,
  ].join("\n");
}
