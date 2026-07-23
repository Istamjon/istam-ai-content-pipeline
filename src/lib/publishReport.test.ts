import { formatPublishReport } from "./publishReport.js";

describe("publishReport", () => {
  it("lists success and failure platforms", () => {
    const msg = formatPublishReport({
      title: "Test post title",
      url: "https://example.com/a",
      results: [
        { platform: "telegram", status: "success" },
        { platform: "linkedin", status: "success" },
        {
          platform: "instagram",
          status: "failed",
          error: "An unknown error has occurred.",
        },
        { platform: "threads", status: "skipped", error: "Daily limit" },
      ],
    });
    expect(msg).toMatch(/telegram/);
    expect(msg).toMatch(/instagram/);
    expect(msg).toMatch(/✅/);
    expect(msg).toMatch(/❌/);
    expect(msg).toMatch(/unknown error/i);
    expect(msg).toMatch(/Test post title/);
  });
});
