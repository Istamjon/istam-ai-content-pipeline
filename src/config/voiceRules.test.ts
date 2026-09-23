/**
 * Brand-voice rules — data integrity and false-positive guards.
 *
 * The rules used to be a hardcoded 2-entry array in `qualityCheck.ts` next to a
 * no-op `for (const topic of brand.neverPublish) { void topic; }` loop, so two
 * of the four declared never-publish rules were enforced only by accident and
 * nothing noticed. These tests make the declaration and the enforcement
 * impossible to separate again.
 */
import { brand } from "./brand.js";
import { GLOSSARY, NEVER_PUBLISH_CHECKS, isHardIssue } from "./voiceRules.js";

/**
 * The body of the post that exposed the voice drift
 * (canonical 8a5ec485806b5d05 v1, 2026-09-23 11:31:45Z) — real production text.
 * Every never-publish check must stay silent on it: a false positive here blocks
 * a whole day's post.
 */
const REAL_POST = `## Muammo va Ishonchlilik Qatlami

Tibbiyotda sun'iy intellekt tizimlari to'g'ri ishlayotganini tekshiradigan eng malakali hakamlar – bular o'z vaqtini himoya qilish uchun shu tizim yaratilgan insonlardir. Klinitsist generatsiya qilingan eslatmada simptom to'g'ri ko'rsatilganini yoki bemorga tegishli yordam tavsiya etilganini darhol aniqlay oladi.

Abridge bemor va klinitsist o'rtasidagi suhbatlarni tibbiy eslatmalarga aylantirib, billing jarayonini qo'llab-quvvatlaydi. Included Health esa LangGraph va Deep Agents asosida qurilgan Dot nomli sun'iy intellekt tibbiy yo'riqnosini ishga tushirgan.

## Baholash Jarayonlarini Avtomatlashtirish

Klinik tekshiruvni takrorlanuvchi operatsion xarajat emas, balki barqaror infratuzilma sifatida ko'rish kerak. LangSmith jamoalarga individual klinik sharhlarni kelgusi versiyalarda qayta ishlatish mumkin bo'lgan yorliqlar, baholovchilar va ma'lumotlar to'plamiga aylantirish imkonini beradi.

Siz ham o'z loyihangizda ushbu bosqichlarni ketma-ket bajarishingiz mumkin:

- Klinitsistlar va foydalanuvchilarning fikr-mulohazalaridan kelib chiqqan holda asosiy xato turlarini aniqlang.
- Referenssiz hakamlarni yaratib, generatsiya qilingan natijalarni bevosita manba suhbatiga nisbatan baholang.
- LangSmith'ning Align Evaluator vositasi yordamida hakamlar va klinisyen izohlarini o'zaro solishtiring.

Bugungi ish jarayoningizda ekspert fikrini kelgusida avtomatik ishlatish uchun qanday ma'lumotlar to'plami va baholovchilarni shakllantirgansiz?

Asosiy faktlar:

- LangSmith jamoalarga klinik sharhlarni yorliqlar, baholovchilar va ma'lumotlar to'plamiga aylantirish imkonini beradi.
- Abridge kompaniyasi baholash jarayonlarini ishga tushirish uchun LangSmith'dan foydalanadi.
- Dot LangGraph va Deep Agents asosida qurilgan.`;

