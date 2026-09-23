/**
 * Voice lint — what it must catch, and what it must stay quiet about.
 *
 * The lint is advisory by design (a voice gate in `qualityCheck` would block
 * posts, and a length gate there already broke the pipeline once). So these
 * tests pin both directions: the real defect must be caught, and a compliant
 * post must produce zero issues.
 */
import { voiceLint, formatVoiceLint } from "./voiceLint.js";

/** A post that satisfies every rule: concrete hook, "siz", short paragraphs. */
const CLEAN = `## Muammo

LangSmith 2026-yilda kuzatuv qatlamini taqdim etadi. Siz uni bir kunda o'rnatib, ishlab chiqarishga qo'shishingiz mumkin.

## Yechim

- Trace'larni yoqing va har bir qadamni yozib oling.
- Baholovchilarni sozlab, natijalarni taqqoslang.

Bugungi oqimingizda qaysi qadamni avtomatlashtirgansiz?`;

/**
 * The real production text that exposed the drift
 * (canonical 8a5ec485806b5d05 v1). Deliberately kept verbatim, including the
 * "hakam" rendering and the abstract opening, so the lint is measured against
 * what actually shipped rather than a convenient fixture.
 */
const REAL_POST = `## Muammo va Ishonchlilik Qatlami

Tibbiyotda sun'iy intellekt tizimlari to'g'ri ishlayotganini tekshiradigan eng malakali hakamlar – bular o'z vaqtini himoya qilish uchun shu tizim yaratilgan insonlardir. Klinitsist generatsiya qilingan eslatmada simptom to'g'ri ko'rsatilganini yoki bemorga tegishli yordam tavsiya etilganini darhol aniqlay oladi. Biroq ekspert validatsiyasi minglab uchrashuvlar davomida cheksiz ravishda qo'lda bajarib turolmaydigan kamyob resursga aylanadi va bu butun jarayonni sekinlashtiradi, chunki har bir natijani alohida ko'rib chiqish talab qilinadi.

Siz ham o'z loyihangizda ushbu bosqichlarni ketma-ket bajarishingiz mumkin.

Asosiy faktlar:

- LangSmith jamoalarga klinik sharhlarni yorliqlar, baholovchilar va ma'lumotlar to'plamiga aylantirish imkonini beradi.`;

const rules = (t: string) => voiceLint(t).issues.map((i) => i.rule);

describe("voiceLint — compliant text", () => {
  it("reports no issues for a post that follows the rules", () => {
    const result = voiceLint(CLEAN);

    expect(result.issues).toEqual([]);
    expect(result.metrics.addressesReader).toBe(true);
    expect(result.metrics.hookHasConcreteDetail).toBe(true);
    expect(result.metrics.hasHeadings).toBe(true);
    expect(result.metrics.hasList).toBe(true);
  });

  it("handles empty input without throwing", () => {
    expect(voiceLint("").issues[0].rule).toBe("empty");
    expect(voiceLint("   ").metrics.words).toBe(0);
  });
});

describe("voiceLint — the real defect", () => {
  it("catches the forbidden glossary rendering", () => {
    const result = voiceLint(REAL_POST);
    const violation = result.issues.find(
      (i) => i.rule === "glossary-violation",
    );

    expect(violation).toBeDefined();
    expect(violation!.detail).toContain("hakam");
    expect(violation!.detail).toContain("baholovchi");
  });

  it("matches inflected forms, not just the bare stem", () => {
    // The live post says "hakamlar", never "hakam" on its own — Uzbek is
    // agglutinative, so a whole-word boundary would miss every real occurrence.
    for (const form of ["hakam", "hakamlar", "hakamning", "hakamlar va"]) {
      expect(
        rules(`LangSmith ${form} bilan ishlaydi, siz buni ko'rasiz.`),
      ).toContain("glossary-violation");
    }
  });

  it("reports the hook as a metric but never as an issue", () => {
    // The live post opened by naming exactly what goes wrong — navigation
    // menus, stylesheets, JavaScript bundles, tracking scripts — and an earlier
    // version of this lint called that "abstract" because it contained neither
    // a digit nor a glossary term. Telling the reader a good hook is bad is
    // worse than no signal, so the signal is surfaced for a human to judge and
    // kept out of the issue count.
    const result = voiceLint(REAL_POST);
    expect(result.metrics.hookHasConcreteDetail).toBe(false);
    expect(result.issues.map((i) => i.rule)).not.toContain("abstract-hook");
  });

  it("catches the over-long PROSE paragraph", () => {
    // 448 chars of real prose in the live post — genuinely over the cap.
    expect(rules(REAL_POST)).toContain("paragraph-too-long");
  });

  it("does NOT count a bullet list as an over-long paragraph", () => {
    // The false positive that this rule shipped with: the live post's 899-char
    // four-item list was reported as a 913-char "paragraph" while its longest
    // real paragraph was 448. A list cannot be split, and the cap is a prose
    // readability rule, so lists must not be measured at all.
    const post = [
      "## Sarlavha",
      "",
      "Siz bugun shu ishni qilasiz.",
      "",
      "- " + "birinchi qadam va buning tafsiloti yetarlicha uzun ".repeat(6),
      "- " + "ikkinchi qadam va buning tafsiloti yetarlicha uzun ".repeat(6),
      "- " + "uchinchi qadam va buning tafsiloti yetarlicha uzun ".repeat(6),
      "- " + "to'rtinchi qadam va buning tafsiloti yetarlicha uzun ".repeat(6),
    ].join("\n");

    expect(voiceLint(post).metrics.longestParagraph).toBeLessThan(350);
    expect(rules(post)).not.toContain("paragraph-too-long");
  });

  it("does NOT invent problems the post does not have", () => {
    const r = rules(REAL_POST);

    // The real post had a clean structure: no filler, no intensifiers, and it
    // does address the reader.
    expect(r).not.toContain("banned-opener");
    expect(r).not.toContain("attribution-intro");
    expect(r).not.toContain("empty-intensifier");
    expect(r).not.toContain("filler");
    expect(r).not.toContain("no-reader-address");
  });
});

