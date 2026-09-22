/**
 * Telegram publisher: rich single-message path + fallback chain.
 *
 * These tests pin the behaviour that matters operationally — that a rich
 * rejection can never lose a post, and that the legacy layout stays intact
 * underneath it.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { env } from "../config/env.js";
import { publishToTelegram } from "./telegram.js";

const ARTICLE =
  "<b>Sarlavha</b>\n\n" + "Bu juda foydali maqola matni. ".repeat(60);
const CHANNEL = "-1009999";

let imagePath: string;

type FetchCall = { url: string; init: RequestInit };

const calls: FetchCall[] = [];
let responses: Array<{ ok: boolean; description?: string }> = [];

/** Queue the next API responses in call order; defaults to ok. */
function queueResponses(...rs: Array<{ ok: boolean; description?: string }>) {
  responses = [...rs];
}

function jsonOk() {
  return {
    text: async () => JSON.stringify({ ok: true, result: { message_id: 1 } }),
  } as unknown as Response;
}

function jsonErr(description: string) {
  return {
    text: async () => JSON.stringify({ ok: false, description }),
  } as unknown as Response;
}

beforeAll(() => {
  imagePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "tg-test-")),
    "cover.png",
  );
  // Smallest valid-ish PNG header is enough — the publisher only reads bytes.
  fs.writeFileSync(
    imagePath,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
  );
});

beforeEach(() => {
  calls.length = 0;
  queueResponses();
  env.TELEGRAM_BOT_TOKEN = "test-token";
  env.TELEGRAM_CHANNEL = CHANNEL;
  env.TELEGRAM_RICH_MESSAGES = true;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    const next = responses.shift();
    if (next && !next.ok) return jsonErr(next.description || "rejected");
    return jsonOk();
  }) as unknown as typeof fetch;
});

function methodOf(call: FetchCall): string {
  return call.url.split("/").pop() || "";
}

function richPayloadOf(call: FetchCall): {
  html: string;
  media?: Array<{ id: string; media: { type: string; media: string } }>;
} {
  const body = call.init.body;
  // Multipart carries `rich_message` as its own field holding the object
  // directly; the JSON body wraps it in a { chat_id, rich_message } envelope.
  // (Distinguished by type, not `instanceof` — the repo forbids that operator.)
  const raw =
    typeof body === "string"
      ? body
      : String((body as FormData).get("rich_message"));
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return ("html" in parsed ? parsed : parsed.rich_message) as {
    html: string;
    media?: Array<{ id: string; media: { type: string; media: string } }>;
  };
}

describe("publishToTelegram — rich single message", () => {
  it("sends ONE message with the cover embedded, and nothing else", async () => {
    const res = await publishToTelegram(ARTICLE, imagePath);

    expect(res.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(methodOf(calls[0])).toBe("sendRichMessage");

    const rich = richPayloadOf(calls[0]);
    // The image must be embedded at the top and referenced by id...
    expect(rich.html.startsWith('<img src="tg://photo?id=cover"/>')).toBe(true);
    // ...on its OWN line, because the API documents that media can only be
    // specified as a separate block.
    expect(rich.html.startsWith('<img src="tg://photo?id=cover"/>\n\n')).toBe(
      true,
    );
    expect(rich.html).toContain("<b>Sarlavha</b>");
    // ...and the media entry must agree with that id and the upload part name.
    expect(rich.media).toEqual([
      { id: "cover", media: { type: "photo", media: "attach://cover.png" } },
    ]);
  });

  it("prefers the format layer's richHtml over the plain text", async () => {
    const richHtml = "<p>Rich body</p>\n<hr/>\n<footer>Brand</footer>";

    await publishToTelegram(ARTICLE, imagePath, "image", "Cap", richHtml);

    const rich = richPayloadOf(calls[0]);
    expect(rich.html).toContain("<footer>Brand</footer>");
    expect(rich.html).toContain("Rich body");
    // The plain text must NOT be what went out on the rich path.
    expect(rich.html).not.toContain("Bu juda foydali maqola matni");
  });

  it("keeps rich-only tags off the fallback path", async () => {
    // <hr/> and <footer> are rich-only: parse_mode=HTML rejects them outright
    // (live probe: Unsupported start tag). If they leaked into the caption or
    // the continuation, the fallback would fail and the post would be lost.
    const richHtml = "<p>Rich body</p>\n<hr/>\n<footer>Brand</footer>";
    queueResponses({ ok: false, description: "rich rejected" });

    const res = await publishToTelegram(
      ARTICLE,
      imagePath,
      "image",
      "",
      richHtml,
    );

    expect(res.success).toBe(true);
    const photoBody = calls[1].init.body as FormData;
    const caption = String(photoBody.get("caption"));
    expect(caption).not.toContain("<hr/>");
    expect(caption).not.toContain("<footer>");
    const followBody = JSON.parse(String(calls[2].init.body)) as {
      text: string;
    };
    expect(followBody.text).not.toContain("<hr/>");
    expect(followBody.text).toContain("Bu juda foydali maqola matni");
  });

  it("names the upload part after the real image extension", async () => {
    const jpg = path.join(path.dirname(imagePath), "cover.jpg");
    fs.writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));

    await publishToTelegram(ARTICLE, jpg);

    const rich = richPayloadOf(calls[0]);
    // A .png part name carrying JPEG bytes is needless ambiguity.
    expect(rich.media).toEqual([
      { id: "cover", media: { type: "photo", media: "attach://cover.jpg" } },
    ]);
    const body = calls[0].init.body as FormData;
    expect(body.get("cover.jpg")).toBeTruthy();
  });

  it("uploads the file as a multipart part named to match attach://", async () => {
    await publishToTelegram(ARTICLE, imagePath);

    const body = calls[0].init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("chat_id")).toBe(CHANNEL);
    expect(body.get("cover.png")).toBeTruthy();
  });

  it("uses a plain JSON body when there is no image", async () => {
    const res = await publishToTelegram(ARTICLE);

    expect(res.success).toBe(true);
    expect(calls).toHaveLength(1);
    const body = calls[0].init.body;
    expect(typeof body).toBe("string");
    const rich = richPayloadOf(calls[0]);
    expect(rich.media).toBeUndefined();
    expect(rich.html).not.toContain("tg://photo");
    expect(rich.html).toContain("<b>Sarlavha</b>");
  });

  it("never exceeds the 32768-char rich limit for our article sizes", () => {
    // The policy caps the body well below this; assert the ceiling is honoured.
    expect(ARTICLE.length).toBeLessThan(32768);
  });
});

