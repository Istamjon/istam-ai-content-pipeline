/**
 * LinkedIn diagnostics CLI
 *   npm run linkedin:doctor
 *   npm run linkedin:test-post
 */
import "dotenv/config";
import { env } from "../config/env.js";
import { loadTokens } from "./tokenStore.js";
import {
  getLinkedInPostMode,
  linkedinProvider,
  probeCanPostAsOrganization,
} from "./providers/linkedin.js";
import { publishToLinkedIn } from "../platforms/linkedin.js";

const cmd = process.argv[2] || "doctor";

async function doctor(): Promise<void> {
  console.log("\n=== LinkedIn Doctor ===\n");
  const stored = loadTokens("linkedin");
  const creds = linkedinProvider.getCredentials();
  const mode = getLinkedInPostMode();
  const orgId = (env.LINKEDIN_ORGANIZATION_ID || "").replace(/\D/g, "");

  console.log("configured (app):", linkedinProvider.isConfigured());
  console.log("ready (token):   ", linkedinProvider.isReady());
  console.log("mode:            ", mode);
  console.log("organizationId:  ", orgId || "(none)");
  console.log("personId:        ", creds?.userId || env.LINKEDIN_USER_ID || "(none)");
  console.log("accessToken:     ", creds?.accessToken ? `set (len ${creds.accessToken.length})` : "MISSING");
  console.log(
    "refreshToken:    ",
    env.LINKEDIN_REFRESH_TOKEN || stored?.refreshToken ? "set" : "none",
  );
  console.log("stored scopes:   ", stored?.scopes || "(unknown)");
  console.log("requestOrgScope: ", env.LINKEDIN_REQUEST_ORG_SCOPE);

  if (!creds?.accessToken) {
    console.log("\n→ Run: npm run auth -- linkedin");
    process.exit(1);
  }

  const ui = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${creds.accessToken}` },
  });
  console.log("userinfo HTTP:   ", ui.status);
  if (ui.ok) {
    const me = (await ui.json()) as { name?: string; sub?: string };
    console.log("profile:         ", me.name || me.sub);
  } else {
    console.log("userinfo body:   ", (await ui.text()).slice(0, 200));
  }

  const canOrg = await probeCanPostAsOrganization(creds.accessToken, orgId);
  console.log("canOrg (probe):  ", canOrg);

  if (stored?.extra?.lastFeedUrl) {
    console.log("\nlastFeedUrl:     ", stored.extra.lastFeedUrl);
    console.log("lastPostedAs:    ", stored.extra.lastPostedAs || "?");
  }

  console.log("\nCompany page target:");
  console.log("  https://www.linkedin.com/company/istam-obidov");
  console.log(
    `  Admin: https://www.linkedin.com/company/${orgId || "135286337"}/admin/page-posts/published/`,
  );

  console.log("\nWhere posts appear NOW:");
  if (canOrg && (mode === "organization" || mode === "auto")) {
    console.log("  → Company page: https://www.linkedin.com/company/istam-obidov");
  } else {
    console.log("  → Personal: https://www.linkedin.com/in/istam  (Posts & activity)");
    console.log("  → Company page EMPTY until:");
    console.log("      1) LinkedIn App → Products → Community Management API → Approved");
    console.log("      2) LINKEDIN_REQUEST_ORG_SCOPE=true");
    console.log("      3) npm run auth -- linkedin");
    console.log("      4) npm run linkedin:test-post  (postedAs must be organization)");
  }
  console.log("\nTest post: npm run linkedin:test-post\n");
}

async function testPost(): Promise<void> {
  const text =
    `Istam Obidov — LinkedIn test ✅\n\n` +
    `Auto publish check ${new Date().toISOString()}\n\n` +
    `#IstamObidov #AIEngineering #ProductionAI`;

  console.log("Publishing test post...");
  const r = await publishToLinkedIn(text);
  console.log(JSON.stringify(r, null, 2));
  if (r.feedUrl) {
    console.log("\n→ OPEN THIS URL:\n", r.feedUrl);
  }
  if (!r.success) process.exit(1);
}

if (cmd === "test-post" || cmd === "test") {
  testPost().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  doctor().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
