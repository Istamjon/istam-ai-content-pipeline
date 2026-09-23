import {
  capDraftLength,
  looksComplete,
  repairTruncation,
  stripUnsupportedNumbers,
  normalizeParagraphs,
  longestParagraph,
  PARAGRAPH_SOFT_CAP,
  MAX_BODY_CHARS,
  MAX_DRAFT_CHARS,
} from "./draftRepair.js";

describe("draftRepair", () => {
  it("repairTruncation drops mid-word tail", () => {
    const raw =
      "Agentlar zanjiri productionda muhim. Asosiy faktlar:\n• LangGraph ishlatiladi\n• metada";
    const fixed = repairTruncation(raw);
    expect(fixed).toMatch(/LangGraph/);
    expect(fixed).not.toMatch(/metada/);
    expect(looksComplete(fixed)).toBe(true);
  });

  it("stripUnsupportedNumbers removes invented percentages", () => {
    const src = "Designers use AI tools in their workflow.";
    const draft =
      "Dizaynerlar AI ishlatadi. Tadqiqotlarga ko‘ra 92% vulnerabilities topildi.\n• 4x duplication\n• Asosiy fakt: AI yordam beradi.";
    const out = stripUnsupportedNumbers(draft, src);
    expect(out).not.toMatch(/92%/);
    expect(out).not.toMatch(/4x/i);
    expect(out.toLowerCase()).toMatch(/ai/);
  });

  it("keeps numbers present in source", () => {
    const src = "Latency dropped by 40% in production.";
    const draft = "Latency 40% ga tushdi productionda.";
    expect(stripUnsupportedNumbers(draft, src)).toMatch(/40%/);
  });

  describe("capDraftLength", () => {
    // Regression: the cap used to be 2000 while the writer prompt asked for up
    // to 2600, so every draft silently lost its tail before the quality gate ran.
    it("leaves a draft that fits completely untouched", () => {
      const draft = "A".repeat(4400) + ". Tugadi.";
      expect(capDraftLength(draft)).toBe(draft);
    });

    it("keeps a 4400-char draft — the writer prompt's own target", () => {
      const sentences = Array.from(
        { length: 120 },
        (_, i) => `Bu ${i + 1}-jumla va u yetarlicha mazmunga ega.`,
      );
      const draft = sentences.join(" ");
      expect(draft.length).toBeGreaterThan(4400);
      const out = capDraftLength(draft);
      // Nothing below the prompt's hard max may be dropped.
      expect(out.length).toBeGreaterThanOrEqual(4400);
      expect(out.length).toBeLessThanOrEqual(MAX_DRAFT_CHARS);
    });

    it("cuts a runaway draft at a sentence boundary, never mid-word", () => {
      const draft = "Kalimaning oxiri. ".repeat(600);
      const out = capDraftLength(draft);
      expect(out.length).toBeLessThanOrEqual(MAX_DRAFT_CHARS);
      expect(out).toMatch(/[.!?…]$/);
      expect(looksComplete(out)).toBe(true);
    });

    it("keeps the body ceiling far above the plain-text Telegram target", () => {
      expect(MAX_BODY_CHARS).toBeGreaterThanOrEqual(2 * MAX_DRAFT_CHARS);
      expect(MAX_BODY_CHARS).toBeGreaterThan(4000);
    });
  });
});