describe("voiceLint — individual rules", () => {
  it("detects generic openers across apostrophe variants", () => {
    // The pipeline emits U+2019/U+2018 in real output; a pattern that only
    // matches the ASCII apostrophe would silently miss.
    for (const apo of ["'", "\u2019", "\u2018"]) {
      expect(
        rules(`Bugungi tez o${apo}zgarayotgan dunyoda AI muhim.`),
      ).toContain("banned-opener");
    }
    expect(rules("In today's fast-paced world, AI matters.")).toContain(
      "banned-opener",
    );
  });

  it("detects site-name attribution intros", () => {
    expect(rules("Yangi Skywork AI maqolasi: agentlar haqida.")).toContain(
      "attribution-intro",
    );
  });

  it("detects empty intensifiers in both languages", () => {
    expect(rules("Bu juda kuchli yechim. Siz sinab ko'ring.")).toContain(
      "empty-intensifier",
    );
    expect(rules("A powerful, seamless tool. You can try it.")).toContain(
      "empty-intensifier",
    );
  });

  it("does not fire on a word that merely contains an intensifier", () => {
    // "kuchli" inside a longer word must not match.
    expect(rules("Kuchliroq natija uchun sozlamani o'zgartiring, siz.")).not.toContain(
      "empty-intensifier",
    );
  });

  it("detects rhetorical filler", () => {
    expect(rules("Tasavvur qiling, siz agent qurasiz.")).toContain("filler");
  });

  it("reports a missing reader address", () => {
    expect(rules("LangGraph 2026-da chiqarildi. Bu muhim yangilik.")).toContain(
      "no-reader-address",
    );
  });

  it("accepts a hook that names a technology instead of a number", () => {
    const m = voiceLint(
      "LangGraph agentlarni boshqaradi. Siz uni bugun sinab ko'rishingiz mumkin.",
    ).metrics;
    expect(m.hookHasConcreteDetail).toBe(true);
  });

  it("flags a heading on the very first line", () => {
    expect(voiceLint(REAL_POST).metrics.firstLineIsHeading).toBe(true);
    expect(voiceLint(CLEAN).metrics.firstLineIsHeading).toBe(true);
    expect(
      voiceLint("Agentlar bugun ishlab chiqarishda muhim, siz buni bilasiz.")
        .metrics.firstLineIsHeading,
    ).toBe(false);
  });

  it("strips markdown before measuring, so links do not skew the hook", () => {
    const m = voiceLint(
      "## Sarlavha\n\n[LangSmith](https://example.com/a) 3 ta trace yozadi. Siz sozlaysiz.",
    ).metrics;
    expect(m.hookHasConcreteDetail).toBe(true);
    expect(m.paragraphs).toBeGreaterThan(0);
  });
});

describe("formatVoiceLint", () => {
  it("summarises metrics and lists every issue", () => {
    const out = formatVoiceLint(voiceLint(REAL_POST));

    expect(out).toContain("voice issues=");
    expect(out).toContain("longestParagraph=");
    expect(out).toContain("glossary-violation");
  });

  it("says so when there is nothing to report", () => {
    const out = formatVoiceLint(voiceLint(CLEAN));

    expect(out).toContain("voice issues=0");
    expect(out).not.toContain("! ");
  });
});