describe("never-publish rules", () => {
  it("enforces every rule declared in brand.neverPublish", () => {
    const declared = new Set<string>(brand.neverPublish);
    const enforced = new Set(NEVER_PUBLISH_CHECKS.map((c) => c.rule));

    // Contract: a declared rule with no check is a promise the code does not
    // keep. This is exactly how T3 hid for so long.
    for (const rule of declared) {
      expect(enforced.has(rule)).toBe(true);
    }
    expect(enforced.size).toBe(declared.size);
  });

  it("stays completely silent on the real published post", () => {
    const fired = NEVER_PUBLISH_CHECKS.filter((c) => c.hit(REAL_POST)).map(
      (c) => c.label,
    );

    expect(fired).toEqual([]);
  });

  it("labels every check so qualityCheck treats it as hard", () => {
    for (const c of NEVER_PUBLISH_CHECKS) {
      expect(c.label).toMatch(/never-publish/i);
    }
  });

  it("classifies every label as hard via the shared predicate", () => {
    // `qualityCheck` no longer carries its own copy of the hard/soft regex —
    // it calls `isHardIssue`. If a label ever stops matching, the rule silently
    // degrades from "blocks publish" to "soft-passed on the last retry", which
    // is the exact failure mode this whole refactor exists to prevent.
    for (const c of NEVER_PUBLISH_CHECKS) {
      expect(isHardIssue(c.label)).toBe(true);
    }
  });

  it("pins the two labels that predate the refactor", () => {
    // These strings are grepped by eye in the ops logs, and 1,385 posts were
    // published while they were the only two never-publish labels in use.
    // Re-wording them silently breaks that history, so pin them byte-for-byte.
    const labels = NEVER_PUBLISH_CHECKS.map((c) => c.label);
    expect(labels).toContain("Never-publish topic: cryptocurrency");
    expect(labels).toContain("Never-publish: unverified rumor / clickbait");
  });

  it("still catches cryptocurrency and rumours", () => {
    const crypto = NEVER_PUBLISH_CHECKS.find((c) =>
      c.rule.includes("Cryptocurrency"),
    )!;
    const rumor = NEVER_PUBLISH_CHECKS.find((c) =>
      c.rule.includes("rumor"),
    )!;

    expect(crypto.hit("Bitcoin va NFT haqida maqola.")).toBe(true);
    expect(crypto.hit(REAL_POST)).toBe(false);
    expect(rumor.hit("Bu mish-mish, tasdiqlanmagan.")).toBe(true);
    expect(rumor.hit(REAL_POST)).toBe(false);
  });

  it("needs TWO signals before calling something an advertisement", () => {
    const ad = NEVER_PUBLISH_CHECKS.find((c) =>
      c.rule.includes("advertising"),
    )!;

    // A single promotional word inside a technical post must NOT block it.
    expect(ad.hit("Chegirma tizimini LangGraph bilan avtomatlashtirdik.")).toBe(
      false,
    );
    // Promotional wording AND a price is an ad.
    expect(ad.hit("Chegirma! Kurs narxi 500 000 so'm.")).toBe(true);
    // Promotional wording AND an ad-only CTA is an ad.
    expect(ad.hit("Chegirma! Hoziroq ro'yxatdan o'ting.")).toBe(true);
    expect(ad.hit(REAL_POST)).toBe(false);
  });

  it("flags text with no AI/engineering subject at all", () => {
    const off = NEVER_PUBLISH_CHECKS.find((c) => c.rule.includes("unrelated"))!;

    expect(off.hit("Bugun bog'da sayr qildik va choy ichdik.")).toBe(true);
    expect(off.hit(REAL_POST)).toBe(false);
  });
});

describe("glossary integrity", () => {
  it("never lists the same term as both keep-English and translate", () => {
    const keep = GLOSSARY.keepEnglish.map((t) => t.toLowerCase());
    for (const p of GLOSSARY.preferredUz) {
      const en = p.en.split("/")[0].trim().toLowerCase();
      expect(keep).not.toContain(en);
    }
  });

  it("gives every forbidden rendering a replacement", () => {
    for (const b of GLOSSARY.bannedUz) {
      expect(b.useInstead.trim().length).toBeGreaterThan(0);
      expect(b.why.trim().length).toBeGreaterThan(0);
      expect(b.uz).not.toBe(b.useInstead);
    }
  });

  it("does not forbid a rendering it also recommends", () => {
    const preferred = GLOSSARY.preferredUz.map((p) => p.uz.toLowerCase());
    for (const b of GLOSSARY.bannedUz) {
      expect(preferred).not.toContain(b.uz.toLowerCase());
    }
  });
});
