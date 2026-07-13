/**
 * Small live test: Facebook Page feed + Instagram (image required).
 *   npm run test:meta
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadTokenFile(name) {
  const p = path.join(root, "data/tokens", `${name}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const fb = loadTokenFile("facebook");
const ig = loadTokenFile("instagram");

const pageToken =
  fb?.accessToken || process.env.FACEBOOK_PAGE_TOKEN || process.env.INSTAGRAM_TOKEN || "";
const pageId = fb?.userId || process.env.FACEBOOK_PAGE_ID || "";
const igUserId = ig?.userId || process.env.INSTAGRAM_USER_ID || "";
const igToken = ig?.accessToken || pageToken;

const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
const text =
  `✅ Test post from LangGraph pipeline\n` +
  `${stamp} UTC\n` +
  `Smart Pro Group / Istam Automation\n` +
  `#test #automation`;

// Public sample image (Instagram requires reachable image_url)
const IMAGE_URL =
  process.env.TEST_IMAGE_URL ||
  "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1080&h=1080&fit=crop";

async function testFacebook() {
  console.log("\n--- Facebook Page feed ---");
  if (!pageToken || !pageId) {
    console.log("SKIP: missing FACEBOOK_PAGE_TOKEN / PAGE_ID");
    return { success: false, error: "missing creds" };
  }
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text, access_token: pageToken }),
  });
  const data = await res.json();
  if (data.error) {
    console.log("FAIL:", data.error.message);
    console.log("  code:", data.error.code, "type:", data.error.type);
    return { success: false, error: data.error.message, raw: data };
  }
  console.log("OK post id:", data.id);
  console.log("  https://facebook.com/" + String(data.id).replace("_", "/posts/"));
  return { success: true, id: data.id };
}

async function testInstagram() {
  console.log("\n--- Instagram media + publish ---");
  if (!igToken || !igUserId) {
    console.log("SKIP: missing INSTAGRAM_TOKEN / USER_ID");
    return { success: false, error: "missing creds" };
  }
  console.log("IG user:", igUserId);
  console.log("image_url:", IMAGE_URL);

  const createRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: IMAGE_URL,
      caption: text,
      access_token: igToken,
    }),
  });
  const createData = await createRes.json();
  if (createData.error) {
    console.log("FAIL create:", createData.error.message);
    return { success: false, error: createData.error.message, raw: createData };
  }
  const creationId = createData.id;
  console.log("container:", creationId);

  let lastErr = "publish failed";
  for (let i = 0; i < 6; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2500 * i));
    const pubRes = await fetch(
      `https://graph.facebook.com/v19.0/${igUserId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: igToken,
        }),
      },
    );
    const pubData = await pubRes.json();
    if (!pubData.error && pubData.id) {
      console.log("OK media id:", pubData.id);
      return { success: true, id: pubData.id };
    }
    lastErr = pubData.error?.message || lastErr;
    console.log(`  attempt ${i + 1}:`, lastErr);
    if (!/not ready|in progress|wait/i.test(lastErr)) break;
  }
  console.log("FAIL:", lastErr);
  return { success: false, error: lastErr };
}

const only = process.argv[2]; // facebook | instagram | both
console.log("=== Meta test post ===");
console.log("Page:", pageId || "(none)", "IG:", igUserId || "(none)");

const results = {};
if (!only || only === "both" || only === "facebook") {
  results.facebook = await testFacebook();
}
if (!only || only === "both" || only === "instagram") {
  results.instagram = await testInstagram();
}

console.log("\n=== Summary ===");
console.log(JSON.stringify(results, null, 2));
const ok = Object.values(results).every((r) => r?.success);
process.exit(ok ? 0 : 1);
