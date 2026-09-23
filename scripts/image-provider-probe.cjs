#!/usr/bin/env node
/**
 * Identity image-provider key probe — READ ONLY, ZERO IMAGE QUOTA.
 *
 * WHY THIS EXISTS
 * ---------------
 * `image_provider_usage` only counts SUCCESSFUL generations
 * (`incrementProviderImageUsage` is called immediately before a provider
 * returns its buffer). So a provider that is attempted and fails 100% of the
 * time is byte-identical in the ledger to a provider that was never attempted
 * at all — both read `0`.
 *
 * That ambiguity cost us a whole diagnosis: a run showed
 * `UNOROUTER 0/15` and `NANOBANANA 0/12` while Skywork — which demonstrably
 * WAS attempted — also showed `0/20`. The ledger could not tell them apart,
 * and the container log had already been wiped by the post-run recreate.
 *
 * This probe removes the ambiguity without spending anything: it asks each
 * provider's own model-listing endpoint whether the key is alive. A dead key
 * or a plan that cannot see the image model is then a fact, not a hypothesis.
 *
 * It never calls an image endpoint, so it consumes no image quota and creates
 * no charge. Keys are never printed — only their last 6 characters.
 *
 * Usage (inside the pipeline container):
 *   node scripts/image-provider-probe.cjs
 */
"use strict";

const TIMEOUT_MS = 15000;

/** Last 6 chars of a key — enough to match a log line, not enough to leak. */
const tail = (k) => (k ? `…${k.slice(-6)}` : "(unset)");

async function getJson(url, headers) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body — keep the raw text for the verdict */
    }
    return { status: res.status, ok: res.ok, json, text, ms: Date.now() - t0 };
  } catch (e) {
    return {
      status: 0,
      ok: false,
      json: null,
      text: `${e && e.name ? e.name : "Error"}: ${e && e.message}`,
      ms: Date.now() - t0,
    };
  }
}

/**
 * Gemini reports a bad key as 400/403 with "API key not valid" in the body.
 * A key that is merely out of quota still lists models fine — quota exhaustion
 * shows up at generateContent, not here, so a green result here means
 * "the key is real and can see the model", not "there is quota left".
 */
function geminiVerdict(r, wantModel) {
  if (r.status === 0) return `UNREACHABLE (${r.text})`;
  if (r.status === 400 || r.status === 401 || r.status === 403) {
    return `KEY REJECTED http=${r.status} (${r.text.slice(0, 160)})`;
  }
  if (!r.ok) return `HTTP ${r.status} (${r.text.slice(0, 160)})`;
  const names = (r.json && r.json.models ? r.json.models : [])
    .map((m) => String(m.name || "").replace(/^models\//, ""))
    .filter(Boolean);
  const sees = names.includes(wantModel);
  return `OK http=${r.status} models=${names.length} seesModel(${wantModel})=${sees}`;
}

async function probeGeminiKeys() {
  const keys = [
    ["nb1", process.env.GEMINI_API_KEY || ""],
    ["nb2", process.env.GEMINI_API_KEY_2 || ""],
    ["nb3", process.env.GEMINI_API_KEY_3 || ""],
  ];
  const wantModel = process.env.NANOBANANA_IMAGE_MODEL || "gemini-2.5-flash-image";
  const configured = keys.filter(([, k]) => k.trim());
  console.log(
    `[probe] Nano Banana keys configured=${configured.length}/3 model=${wantModel}`,
  );
  if (configured.length === 0) {
    console.log(
      "[probe] Nano Banana: NO KEY — GEMINI_API_KEY / _2 / _3 are all unset in this container",
    );
    return;
  }
  for (const [label, key] of configured) {
    const r = await getJson(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      {},
    );
    console.log(
      `[probe] Nano Banana ${label} ${tail(key)} ms=${r.ms} → ${geminiVerdict(r, wantModel)}`,
    );
  }
}

async function probeUnorouter() {
  const key = (process.env.UNOROUTER_API_KEY || "").trim();
  const base = (process.env.UNOROUTER_BASE_URL || "https://api.unorouter.com/v1")
    .replace(/\/+$/, "");
  if (!key) {
    console.log("[probe] UnoRouter: NO KEY — UNOROUTER_API_KEY is unset in this container");
    return;
  }
  const r = await getJson(`${base}/models`, {
    Authorization: `Bearer ${key}`,
  });
  let verdict;
  let ids = [];
  if (r.status === 0) {
    verdict = `UNREACHABLE (${r.text})`;
  } else if (r.status === 401 || r.status === 403) {
    verdict = `KEY REJECTED http=${r.status} (${r.text.slice(0, 160)})`;
  } else if (!r.ok) {
    verdict = `HTTP ${r.status} (${r.text.slice(0, 160)})`;
  } else {
    ids = (r.json && r.json.data ? r.json.data : [])
      .map((m) => String(m.id || ""))
      .filter(Boolean);
    const want = process.env.UNOROUTER_IMAGE_MODEL || "gpt-image-2:free";
    verdict = `OK http=${r.status} models=${ids.length} seesModel(${want})=${ids.includes(want)}`;
  }
  console.log(`[probe] UnoRouter ${tail(key)} base=${base} ms=${r.ms} → ${verdict}`);

  // A valid key whose configured model is not in the list is a silent dead end:
  // the provider looks "configured" to the app and fails on every call. Name the
  // models the key CAN see so the configured one can be corrected.
  if (ids.length > 0) {
    const want = process.env.UNOROUTER_IMAGE_MODEL || "gpt-image-2:free";
    if (!ids.includes(want)) {
      const imageish = ids.filter((i) =>
        /image|flux|sdxl|diffusion|dall|cogview|sensenova|seedream|glm/i.test(i),
      );
      console.log(
        `[probe] UnoRouter WARNING: configured model "${want}" is NOT in this key's list.`,
      );
      console.log(
        `[probe] UnoRouter image-capable models (${imageish.length}): ` +
          (imageish.slice(0, 40).join(", ") ||
            "NONE — this key cannot see any image model"),
      );
    }
  }
}

(async () => {
  console.log("=== IDENTITY PROVIDER KEY PROBE (read-only, no image quota used) ===");
  await probeUnorouter();
  await probeGeminiKeys();
  console.log(
    "[probe] NOTE: a green result means the key is valid and can see the model. " +
      "It does not prove remaining image quota — quota is only consumed at generateContent.",
  );
  console.log("=== PROBE DONE ===");
})().catch((e) => {
  console.log(`[probe] probe crashed: ${e && e.message ? e.message : e}`);
});
