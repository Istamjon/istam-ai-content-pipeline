/**
 * Small X (Twitter) test tweet via OAuth 1.0a.
 *   npm run test:x
 */
import "dotenv/config";
import crypto from "crypto";

const {
  X_API_KEY,
  X_API_SECRET,
  X_ACCESS_TOKEN,
  X_ACCESS_TOKEN_SECRET,
} = process.env;

function percentEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildOAuth1Header(method, url, creds) {
  const oauth = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(oauth)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauth[k])}`)
    .join("&");
  const base = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");
  const signingKey = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(base)
    .digest("base64");
  oauth.oauth_signature = signature;
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`)
      .join(", ")
  );
}

async function main() {
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
    console.error("Missing X OAuth1 keys in .env");
    process.exit(1);
  }

  const creds = {
    consumerKey: X_API_KEY,
    consumerSecret: X_API_SECRET,
    accessToken: X_ACCESS_TOKEN,
    accessTokenSecret: X_ACCESS_TOKEN_SECRET,
  };

  console.log("token starts:", X_ACCESS_TOKEN.slice(0, 22) + "...");

  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const text = `LangGraph test tweet ${stamp} UTC #test`;

  // Prefer api.x.com; some networks get Cloudflare challenge on api.twitter.com
  const hosts = [
    "https://api.x.com/2/tweets",
    "https://api.twitter.com/2/tweets",
  ];

  let lastFail = "";
  for (const tweetUrl of hosts) {
    const auth = buildOAuth1Header("POST", tweetUrl, creds);
    const tweetRes = await fetch(tweetUrl, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        "User-Agent": "LangGraphPipeline/1.0",
      },
      body: JSON.stringify({ text }),
    });
    const tweetRaw = await tweetRes.text();
    console.log("try", tweetUrl);
    console.log("status", tweetRes.status);
    console.log(tweetRaw.slice(0, 500));

    if (tweetRes.ok) {
      try {
        const j = JSON.parse(tweetRaw);
        if (j.data?.id) {
          console.log("https://x.com/i/web/status/" + j.data.id);
        }
      } catch {
        /* ignore */
      }
      console.log("SUCCESS");
      return;
    }
    lastFail = tweetRaw;
    // Cloudflare HTML challenge — try next host
    if (tweetRaw.includes("Just a moment") || tweetRaw.includes("cloudflare")) {
      continue;
    }
    // Real API error JSON — stop
    break;
  }

  console.error("FAIL");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
