/**
 * Markdown → rich-message HTML.
 *
 * Two things must hold:
 *   1. Structure the writer emits (headings, lists, quotes, links) becomes real
 *      markup, because rich messages render it and `cleanPostBody` throws it
 *      away for the plain-text platforms.
 *   2. Nothing in the source text can ever become markup. Every text run is
 *      escaped before tags are inserted, so a literal `<` cannot open a tag.
 */
import { markdownToRichHtml } from "./markdownToRichHtml.js";

describe("markdownToRichHtml — structure", () => {
  it("converts headings", () => {
    expect(markdownToRichHtml("## Sarlavha")).toBe("<h2>Sarlavha</h2>");
    expect(markdownToRichHtml("### Kichik")).toBe("<h3>Kichik</h3>");
  });

  it("converts bullet runs into one list", () => {
    expect(markdownToRichHtml("- bir\n- ikki\n- uch")).toBe(
      "<ul><li>bir</li><li>ikki</li><li>uch</li></ul>",
    );
  });

  it("converts numbered runs into an ordered list", () => {
    expect(markdownToRichHtml("1. bir\n2. ikki")).toBe(
      "<ol><li>bir</li><li>ikki</li></ol>",
    );
  });

  it("does not merge a bullet list into a numbered one", () => {
    expect(markdownToRichHtml("- bir\n1. ikki")).toBe(
      "<ul><li>bir</li></ul>\n<ol><li>ikki</li></ol>",
    );
  });

  it("converts block quotations and thematic breaks", () => {
    expect(markdownToRichHtml("> iqtibos")).toBe(
      "<blockquote>iqtibos</blockquote>",
    );
    expect(markdownToRichHtml("---")).toBe("<hr/>");
  });

  it("keeps adjacent lines as separate paragraphs", () => {
    // A single newline collapses in rich HTML, which is what turned a 5-step
    // list into one run-on paragraph.
    expect(markdownToRichHtml("Birinchi gap.\nIkkinchi gap.")).toBe(
      "<p>Birinchi gap.</p>\n<p>Ikkinchi gap.</p>",
    );
  });

  it("rejoins a hard-wrapped sentence", () => {
    expect(markdownToRichHtml("Bu gap davom\netadi va tugaydi.")).toBe(
      "<p>Bu gap davom etadi va tugaydi.</p>",
    );
  });
});

describe("markdownToRichHtml — inline", () => {
  it("converts bold, italic and code", () => {
    expect(markdownToRichHtml("**qalin** va *kursiv* va `kod`")).toBe(
      "<p><b>qalin</b> va <i>kursiv</i> va <code>kod</code></p>",
    );
  });

  it("converts a markdown link into an anchor", () => {
    expect(markdownToRichHtml("[Telegram](https://t.me/x)")).toBe(
      '<p><a href="https://t.me/x">Telegram</a></p>',
    );
  });

  it("leaves snake_case alone", () => {
    expect(markdownToRichHtml("snake_case nom")).toBe("<p>snake_case nom</p>");
  });
});

describe("markdownToRichHtml — no markup injection", () => {
  it("escapes HTML-significant characters", () => {
    expect(markdownToRichHtml("a < b & c > d")).toBe(
      "<p>a &lt; b &amp; c &gt; d</p>",
    );
  });

  it("cannot be tricked into emitting a tag from the source text", () => {
    expect(markdownToRichHtml("<h1>yolg'on</h1>")).toBe(
      "<p>&lt;h1&gt;yolg'on&lt;/h1&gt;</p>",
    );
    expect(markdownToRichHtml('<img src="tg://photo?id=x"/>')).toBe(
      '<p>&lt;img src="tg://photo?id=x"/&gt;</p>',
    );
  });

  it("escapes a quote in a link target", () => {
    // A quote inside the URL must not be able to close the href attribute.
    const out = markdownToRichHtml('[x](https://a.test/")');
    expect(out).toContain("&quot;");
    expect(out).not.toContain('href="https://a.test/""');
  });

  it("ignores non-http link targets", () => {
    expect(markdownToRichHtml("[x](javascript:alert(1))")).toBe(
      "<p>[x](javascript:alert(1))</p>",
    );
  });
});

describe("markdownToRichHtml — unmarked lists", () => {
  const steps = [
    "Amalga oshirish bosqichlari:",
    "Birinchi qadam bajariladi.",
    "Ikkinchi qadam bajariladi.",
    "Uchinchi qadam bajariladi.",
  ].join("\n");

  it("turns an unmarked run after a colon into a list", () => {
    const out = markdownToRichHtml(steps);
    expect(out).toContain("<p>Amalga oshirish bosqichlari:</p>");
    expect(out).toContain(
      "<ul><li>Birinchi qadam bajariladi.</li><li>Ikkinchi qadam bajariladi.</li><li>Uchinchi qadam bajariladi.</li></ul>",
    );
  });

  it("does NOT convert ordinary paragraphs (no colon lead-in)", () => {
    const out = markdownToRichHtml(
      [
        "Birinchi gap shu yerda yozilgan.",
        "Ikkinchi gap shu yerda yozilgan.",
        "Uchinchi gap shu yerda yozilgan.",
      ].join("\n"),
    );
    expect(out).not.toContain("<ul>");
    expect(out.split("<p>").length - 1).toBe(3);
  });

  it("does not convert a run shorter than three lines", () => {
    const out = markdownToRichHtml(
      ["Bosqichlar:", "Birinchi qadam.", "Ikkinchi qadam."].join("\n"),
    );
    expect(out).not.toContain("<ul>");
  });
});
