#!/usr/bin/env node
/**
 * Read-only network reachability probe for the pipeline's publish targets.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every platform module reports a failed request as `String(error)`. For a
 * network failure that yields the literal string "TypeError: fetch failed" —
 * which names no host and no reason. The real cause (ENOTFOUND, ETIMEDOUT,
 * ECONNREFUSED, a TLS error, an undici AggregateError) lives on `error.cause`,
 * often nested, and is thrown away.
 *
 * So when facebook + instagram + threads all fail at once, the logs cannot tell
 * you whether DNS broke, IPv6 broke, Meta is down, or the VDS egress is
 * filtered. This script answers that directly, without publishing anything and
 * without touching credentials.
 *
 * USAGE
 *   node scripts/net-probe.cjs                        # default host list
 *   node scripts/net-probe.cjs graph.facebook.com     # specific hosts
 *
 * Safe to run anywhere: it only issues GET / to each host.
 */
"use strict";

const dns = require("node:dns");
const net = require("node:net");
const https = require("node:https");

const dnsP = dns.promises;

const DEFAULT_HOSTS = [
  // The three Meta surfaces the pipeline publishes to (all failing).
  "graph.facebook.com",
  "graph.threads.net",
  // Known-good controls: these kept working through the same incident.
  "api.telegram.org",
  "api.linkedin.com",
  // Image hosts used when the Meta CDN upload path is unavailable.
  "files.catbox.moe",
  "api.imgbb.com",
];

const PORT = 443;
const TIMEOUT_MS = 12000;
const MAX_DEPTH = 5;
const MAX_LEN = 700;

/**
 * Render a thrown value as one line, following `cause` / `errors` chains.
 * This is the whole point of the probe: undici hides the truth one level down.
 */
function describe(value, depth, seen) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "(circular)";
  seen.add(value);

  const err = /** @type {Record<string, unknown>} */ (value);
  const name = typeof err.name === "string" && err.name ? err.name : "Error";
  const message = typeof err.message === "string" ? err.message : "";
  const head = message ? `${name}: ${message}` : name;

  const fields = [];
  for (const key of ["code", "errno", "syscall", "hostname", "address", "port", "status"]) {
    const v = err[key];
    if (v !== undefined && v !== null && v !== "" && v !== 0) {
      fields.push(`${key}=${String(v)}`);
    }
  }

  let out = fields.length ? `${head} (${fields.join(" ")})` : head;
  if (depth >= MAX_DEPTH) return out;

  const nested = [];
  if (err.cause) nested.push(err.cause);
  if (Array.isArray(err.errors)) nested.push(...err.errors);

  const inner = nested.map((n) => describe(n, depth + 1, seen)).filter(Boolean);
  if (inner.length === 1) out += ` <- ${inner[0]}`;
  else if (inner.length > 1) out += ` <- [${inner.join(" ;; ")}]`;

  return out;
}

function describeError(err) {
  const text = describe(err, 0, new Set());
  return text.length > MAX_LEN ? `${text.slice(0, MAX_LEN - 1)}…` : text;
}

function elapsed(t0) {
  return `${Date.now() - t0}ms`;
}

/** Raw TCP connect. `family` 0 = let the resolver decide, 4 = force IPv4. */
function tcpProbe(host, family) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const opts = { host, port: PORT, timeout: 8000 };
    if (family) opts.family = family;
    const sock = net.connect(opts);
    const done = (msg) => {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(`${msg} ${elapsed(t0)}`);
    };
    sock.on("connect", () => done(`OK peer=${sock.remoteAddress}`));
    sock.on("timeout", () => done("TIMEOUT"));
    sock.on("error", (e) => done(`ERROR ${e.code || e.message}`));
  });
}

/** node:https request — bypasses undici, so it isolates "fetch" from "network". */
function httpsProbe(host, family) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const opts = { host, port: PORT, path: "/", method: "GET", timeout: TIMEOUT_MS };
    if (family) opts.family = family;
    const req = https.request(opts, (res) => {
      res.resume();
      resolve(`http=${res.statusCode} ${elapsed(t0)}`);
    });
    req.on("timeout", () => req.destroy(new Error("ETIMEDOUT (client timeout)")));
    req.on("error", (e) => resolve(`FAIL ${elapsed(t0)} ${describeError(e)}`));
    req.end();
  });
}

/** global fetch — mirrors exactly what the platform modules do. */
async function fetchProbe(host) {
  const t0 = Date.now();
  try {
    const res = await fetch(`https://${host}/`, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return `http=${res.status} ${elapsed(t0)}`;
  } catch (e) {
    return `FAIL ${elapsed(t0)} ${describeError(e)}`;
  }
}

async function resolveProbe(host, family) {
  const t0 = Date.now();
  try {
    const addrs = family === 4 ? await dnsP.resolve4(host) : await dnsP.resolve6(host);
    return `ok ${addrs.join(",")} ${elapsed(t0)}`;
  } catch (e) {
    return `FAIL ${e.code || e.message} ${elapsed(t0)}`;
  }
}

async function main() {
  const argvHosts = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const hosts = argvHosts.length ? argvHosts : DEFAULT_HOSTS;

  console.log(`node=${process.version} platform=${process.platform}`);
  console.log(`dns-result-order=${dns.getDefaultResultOrder()}`);
  console.log(
    `proxy=${JSON.stringify({
      HTTP_PROXY: process.env.HTTP_PROXY || null,
      HTTPS_PROXY: process.env.HTTPS_PROXY || null,
      http_proxy: process.env.http_proxy || null,
      https_proxy: process.env.https_proxy || null,
      NO_PROXY: process.env.NO_PROXY || process.env.no_proxy || null,
      ALL_PROXY: process.env.ALL_PROXY || null,
    })}`,
  );
  console.log(`NODE_OPTIONS=${process.env.NODE_OPTIONS || "(unset)"}`);
  console.log("");

  for (const host of hosts) {
    console.log(`--- ${host} ---`);
    console.log(`  DNS A    ${await resolveProbe(host, 4)}`);
    console.log(`  DNS AAAA ${await resolveProbe(host, 6)}`);
    console.log(`  TCP any  ${await tcpProbe(host, 0)}`);
    console.log(`  TCP v4   ${await tcpProbe(host, 4)}`);
    console.log(`  HTTPS    ${await httpsProbe(host, 0)}`);
    console.log(`  HTTPS v4 ${await httpsProbe(host, 4)}`);
    console.log(`  FETCH    ${await fetchProbe(host)}`);
  }

  console.log("");
  console.log("done");
}

main().catch((e) => {
  console.error("probe crashed:", describeError(e));
  process.exit(1);
});
