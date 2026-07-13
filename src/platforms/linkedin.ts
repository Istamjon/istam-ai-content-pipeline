import fs from "fs";
import path from "path";
import { env } from "../config/env.js";
import {
  getLinkedInPostMode,
  linkedinProvider,
  probeCanPostAsOrganization,
  refreshLinkedInAccessToken,
} from "../oauth/providers/linkedin.js";
import { loadTokens, saveTokens } from "../oauth/tokenStore.js";

export type LinkedInTargetResult = {
  target: "person" | "organization";
  success: boolean;
  postId?: string;
  feedUrl?: string;
  authorUrn?: string;
  error?: string;
};

export type LinkedInResult = {
  /** True if at least one of person/company succeeded */
  success: boolean;
  error?: string;
  postId?: string;
  feedUrl?: string;
  authorUrn?: string;
  postedAs?: "person" | "organization" | "both";
  companyUrl?: string;
  warning?: string;
  /** Per-target detail */
  results?: LinkedInTargetResult[];
};

const COMPANY_VANITY = "istam-obidov";
const DEFAULT_ORG_ID = "135286337";
const PROFILE_URL = "https://www.linkedin.com/in/istam/";

/**
 * Publish to LinkedIn.
 *
 * LINKEDIN_POST_AS:
 *   both (default) — ALWAYS try personal + company (independent)
 *   auto           — same as both
 *   person         — only https://www.linkedin.com/in/istam/
 *   organization   — only https://www.linkedin.com/company/istam-obidov
 *
 * Company needs Community Management API (w_organization_social).
 * If company fails, person can still succeed.
 */
