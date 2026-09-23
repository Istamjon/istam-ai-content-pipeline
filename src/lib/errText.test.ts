import { describeError, ERR_TEXT_LIMITS } from "./errText.js";

/** An error shaped the way Node's fetch rejects: opaque, with the truth on cause. */
function fetchFailed(cause?: unknown): TypeError {
  const err = new TypeError("fetch failed");
  if (cause !== undefined) (err as { cause?: unknown }).cause = cause;
  return err;
}

/** An error shaped the way Node puts syscall failures on error.cause. */
function sysError(message: string, fields: Record<string, unknown> = {}): Error {
  const e = new Error(message);
  Object.assign(e, fields);
  return e;
}

describe("describeError", () => {
  it("renders a plain error exactly as String(error) did", () => {
    expect(describeError(new TypeError("fetch failed"))).toBe("TypeError: fetch failed");
  });

  it("surfaces the cause that String(error) throws away", () => {
    const err = fetchFailed(
      sysError("getaddrinfo ENOTFOUND graph.facebook.com", {
        code: "ENOTFOUND",
        syscall: "getaddrinfo",
        hostname: "graph.facebook.com",
      }),
    );

    const text = describeError(err);

    // The regression this helper exists to prevent: the reason must be present.
    expect(text).toMatch(/ENOTFOUND/);
    expect(text).toMatch(/hostname=graph\.facebook\.com/);
    expect(text).toMatch(/syscall=getaddrinfo/);
    expect(text).not.toBe("TypeError: fetch failed");
  });

  it("surfaces a timeout with the address it was talking to", () => {
    const err = fetchFailed(
      sysError("connect ETIMEDOUT 157.240.0.13:443", {
        code: "ETIMEDOUT",
        syscall: "connect",
        address: "157.240.0.13",
        port: 443,
      }),
    );

    const text = describeError(err);
    expect(text).toMatch(/ETIMEDOUT/);
    expect(text).toMatch(/address=157\.240\.0\.13/);
    expect(text).toMatch(/port=443/);
  });

  it("follows a two-level cause chain", () => {
    const err = fetchFailed(sysError("bad gateway", { code: "ECONNRESET" }));
    const outer = new Error("publish failed");
    (outer as { cause?: unknown }).cause = err;

    const text = describeError(outer);
    expect(text).toMatch(/publish failed/);
    expect(text).toMatch(/fetch failed/);
    expect(text).toMatch(/ECONNRESET/);
  });

  it("expands an AggregateError's errors array", () => {
    const agg = new AggregateError(
      [
        sysError("connect ECONNREFUSED 2a03:2880::2:443", {
          code: "ECONNREFUSED",
          address: "2a03:2880::2",
        }),
        sysError("connect ETIMEDOUT 157.240.0.13:443", { code: "ETIMEDOUT" }),
      ],
      "all addresses failed",
    );

    const text = describeError(fetchFailed(agg));
    expect(text).toMatch(/AggregateError/);
    expect(text).toMatch(/ECONNREFUSED/);
    expect(text).toMatch(/ETIMEDOUT/);
  });

  it("terminates on a circular cause chain instead of hanging", () => {
    const a = new Error("a");
    const b = new Error("b");
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;

    const text = describeError(a);
    expect(text).toMatch(/\(circular\)/);
  });

  it("handles non-error throws", () => {
    expect(describeError("boom")).toBe("boom");
    expect(describeError(42)).toBe("42");
    expect(describeError(null)).toBe("null");
    expect(describeError(undefined)).toBe("undefined");
  });

  it("caps the rendered length so one error cannot flood the log", () => {
    const huge = new Error("x".repeat(5000));
    const text = describeError(huge);
    expect(text.length).toBeLessThanOrEqual(ERR_TEXT_LIMITS.MAX_LENGTH);
    expect(text.endsWith("…")).toBe(true);
  });

  it("stops descending past the depth limit", () => {
    let err: Error = sysError("root");
    for (let i = 0; i < ERR_TEXT_LIMITS.MAX_DEPTH + 3; i++) {
      const next = sysError(`level-${i}`);
      (next as { cause?: unknown }).cause = err;
      err = next;
    }

    const text = describeError(err);
    // Must not recurse forever, and the outermost level must still be reported.
    expect(text).toMatch(new RegExp(`level-${ERR_TEXT_LIMITS.MAX_DEPTH + 2}`));
  });
});