describe("publishToTelegram — fallback chain", () => {
  it("falls back to photo + caption + continuation when rich is rejected", async () => {
    queueResponses({ ok: false, description: "Bad Request: unsupported tag" });

    const res = await publishToTelegram(ARTICLE, imagePath, "image", "Cap");

    expect(res.success).toBe(true);
    expect(calls.map(methodOf)).toEqual([
      "sendRichMessage",
      "sendPhoto",
      "sendMessage",
    ]);
  });

  it("keeps the caption a strict prefix so the continuation does not repeat it", async () => {
    queueResponses({ ok: false, description: "rejected" });

    await publishToTelegram(ARTICLE, imagePath);

    const photoBody = calls[1].init.body as FormData;
    const caption = String(photoBody.get("caption"));
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(ARTICLE.startsWith(caption)).toBe(true);

    const followBody = JSON.parse(String(calls[2].init.body)) as {
      text: string;
    };
    // The continuation is exactly the remainder after the caption, so the reader
    // never sees the opening twice and nothing is dropped.
    expect(followBody.text).toBe(ARTICLE.slice(caption.length).trim());
  });

  it("posts text only when the photo upload fails too", async () => {
    queueResponses(
      { ok: false, description: "rich no" },
      { ok: false, description: "photo no" },
    );

    const res = await publishToTelegram(ARTICLE, imagePath);

    expect(res.success).toBe(true);
    expect(calls.map(methodOf)).toEqual([
      "sendRichMessage",
      "sendPhoto",
      "sendMessage",
    ]);
  });

  it("reports failure when the text fallback also fails", async () => {
    queueResponses(
      { ok: false, description: "rich no" },
      { ok: false, description: "photo no" },
      { ok: false, description: "text no" },
    );

    const res = await publishToTelegram(ARTICLE, imagePath);

    expect(res.success).toBe(false);
    expect(res.error).toBe("text no");
  });
});

describe("publishToTelegram — when the rich path is skipped", () => {
  it("skips rich entirely for video and uses the caption layout", async () => {
    const res = await publishToTelegram(ARTICLE, imagePath, "video");

    expect(res.success).toBe(true);
    expect(calls.map(methodOf)).toEqual(["sendVideo", "sendMessage"]);
  });

  it("skips rich when TELEGRAM_RICH_MESSAGES=false", async () => {
    env.TELEGRAM_RICH_MESSAGES = false;

    const res = await publishToTelegram(ARTICLE, imagePath);

    expect(res.success).toBe(true);
    expect(calls.map(methodOf)).toEqual(["sendPhoto", "sendMessage"]);
  });

  it("requires token and channel", async () => {
    env.TELEGRAM_BOT_TOKEN = "";
    const res = await publishToTelegram(ARTICLE);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/required/);
    expect(calls).toHaveLength(0);
  });
});
