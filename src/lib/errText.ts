/**
 * Turn a thrown value into a diagnostic string that names the actual reason.
 *
 * WHY THIS EXISTS
 * ---------------
 * Node's fetch rejects with `TypeError: fetch failed`. That message names no
 * host and no reason — the real cause (ENOTFOUND, ETIMEDOUT, ECONNREFUSED, a
 * TLS failure, or undici's AggregateError wrapping several connection attempts)
 * lives on `error.cause`, often nested one or two levels deep.
 *
 * Every platform module used to report failures as `String(error)`, which reads
 * only `.message`. So three Meta platforms could fail for hours and the logs,
 * the database and the admin report all said exactly:
 *
 *     TypeError: fetch failed
 *
 * with no way to tell DNS from a timeout from a firewall from an expired
 * credential. This helper walks the `cause` / `errors` chain and appends the
 * syscall fields Node puts there.
 *
 * A plain error with no cause renders exactly as it did before, so existing
 * messages are unchanged.
 */

/** How deep to follow `cause` / `errors` before giving up. */
const MAX_DEPTH = 5;

/** Hard cap so one pathological error cannot flood the logs or the database. */
const MAX_LENGTH = 700;

const INTERESTING_FIELDS = [
  "code",
  "errno",
  "syscall",
  "hostname",
  "address",
  "port",
  "status",
] as const;

function describeNode(value: unknown, depth: number, seen: Set<unknown>): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "(circular)";
  seen.add(value);

  const err = value as Record<string, unknown>;
  const name = typeof err.name === "string" && err.name ? err.name : "Error";
  const message = typeof err.message === "string" ? err.message : "";
  const head = message ? `${name}: ${message}` : name;

  const fields: string[] = [];
  for (const key of INTERESTING_FIELDS) {
    const v = err[key];
    if (v !== undefined && v !== null && v !== "" && v !== 0) {
      fields.push(`${key}=${String(v)}`);
    }
  }

  let out = fields.length ? `${head} (${fields.join(" ")})` : head;
  if (depth >= MAX_DEPTH) return out;

  // undici uses `cause`; it aggregates multi-address attempts into `errors`.
  const nested: unknown[] = [];
  if (err.cause) nested.push(err.cause);
  if (Array.isArray(err.errors)) nested.push(...err.errors);

  const rendered = nested
    .map((n) => describeNode(n, depth + 1, seen))
    .filter((s) => s.length > 0);

  if (rendered.length === 1) out += ` <- ${rendered[0]}`;
  else if (rendered.length > 1) out += ` <- [${rendered.join(" ;; ")}]`;

  return out;
}

/**
 * Render any thrown value as a single-line diagnostic, following `cause` and
 * `errors` chains. Never throws.
 *
 *   describeError(new TypeError("fetch failed"))
 *   // "TypeError: fetch failed"
 *
 *   describeError(fetchErrorWithCause)
 *   // "TypeError: fetch failed <- Error: getaddrinfo ENOTFOUND graph.facebook.com
 *   //  (code=ENOTFOUND syscall=getaddrinfo hostname=graph.facebook.com)"
 */
export function describeError(err: unknown): string {
  let text: string;
  try {
    text = describeNode(err, 0, new Set());
  } catch {
    text = String(err);
  }
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}

export const ERR_TEXT_LIMITS = { MAX_DEPTH, MAX_LENGTH } as const;
