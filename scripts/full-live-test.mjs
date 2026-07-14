/**
 * Full live smoke: image providers + publish to every enabled platform.
 *
 *   node scripts/full-live-test.mjs
 *   node scripts/full-live-test.mjs --images-only
 *   node scripts/full-live-test.mjs --publish-only
 *   node scripts/full-live-test.mjs --platforms=telegram,facebook
 *
 * WARNING: posts are real when DRY_RUN is not set. Uses a clear #test caption.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = (rel) => pathToFileURL(path.join(root, rel)).href;

const args = process.argv.slice(2);
const imagesOnly = args.includes("--images-only");
const publishOnly = args.includes("--publish-only");
const platformArg = args.find((a) => a.startsWith("--platforms="));
const platformFilter = platformArg
  ? platformArg
      .slice("--platforms=".length)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  : null;

const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
const TEST_TEXT =
  `✅ LangGraph live test\n` +
  `${stamp} UTC\n` +
  `Smart Pro Group automation check\n` +
  `#test #automation #langgraph`;

const IMAGE_PROMPT =
  "professional teal abstract neural network, AI engineering theme, clean modern square, no text, no watermark, no logos";

const results = { images: [], publish: [] };

function push(section, row) {
  results[section].push(row);
  const icon = row.ok ? "OK" : "FAIL";
  console.log(`  [${icon}] ${row.name}${row.detail ? " — " + row.detail : ""}`);
}

async function loadMods() {
  const { env } = await import(dist("dist/config/env.js"));
  const { generateImageBuffer, logAllImageBudgets } = await import(
    dist("dist/lib/imagePipeline.js")
  );
  const { nanoBananaImage, isNanoBananaConfigured, canUseNanoBananaToday } =
    await import(dist("dist/lib/nanoBananaImage.js"));
  const {
    cloudflareImage,
    isCloudflareImageConfigured,
    canGenerateImageToday,
    initCloudflareAccounts,
    getCloudflareAccounts,
  } = await import(dist("dist/lib/cloudflareImage.js"));
  const { hordeImage, isHordeConfigured, canUseHordeToday } = await import(
    dist("dist/lib/hordeImage.js")
  );
  const { publishToPlatform } = await import(dist("dist/platforms/index.js"));
  const { refreshAllExpiringTokens, tokenStatusReport } = await import(
    dist("dist/oauth/tokenRefresh.js")
  );
  return {
    env,
    generateImageBuffer,
    logAllImageBudgets,
    nanoBananaImage,
    isNanoBananaConfigured,
    canUseNanoBananaToday,
    cloudflareImage,
    isCloudflareImageConfigured,
    canGenerateImageToday,
    initCloudflareAccounts,
    getCloudflareAccounts,
    hordeImage,
    isHordeConfigured,
    canUseHordeToday,
    publishToPlatform,
    refreshAllExpiringTokens,
    tokenStatusReport,
  };
}

function saveBuffer(dir, name, buffer, ext) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${Date.now()}.${ext}`);
  fs.writeFileSync(file, buffer);
  return file;
}

async function testImages(m) {
  console.log("\n========== IMAGE PROVIDERS ==========");
  await m.initCloudflareAccounts();
  m.logAllImageBudgets();
  console.log(
    "CF accounts:",
    m.getCloudflareAccounts().map((a) => a.label).join(", ") || "(none)",
  );
  console.log("NanoBanana configured:", m.isNanoBananaConfigured());
  console.log("NanoBanana budget:", m.canUseNanoBananaToday());
  console.log("Cloudflare budget:", m.canGenerateImageToday());
  console.log("Horde configured:", m.isHordeConfigured(), m.canUseHordeToday());

  const outDir = path.join(root, "data/images/full-live-test");
  let lastImagePath = null;

  // Individual providers (best-effort)
  if (m.isNanoBananaConfigured() && m.canUseNanoBananaToday().ok) {
    try {
      const t0 = Date.now();
      const buf = await m.nanoBananaImage(IMAGE_PROMPT);
      const file = saveBuffer(outDir, "nanobanana", buf, "png");
      lastImagePath = file;
      push("images", {
        ok: true,
        name: "nanobanana",
        detail: `${buf.length}b ${Date.now() - t0}ms → ${path.basename(file)}`,
      });
    } catch (e) {
      push("images", {
        ok: false,
        name: "nanobanana",
        detail: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
    }
  } else {
    push("images", {
      ok: false,
      name: "nanobanana",
      detail: "skipped (not configured or budget)",
    });
  }

  if (m.isCloudflareImageConfigured() && m.canGenerateImageToday().ok) {
    try {
      const t0 = Date.now();
      const buf = await m.cloudflareImage(IMAGE_PROMPT);
      const file = saveBuffer(outDir, "cloudflare", buf, "jpg");
      lastImagePath = lastImagePath || file;
      push("images", {
        ok: true,
        name: "cloudflare",
        detail: `${buf.length}b ${Date.now() - t0}ms → ${path.basename(file)}`,
      });
    } catch (e) {
      push("images", {
        ok: false,
        name: "cloudflare",
        detail: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
    }
  } else {
    push("images", {
      ok: false,
      name: "cloudflare",
      detail: "skipped (not configured or budget)",
    });
  }

  if (m.isHordeConfigured() && m.canUseHordeToday().ok) {
    try {
      const t0 = Date.now();
      const buf = await m.hordeImage(IMAGE_PROMPT);
      const file = saveBuffer(outDir, "horde", buf, "webp");
      lastImagePath = lastImagePath || file;
      push("images", {
        ok: true,
        name: "horde",
        detail: `${buf.length}b ${Date.now() - t0}ms → ${path.basename(file)}`,
      });
    } catch (e) {
      push("images", {
        ok: false,
        name: "horde",
        detail: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
    }
  } else {
    push("images", {
      ok: false,
      name: "horde",
      detail: "skipped (not configured or budget)",
    });
  }

  // Waterfall (what pipeline uses)
  try {
    const t0 = Date.now();
    const { buffer, provider } = await m.generateImageBuffer(IMAGE_PROMPT);
    const ext = provider === "nanobanana" ? "png" : provider === "horde" ? "webp" : "jpg";
    const file = saveBuffer(outDir, `waterfall-${provider}`, buffer, ext);
    lastImagePath = file;
    push("images", {
      ok: true,
      name: `waterfall→${provider}`,
      detail: `${buffer.length}b ${Date.now() - t0}ms → ${path.basename(file)}`,
    });
  } catch (e) {
    push("images", {
      ok: false,
      name: "waterfall",
      detail: (e instanceof Error ? e.message : String(e)).slice(0, 250),
    });
  }

  // Fallback: existing sample if all gens failed
  if (!lastImagePath) {
    const existing = path.join(root, "data/images/test-engineering-1783969916412.webp");
    if (fs.existsSync(existing)) {
      lastImagePath = existing;
      console.log("  using existing sample image:", existing);
    }
  }

  return lastImagePath;
}

async function testPublish(m, imagePath) {
  console.log("\n========== TOKEN REFRESH ==========");
  try {
    await m.refreshAllExpiringTokens();
  } catch (e) {
    console.warn("  refresh warning:", e);
  }
  for (const r of m.tokenStatusReport()) {
    const days =
      r.daysLeft === null
        ? "unknown"
        : r.daysLeft < 0
          ? "EXPIRED"
          : `${r.daysLeft}d`;
    console.log(
      `  ${r.platform.padEnd(12)} token=${r.hasToken ? "yes" : "no"} expiring=${r.expiring} ${days}`,
    );
  }

  let platforms = (m.env.ENABLED_PLATFORMS || [])
    .map((p) => String(p).toLowerCase().trim())
    .filter(Boolean);
  if (!platforms.length) {
    platforms = ["telegram", "linkedin", "facebook", "instagram", "threads"];
  }
  if (platformFilter) {
    platforms = platforms.filter((p) => platformFilter.includes(p));
  }

  console.log("\n========== PUBLISH LIVE ==========");
  console.log("platforms:", platforms.join(", "));
  console.log("image:", imagePath || "(none — IG may fail)");
  console.log("DRY_RUN env:", m.env.DRY_RUN);
  if (m.env.DRY_RUN) {
    console.warn("  WARNING: DRY_RUN=true — publish modules still send unless they check it.");
  }

  for (const platform of platforms) {
    console.log(`\n--- ${platform} ---`);
    const t0 = Date.now();
    try {
      // Instagram requires image; others benefit from it
      const needImage = platform === "instagram";
      const img = needImage || imagePath ? imagePath : undefined;
      if (needImage && !img) {
        push("publish", {
          ok: false,
          name: platform,
          detail: "no image for Instagram",
        });
        continue;
      }
      const res = await m.publishToPlatform(platform, TEST_TEXT, img);
      const ms = Date.now() - t0;
      if (res.success) {
        push("publish", {
          ok: true,
          name: platform,
          detail: `${ms}ms ${res.postId || res.feedUrl || "posted"}`.slice(0, 180),
        });
      } else {
        push("publish", {
          ok: false,
          name: platform,
          detail: `${ms}ms ${(res.error || "unknown").slice(0, 200)}`,
        });
      }
    } catch (e) {
      push("publish", {
        ok: false,
        name: platform,
        detail: (e instanceof Error ? e.message : String(e)).slice(0, 200),
      });
    }
  }
}

function printSummary() {
  console.log("\n========== SUMMARY ==========");
  const imgOk = results.images.filter((r) => r.ok).length;
  const pubOk = results.publish.filter((r) => r.ok).length;
  console.log(`Images:  ${imgOk}/${results.images.length} ok`);
  for (const r of results.images) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}: ${r.detail || ""}`);
  }
  console.log(`Publish: ${pubOk}/${results.publish.length} ok`);
  for (const r of results.publish) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}: ${r.detail || ""}`);
  }

  const reportPath = path.join(root, "data/images/full-live-test/report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      { at: new Date().toISOString(), text: TEST_TEXT, results },
      null,
      2,
    ),
    "utf8",
  );
  console.log("\nReport:", reportPath);

  const fail =
    (!publishOnly && results.images.length && !results.images.some((r) => r.ok)) ||
    (!imagesOnly && results.publish.length && !results.publish.some((r) => r.ok));
  if (fail) process.exitCode = 1;
}

async function main() {
  console.log("=== FULL LIVE TEST ===");
  console.log("cwd:", root);
  console.log("time:", stamp, "UTC");

  const m = await loadMods();
  let imagePath = null;

  if (!publishOnly) {
    imagePath = await testImages(m);
  } else {
    const existing = path.join(root, "data/images/test-engineering-1783969916412.webp");
    if (fs.existsSync(existing)) imagePath = existing;
    // Prefer newest waterfall from previous run
    const dir = path.join(root, "data/images/full-live-test");
    if (fs.existsSync(dir)) {
      const files = fs
        .readdirSync(dir)
        .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      if (files[0]) imagePath = path.join(dir, files[0].f);
    }
  }

  if (!imagesOnly) {
    await testPublish(m, imagePath);
  }

  printSummary();
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
