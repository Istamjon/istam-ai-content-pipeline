/**
 * Brand-contract tests.
 *
 * These guard the *links* between what the brand declares and what the pipeline
 * actually does — the place the real defects were, and a place a human cannot
 * police because both sides look correct in isolation:
 *
 *  - `brandContextBlock()` is the only channel from `brand.ts` into a prompt, so
 *    seven declared fields (values, personality, competitiveAdvantage,
 *    successMetric, contentPhilosophy, publishingStrategy, secondary audience)
 *    were invisible to every writer.
 *  - the English writer was handed a brand block saying "Uzbek (Latin script)"
 *    and its own last line saying "Professional English".
 *  - `config/imagePrompt.ts` declared its own copy of the brand palette, and the
 *    hexes reached prompts as literals rather than from that copy.
 *
 * The never-publish rule contract lives in `voiceRules.test.ts`, next to the
 * rules themselves.
 */
import { brand, brandContextBlock, BRAND_COLORS } from "./brand.js";
import {
  GLOSSARY,
  BANNED_OPENERS,
  bannedPhraseBlock,
} from "./voiceRules.js";
import { brandImageColors, buildPremiumImagePrompt } from "./imagePrompt.js";
import { roles } from "../agent/prompts.js";

describe("brandContextBlock carries the whole spec", () => {
  const block = brandContextBlock();

  it("includes the fields that used to be orphaned", () => {
    // Each of these was declared in brand.ts and rendered nowhere, so no writer
    // ever saw it. Assert the *content*, not a label, so renaming a field cannot
    // leave a stale literal behind and still pass.
    expect(block).toContain(brand.values[0]);
    expect(block).toContain(brand.personality[0]);
    expect(block).toContain(brand.competitiveAdvantage[0]);
    expect(block).toContain(brand.contentPhilosophy[0]);
    expect(block).toContain(brand.publishingStrategy.importantTechnologies);
    expect(block).toContain(brand.targetAudience.secondary[0]);
    expect(block).toContain(brand.successMetric);
  });

  it("includes every remaining declared field", () => {
    for (const expected of [
      brand.positioning,
      brand.mission,
      brand.promise,
      brand.trustStatement,
      brand.voice,
      brand.qualityRules[0],
      brand.contentRules[0],
      brand.rejectionRules[0],
      brand.neverPublish[0],
    ]) {
      expect(block).toContain(expected);
    }
  });

  it("defaults to the brand's declared output language", () => {
    expect(block).toContain(
      `Output language for reader-facing text: ${brand.outputLanguage}`,
    );
  });

  it("lets a caller override the language without restating the block", () => {
    const en = brandContextBlock({ language: "Professional English" });
    expect(en).toContain(
      "Output language for reader-facing text: Professional English",
    );
    expect(en).not.toContain(`reader-facing text: ${brand.outputLanguage}`);
    // The rest of the spec must survive the override.
    expect(en).toContain(brand.mission);
  });

  it("appends platform voice only when a platform is named", () => {
    expect(block).not.toMatch(/Platform voice for/);
    const tg = brandContextBlock({ platform: "telegram" });
    expect(tg).toMatch(/Platform voice for telegram:/);
    expect(tg).toMatch(/This post is for telegram\./);
  });

  it("gives the English writer English, not a contradiction", () => {
    // The defect: the English role's brand block said Uzbek while its own last
    // line said "Professional English" — both inside the same prompt.
    const englishRole = roles.englishWriter;
    expect(englishRole).not.toMatch(/reader-facing text: Uzbek/);
    expect(englishRole).toMatch(/Professional English/);
  });

  it("gives the master-body writer Telegram's declared voice", () => {
    expect(roles.writer).toMatch(/Platform voice for telegram:/);
  });
});

describe("the palette has one home", () => {
  it("exposes brand.colors as the same object as BRAND_COLORS", () => {
    expect(brand.colors).toBe(BRAND_COLORS);
  });

  it("derives the image palette from the brand palette", () => {
    expect(brandImageColors.primary).toBe(BRAND_COLORS.primary);
    expect(brandImageColors.accentCyan).toBe(BRAND_COLORS.accentCyan);
    expect(brandImageColors.black).toBe(BRAND_COLORS.background);
    expect(brandImageColors.darkGray).toBe(BRAND_COLORS.secondary);
    expect(brandImageColors.hotAmber).toBe(BRAND_COLORS.hotAmber);
  });

  it("renders the brand hexes into a real image prompt", () => {
    // The hexes used to survive only as literals inside prose strings, so this
    // asserts the prompt is built from the palette rather than from a copy.
    const { prompt } = buildPremiumImagePrompt(
      "Introducing Multi-Agent Orchestration in Production",
      "LangGraph agent orchestration",
    );
    expect(prompt).toContain(BRAND_COLORS.primary);
    expect(prompt).toContain(BRAND_COLORS.accentCyan);
  });

  it("templates the brand's own visual-style prose from the palette", () => {
    // `visualStyle.principles` used to hardcode the hexes inside a string that
    // no template could update.
    const joined = brand.visualStyle.principles.join("\n");
    expect(joined).toContain(BRAND_COLORS.primary);
    expect(joined).toContain(BRAND_COLORS.accentCyan);
  });
});

describe("voice rules reach the writer", () => {
  it("puts the shared voice rules in both writer prompts", () => {
    // The writer is told exactly what the linter later checks; the two used to
    // be separate copies in separate files.
    for (const role of [roles.writer, roles.englishWriter]) {
      expect(role).toContain(bannedPhraseBlock());
      expect(role).toContain(GLOSSARY.bannedUz[0].useInstead);
      expect(role).toContain(BANNED_OPENERS[0].phrase);
    }
  });

  it("no longer asks the visual director for a logo the rules ban", () => {
    expect(roles.visualDirector).toMatch(/NO IO\/logo monogram/);
    expect(roles.visualDirector).not.toMatch(/brand logo/i);
  });
});
