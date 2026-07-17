import {
  DEFAULT_BLOGGER_BLOG_ID,
  resolveBlogIdFromPublicFeed,
  getKnownBloggerBlogId,
} from "./bloggerBlogId.js";

describe("bloggerBlogId", () => {
  it("resolves istamjon.blogspot.com from public JSON feed", async () => {
    const r = await resolveBlogIdFromPublicFeed(
      "https://istamjon.blogspot.com",
    );
    expect(r).not.toBeNull();
    expect(r!.blogId).toBe(DEFAULT_BLOGGER_BLOG_ID);
    expect(r!.blogId).toMatch(/^\d{10,}$/);
  }, 30_000);

  it("getKnownBloggerBlogId falls back to brand default", () => {
    const prev = process.env.BLOGGER_BLOG_ID;
    const prevUrl = process.env.BLOGGER_URL;
    delete process.env.BLOGGER_BLOG_ID;
    process.env.BLOGGER_URL = "https://istamjon.blogspot.com/";
    expect(getKnownBloggerBlogId()).toBe(DEFAULT_BLOGGER_BLOG_ID);
    if (prev !== undefined) process.env.BLOGGER_BLOG_ID = prev;
    else delete process.env.BLOGGER_BLOG_ID;
    if (prevUrl !== undefined) process.env.BLOGGER_URL = prevUrl;
    else delete process.env.BLOGGER_URL;
  });
});
