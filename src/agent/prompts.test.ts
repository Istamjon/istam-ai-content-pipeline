/**
 * Dual-audience contract tests.
 *
 * The brand has two audiences reading the SAME post: beginners/juniors/students/
 * IT entrepreneurs (primary, and by far the larger group) and middle+/AI
 * engineers/founders (secondary). "Keep it simple" and "give me the real detail"
 * are therefore not a trade-off to choose between — the post has to do both, in
 * layers.
 *
 * The failure mode is silent, which is why this is a test and not a comment: a
 * post that serves only beginners reads as filler to a senior engineer and never
 * earns a follow; a post that serves only seniors loses the larger audience the
 * brand is built on. Neither shows up as an error in the pipeline.
 */
import { roles, buildRewriteUserPrompt } from "./prompts.js";
import { brand } from "../config/brand.js";

/** The contract's own section markers. Written as a regex so a dash variant
 *  (— / – / -) cannot make the test silently stop matching. */
const LAYER_1 = /LAYER 1\s+[—–-]\s+THE PLAIN SENTENCE/;
const LAYER_2 = /LAYER 2\s+[—–-]\s+THE PRACTITIONER DETAIL/;

describe("dual-audience contract reaches the writers", () => {
  it("gives the Uzbek writer both layers", () => {
    expect(roles.writer).toMatch(LAYER_1);
    expect(roles.writer).toMatch(LAYER_2);
  });

  it("gives the English writer the same two layers", () => {
    // The English post is read by the same two audiences. If the contract only
    // reached the Uzbek writer, the LinkedIn/Threads audience would silently get
    // the weaker brief.
    expect(roles.englishWriter).toMatch(LAYER_1);
    expect(roles.englishWriter).toMatch(LAYER_2);
  });

  it("carries the rules that make the layers work, not just their names", () => {
    for (const role of [roles.writer, roles.englishWriter]) {
      // The rule that stops the post wasting the senior reader's time.
      expect(role).toContain("DO NOT explain what the reader can look up");
      // The rule that stops the post manufacturing drama to seem interesting.
      expect(role).toContain("Never manufacture drama");
      // The rule that stops "keep it simple" from deleting the senior layer.
      expect(role).toMatch(/never drop it to stay "simple"|never drop this layer/i);
    }
  });

  it("names the audience tiers from brand.ts rather than a private copy", () => {
    // The contract used to restate the audiences as prose ("beginner/junior
    // developers, students, IT entrepreneurs"), which is a second copy of
    // `brand.targetAudience` that nothing kept in sync. It now interpolates the
    // declared lists, so changing the brand changes the contract.
    expect(roles.writer).toContain(brand.targetAudience.primary[0]);
    expect(roles.writer).toContain(brand.targetAudience.secondary[0]);
    expect(roles.englishWriter).toContain(brand.targetAudience.primary[0]);
  });

  it("keeps the primary audience labelled as the one not to lose", () => {
    // Order matters: the primary audience is the larger one, and the whole point
    // of the contract is that it must not be sacrificed for the secondary one.
    const primaryAt = roles.writer.indexOf("primary (the larger audience");
    const secondaryAt = roles.writer.indexOf("secondary (the one that decides");
    expect(primaryAt).toBeGreaterThan(-1);
    expect(secondaryAt).toBeGreaterThan(primaryAt);
  });
});

describe("dual-audience contract reaches the rewrite path", () => {
  const prompt = buildRewriteUserPrompt({
    title: "Making agent-friendly pages with content negotiation",
    sourceUrl: "https://example.com/post",
    body: "SOURCE BODY",
  });

  it("carries the contract into the rewrite prompt", () => {
    // The rewrite prompt is a separate code path from `roles.writer`, so a fix
    // applied only to the role would be bypassed on every quality failure.
    expect(prompt).toContain("DUAL AUDIENCE");
    expect(prompt).toContain("DO NOT explain what the reader can look up");
    expect(prompt).toContain("Never manufacture drama");
  });

  it("uses the condensed form, because this prompt already carries 10k of source", () => {
    // The long form is ~1.3k chars and would be paid on every rewrite to say the
    // same thing. Guard the intent, not an exact length.
    expect(prompt).not.toMatch(LAYER_1);
    expect(prompt.length).toBeLessThan(20000);
  });

  it("reuses the canonical rule sentences instead of paraphrasing them", () => {
    // The condensed form first paraphrased the rules, so a single rule existed
    // in two wordings — the exact drift this refactor keeps finding elsewhere
    // (the brand palette, the audience list, the never-publish rules). Both
    // forms now carry these sentences verbatim.
    const canonical = [
      "DO NOT explain what the reader can look up",
      "Never manufacture drama — the source's own specifics are the hook.",
    ];
    for (const rule of canonical) {
      expect(roles.writer).toContain(rule);
      expect(roles.englishWriter).toContain(rule);
      expect(prompt).toContain(rule);
    }
  });
});
