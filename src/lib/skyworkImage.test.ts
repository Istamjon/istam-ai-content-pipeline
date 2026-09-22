import { parseSseChunk, readSseResponse } from "./skyworkImage.js";

const SUCCESS_URL = "https://cdn.skywork.ai/out.png";

/** Build a Response whose body streams the given chunks (SSE-style). */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Full progress + success stream using the given line separator. */
function fullStream(sep: string): string {
  return (
    `event: progress${sep}data: {"percentage":10,"message":"start"}${sep}${sep}` +
    `event: progress${sep}data: {"percentage":60,"message":"rendering"}${sep}${sep}` +
    `event: success${sep}data: {"file_url":"${SUCCESS_URL}"}${sep}${sep}`
  );
}

describe("parseSseChunk", () => {
  it("parses LF-separated blocks", () => {
    const events = parseSseChunk('event: success\ndata: {"file_url":"x"}\n\n');
    expect(events).toEqual([{ event: "success", data: { file_url: "x" } }]);
  });

  it("parses CRLF-separated blocks", () => {
    const events = parseSseChunk(
      'event: success\r\ndata: {"file_url":"x"}\r\n\r\n',
    );
    expect(events).toEqual([{ event: "success", data: { file_url: "x" } }]);
  });

  it("keeps each block separate in a multi-event CRLF stream", () => {
    const events = parseSseChunk(
      'event: progress\r\ndata: {"percentage":10}\r\n\r\n' +
        'event: success\r\ndata: {"file_url":"x"}\r\n\r\n',
    );
    expect(events.map((e) => e.event)).toEqual(["progress", "success"]);
    expect(events[1].data).toEqual({ file_url: "x" });
  });
});

describe("readSseResponse", () => {
  it("extracts file_url from an LF stream", async () => {
    const r = await readSseResponse(sseResponse([fullStream("\n")]), "sw1");
    expect(r.fileUrl).toBe(SUCCESS_URL);
    expect(r.error).toBeUndefined();
  });

  // Regression: a CRLF stream contains no "\n\n", so the old block detector
  // never fired, the whole body was parsed as one block, every data payload got
  // concatenated into invalid JSON and file_url was lost — surfacing as the
  // misleading "no file_url in SSE success".
  it("extracts file_url from a CRLF stream", async () => {
    const r = await readSseResponse(sseResponse([fullStream("\r\n")]), "sw1");
    expect(r.error).toBeUndefined();
    expect(r.fileUrl).toBe(SUCCESS_URL);
  });

  it("extracts file_url when a CRLF pair is split across two reads", async () => {
    const raw = fullStream("\r\n");
    const cut = raw.indexOf("\r\n\r\n") + 1; // split between \r and \n
    const r = await readSseResponse(
      sseResponse([raw.slice(0, cut), raw.slice(cut)]),
      "sw1",
    );
    expect(r.error).toBeUndefined();
    expect(r.fileUrl).toBe(SUCCESS_URL);
  });

  it("accepts the fileUrl and url aliases", async () => {
    const a = await readSseResponse(
      sseResponse(['event: success\ndata: {"fileUrl":"https://x/a.png"}\n\n']),
      "sw1",
    );
    expect(a.fileUrl).toBe("https://x/a.png");

    const b = await readSseResponse(
      sseResponse(['event: success\ndata: {"url":"https://x/b.png"}\n\n']),
      "sw1",
    );
    expect(b.fileUrl).toBe("https://x/b.png");
  });

  it("surfaces the server error message", async () => {
    const r = await readSseResponse(
      sseResponse([
        'event: error\ndata: {"message":"Insufficient benefit. Please upgrade"}\n\n',
      ]),
      "sw1",
    );
    expect(r.fileUrl).toBeUndefined();
    expect(r.error).toContain("Insufficient benefit");
  });

  it("reports a missing body", async () => {
    const r = await readSseResponse(new Response(null), "sw1");
    expect(r.fileUrl).toBeUndefined();
    expect(r.error).toContain("empty body");
  });

  it("reports when no success event ever arrives", async () => {
    const r = await readSseResponse(
      sseResponse(['event: progress\ndata: {"percentage":10}\n\n']),
      "sw1",
    );
    expect(r.fileUrl).toBeUndefined();
    expect(r.error).toContain("no file_url");
  });
});