export async function publishToLinkedIn(
  text: string,
  imagePath?: string,
): Promise<LinkedInResult> {
  try {
    const creds = linkedinProvider.getCredentials();
    if (!creds?.accessToken) {
      return {
        success: false,
        error: "LinkedIn not authorized. Run: npm run auth -- linkedin",
      };
    }

    let accessToken = creds.accessToken;
    // Proactive refresh if we have refresh token (keeps posts working)
    const refreshed = await refreshLinkedInAccessToken();
    if (refreshed) accessToken = refreshed;

    const mode = getLinkedInPostMode();
    const commentary = text.trim().slice(0, 3000);
    const orgId =
      (env.LINKEDIN_ORGANIZATION_ID || DEFAULT_ORG_ID).replace(/\D/g, "") ||
      DEFAULT_ORG_ID;
    const personId = (creds.userId || env.LINKEDIN_USER_ID || "").replace(
      /^urn:li:person:/,
      "",
    );
    const companyUrl = `https://www.linkedin.com/company/${COMPANY_VANITY}`;
    const companyAdminUrl = `https://www.linkedin.com/company/${orgId}/admin/page-posts/published/`;

    const targets: Array<"person" | "organization"> = [];
    if (mode === "person") {
      targets.push("person");
    } else if (mode === "organization") {
      targets.push("organization");
    } else {
      // both | auto — post to BOTH when possible
      if (personId) targets.push("person");
      if (orgId) targets.push("organization");
    }

    console.log(
      `[linkedin] mode=${mode} targets=[${targets.join(",")}] ` +
        `profile=${PROFILE_URL} company=${companyUrl}`,
    );

    const results: LinkedInTargetResult[] = [];

    for (const target of targets) {
      const authorUrn =
        target === "organization"
          ? `urn:li:organization:${orgId}`
          : personId
            ? `urn:li:person:${personId}`
            : "";

      if (!authorUrn) {
        results.push({
          target,
          success: false,
          error:
            target === "organization"
              ? "LINKEDIN_ORGANIZATION_ID missing"
              : "LINKEDIN_USER_ID missing",
        });
        continue;
      }

      console.log(`[linkedin] Publishing → ${target} ${authorUrn}`);

      let one = await attemptPublish(
        accessToken,
        authorUrn,
        commentary,
        imagePath,
        target,
        companyUrl,
        companyAdminUrl,
      );

      if (!one.success && /401|EXPIRED|unauthorized/i.test(one.error || "")) {
        const again = await refreshLinkedInAccessToken();
        if (again) {
          accessToken = again;
          one = await attemptPublish(
            accessToken,
            authorUrn,
            commentary,
            imagePath,
            target,
            companyUrl,
            companyAdminUrl,
          );
        }
      }

      results.push({
        target,
        success: one.success,
        postId: one.postId,
        feedUrl: one.feedUrl,
        authorUrn: one.authorUrn,
        error: one.error,
      });

      if (one.success) {
        console.log(`[linkedin] ✓ ${target} OK ${one.feedUrl}`);
      } else {
        console.warn(`[linkedin] ✗ ${target} FAIL ${one.error}`);
        if (target === "organization") {
          console.warn(
            "[linkedin] Company page needs Community Management API on the LinkedIn Developer App. " +
              "Until then only personal profile receives posts.",
          );
        }
      }
    }

    const okPerson = results.find((r) => r.target === "person" && r.success);
    const okOrg = results.find((r) => r.target === "organization" && r.success);
    const anyOk = Boolean(okPerson || okOrg);

    let postedAs: LinkedInResult["postedAs"];
    if (okPerson && okOrg) postedAs = "both";
    else if (okOrg) postedAs = "organization";
    else if (okPerson) postedAs = "person";

    const primary = okOrg || okPerson;
    const warningParts: string[] = [];
    if (okPerson && !okOrg && targets.includes("organization")) {
      warningParts.push(
        `Company ${companyUrl} FAILED (API 403 / no w_organization_social). ` +
          `Post is on PERSONAL profile only: ${PROFILE_URL}`,
      );
    }
    if (!okPerson && okOrg) {
      warningParts.push("Posted to company only (personal failed).");
    }

    const summary: LinkedInResult = {
      success: anyOk,
      postId: primary?.postId,
      feedUrl: primary?.feedUrl,
      authorUrn: primary?.authorUrn,
      postedAs,
      companyUrl,
      warning: warningParts.join(" ") || undefined,
      results,
      error: anyOk
        ? undefined
        : results.map((r) => `${r.target}: ${r.error}`).join(" | "),
    };

    persistLastPost(summary, orgId);
    return summary;
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function attemptPublish(
  accessToken: string,
  authorUrn: string,
  commentary: string,
  imagePath: string | undefined,
  postedAs: "person" | "organization",
  companyUrl: string,
  companyAdminUrl: string,
): Promise<LinkedInResult> {
  let assetUrn: string | undefined;
  if (imagePath && fs.existsSync(imagePath) && !/^https?:\/\//i.test(imagePath)) {
    const upload = await uploadLinkedInImage(accessToken, authorUrn, imagePath);
    if (upload.assetUrn) {
      assetUrn = upload.assetUrn;
      console.log("[linkedin] Image asset:", assetUrn);
    } else {
      console.warn("[linkedin] Image upload failed, text-only:", upload.error);
    }
  }

  const ugc = await publishUgcPost(accessToken, authorUrn, commentary, assetUrn);
  if (!ugc.success || !ugc.postId) {
    return {
      success: false,
      error: ugc.error || "UGC create failed",
      postedAs,
      authorUrn,
      companyUrl,
    };
  }

  const feedUrl = shareToFeedUrl(ugc.postId);
  if (postedAs === "organization") {
    console.log("[linkedin] Company:", companyUrl);
    console.log("[linkedin] Admin:", companyAdminUrl);
  } else {
    console.log("[linkedin] Profile:", PROFILE_URL);
  }
  console.log("[linkedin] Feed:", feedUrl);

  return {
    success: true,
    postId: ugc.postId,
    feedUrl,
    authorUrn,
    postedAs,
    companyUrl,
  };
}

function persistLastPost(result: LinkedInResult, orgId: string): void {
  const prev = loadTokens("linkedin");
  if (!prev) return;
  const person = result.results?.find((r) => r.target === "person" && r.success);
  const org = result.results?.find((r) => r.target === "organization" && r.success);
  saveTokens({
    ...prev,
    extra: {
      ...(prev.extra || {}),
      lastPostId: result.postId || "",
      lastFeedUrl: result.feedUrl || "",
      lastAuthorUrn: result.authorUrn || "",
      lastPostedAs: result.postedAs || "",
      lastPersonFeedUrl: person?.feedUrl || "",
      lastOrgFeedUrl: org?.feedUrl || "",
      organizationId: orgId,
      companyVanity: COMPANY_VANITY,
      companyUrl: `https://www.linkedin.com/company/${COMPANY_VANITY}`,
      profileUrl: PROFILE_URL,
    },
  });
}

function shareToFeedUrl(postId: string): string {
  const urn = postId.startsWith("urn:") ? postId : `urn:li:share:${postId}`;
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}`;
}

async function publishUgcPost(
  token: string,
  authorUrn: string,
  text: string,
  assetUrn?: string,
): Promise<LinkedInResult> {
  const shareContent: Record<string, unknown> = {
    shareCommentary: { text },
    shareMediaCategory: assetUrn ? "IMAGE" : "NONE",
  };

  if (assetUrn) {
    // IMAGE category: LinkedIn shows media above commentary (image → text)
    shareContent.media = [
      {
        status: "READY",
        // Keep empty-ish labels so UI does not push text-over-image feel
        description: { text: " " },
        media: assetUrn,
        title: { text: " " },
      },
    ];
  }

  const payload = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": shareContent,
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const response = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });

  const raw = await response.text();
  if (!response.ok) {
    return {
      success: false,
      error: `HTTP ${response.status}: ${raw.slice(0, 500)}`,
    };
  }

  let postId = response.headers.get("x-restli-id") || undefined;
  try {
    const j = JSON.parse(raw) as { id?: string };
    postId = j.id || postId;
  } catch {
    // ignore
  }

  if (!postId) {
    return { success: false, error: `201 but no post id. Body: ${raw.slice(0, 200)}` };
  }

  return { success: true, postId, feedUrl: shareToFeedUrl(postId), authorUrn };
}

async function uploadLinkedInImage(
  token: string,
  ownerUrn: string,
  imagePath: string,
): Promise<{ assetUrn?: string; error?: string }> {
  try {
    const registerResponse = await fetch(
      "https://api.linkedin.com/v2/assets?action=registerUpload",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
            owner: ownerUrn,
            serviceRelationships: [
              {
                relationshipType: "OWNER",
                identifier: "urn:li:userGeneratedContent",
              },
            ],
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    const registerText = await registerResponse.text();
    if (!registerResponse.ok) {
      return {
        error: `registerUpload ${registerResponse.status}: ${registerText.slice(0, 300)}`,
      };
    }

    const registerData = JSON.parse(registerText) as {
      value?: {
        asset?: string;
        uploadMechanism?: {
          "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"?: {
            uploadUrl?: string;
            headers?: Record<string, string>;
          };
        };
      };
    };

    const mechanism =
      registerData.value?.uploadMechanism?.[
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
      ];
    const uploadUrl = mechanism?.uploadUrl;
    const assetUrn = registerData.value?.asset;
    if (!uploadUrl || !assetUrn) {
      return { error: "Missing uploadUrl or asset URN" };
    }

    const fileBuffer = fs.readFileSync(imagePath);
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentTypeFor(imagePath),
        ...(mechanism?.headers ?? {}),
      },
      body: fileBuffer,
      signal: AbortSignal.timeout(120_000),
    });

    if (!uploadResponse.ok) {
      const err = await uploadResponse.text();
      return { error: `PUT ${uploadResponse.status}: ${err.slice(0, 300)}` };
    }

    await new Promise((r) => setTimeout(r, 2000));
    return { assetUrn };
  } catch (error) {
    return { error: String(error) };
  }
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}