/** Whitespace-insensitive word sequence, for the "nothing changed" assertion. */
function words(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const S1 = "LangSmith agentlarning har bir qadamini kuzatib boradi.";
const S2 =
  "Bu ishlab chiqarishda xatolarni topish uchun juda muhim imkoniyat hisoblanadi.";
const S3 =
  "Shuning uchun jamoalar uni bugunoq o'z oqimlariga qo'shishlari mumkin.";
/** One long prose block (~425 chars, 6 sentences) that must be re-flowed. */
const LONG_PROSE = `${S1} ${S2} ${S3} ${S1} ${S2} ${S3}`;

describe("normalizeParagraphs", () => {
  it("leaves a compliant body completely untouched", () => {
    const ok = `${S1}\n\n${S2}\n\n${S3}`;

    expect(normalizeParagraphs(ok)).toBe(ok);
  });

  it("splits a long prose paragraph at sentence boundaries", () => {
    expect(LONG_PROSE.length).toBeGreaterThan(PARAGRAPH_SOFT_CAP);

    const blocks = normalizeParagraphs(LONG_PROSE).split(/\n{2,}/);

    expect(blocks.length).toBeGreaterThan(1);
    for (const b of blocks) {
      expect(b.length).toBeLessThanOrEqual(PARAGRAPH_SOFT_CAP);
    }
  });

  it("never adds, drops or reorders a word", () => {
    expect(words(normalizeParagraphs(LONG_PROSE))).toBe(words(LONG_PROSE));
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = normalizeParagraphs(LONG_PROSE);

    expect(normalizeParagraphs(once)).toBe(once);
  });

  it("keeps links intact when re-flowing around them", () => {
    const url = "https://smith.langchain.com/docs/observability?tab=traces";
    const withLink = `${S1} Manba: ${url} ${S2} ${S3} ${S1} ${S2}`;

    const out = normalizeParagraphs(withLink);

    // A split inside the URL would break the link, so it must survive verbatim.
    expect(out).toContain(url);
    expect(words(out)).toBe(words(withLink));
  });

  it("does not re-flow headings, bullets, numbered lists or tables", () => {
    // Each block is over the cap AND carries markdown structure, so the only
    // correct outcome is "leave it exactly as written".
    const structured = [
      `## Muammo\n${S1} ${S2} ${S3} ${S1} ${S2} ${S3}`,
      `- ${S1} ${S2}\n- ${S1} ${S2}\n- ${S1} ${S2}`,
      `1. ${S1} ${S2}\n2. ${S1} ${S2}\n3. ${S1} ${S2}`,
      [
        "| ustun | qiymat |",
        "| --- | --- |",
        ...Array.from({ length: 6 }, () => `| ${S1} | ${S2} |`),
      ].join("\n"),
    ].join("\n\n");

    for (const block of structured.split(/\n{2,}/)) {
      expect(block.length).toBeGreaterThan(PARAGRAPH_SOFT_CAP);
    }
    expect(normalizeParagraphs(structured)).toBe(structured);
  });

  it("leaves a single over-long sentence alone rather than mangling it", () => {
    // No sentence boundary to cut at → nothing safe to do.
    const oneLongSentence = `${S1} ${S2} ${S3} ${S1} ${S2} ${S3} ${S1}`.replace(
      /[.!?…]\s+/g,
      " va ",
    );
    expect(oneLongSentence.length).toBeGreaterThan(PARAGRAPH_SOFT_CAP);

    expect(normalizeParagraphs(oneLongSentence)).toBe(oneLongSentence);
  });

  it("preserves blocks it could not safely split while fixing the ones it can", () => {
    const mixed = [
      "## Sarlavha",
      `- ${S1} ${S2}\n- ${S1} ${S2}\n- ${S1} ${S2}`,
      LONG_PROSE,
    ].join("\n\n");

    const out = normalizeParagraphs(mixed);

    expect(out).toContain("## Sarlavha");
    expect(out).toContain(`- ${S1} ${S2}`);
    expect(words(out)).toBe(words(mixed));
    // 2 structural blocks kept whole + the prose block split into ≥2.
    expect(out.split(/\n{2,}/).length).toBeGreaterThanOrEqual(4);
  });
});

describe("longestParagraph", () => {
  it("reports the longest block", () => {
    const t = `qisqa\n\n${"a".repeat(120)}\n\n${"b".repeat(40)}`;

    expect(longestParagraph(t)).toBe(120);
  });

  it("returns 0 for empty input", () => {
    expect(longestParagraph("")).toBe(0);
  });

  it("ignores structural blocks, because the repair ignores them too", () => {
    // The bug this pins: the metric and the repair disagreed. A four-item
    // bullet list was reported as an 861-char "paragraph" on a live post whose
    // longest real paragraph was 290 chars — and the repair had correctly left
    // the list alone, since inserting blank lines into a list corrupts it.
    // Anything the repair refuses to touch, the metric must not count.
    const item = "qadam va uning tafsiloti yetarlicha uzun";
    const bullet = `- ${Array.from({ length: 6 }, () => item).join(" ")}`;
    const t = [
      "## Sarlavha",
      "",
      "Siz bugun shu ishni qilasiz.",
      "",
      bullet,
      bullet,
      bullet,
      bullet,
    ].join("\n");

    // The list block alone is far past the cap...
    expect(t.split(/\n{2,}/).some((b) => b.length > PARAGRAPH_SOFT_CAP)).toBe(true);
    // ...but it is not prose, so the metric must not see it.
    expect(longestParagraph(t)).toBeLessThan(PARAGRAPH_SOFT_CAP);
    expect(longestParagraph(t)).toBe("Siz bugun shu ishni qilasiz.".length);
    // And the repair leaves it alone, which is what makes the two consistent.
    expect(normalizeParagraphs(t)).toBe(t);
  });

  it("brings a live-sized paragraph under the cap", () => {
    // One paragraph the size of the 913-char one the shipped post carried
    // (canonical 8a5ec485806b5d05 v1).
    let big = "";
    while (big.length < 913) big += (big ? " " : "") + S1;
    const shipped = `${S1}\n\n${big}\n\n${S2}`;

    expect(longestParagraph(shipped)).toBeGreaterThan(PARAGRAPH_SOFT_CAP);

    const fixed = normalizeParagraphs(shipped);
    expect(longestParagraph(fixed)).toBeLessThanOrEqual(PARAGRAPH_SOFT_CAP);
    // ...and nothing was lost on the way.
    expect(words(fixed)).toBe(words(shipped));
  });
});
