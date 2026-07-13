import crypto from "crypto";

export interface OAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Build OAuth 1.0a Authorization header (HMAC-SHA1).
 * For multipart media uploads, pass only query/oauth params (not body fields).
 */
export function buildOAuth1Header(
  method: string,
  url: string,
  creds: OAuth1Credentials,
  extraParams: Record<string, string> = {},
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const allParams: Record<string, string> = { ...extraParams, ...oauthParams };

  // Include query string params from URL in signature base
  const urlObj = new URL(url);
  urlObj.searchParams.forEach((value, key) => {
    allParams[key] = value;
  });

  const baseUrl = `${urlObj.origin}${urlObj.pathname}`;
  const paramString = Object.keys(allParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
    .join("&");

  const baseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join("&");

  const signingKey = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  oauthParams.oauth_signature = signature;

  const header =
    "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
      .join(", ");

  return header;
}
