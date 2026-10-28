import { google, Auth } from "googleapis";
import type { GmailAccount } from "@workspace/db";
import { GOOGLE_OAUTH_REDIRECT_PATH } from "./auth/google-oauth";

function deriveGmailRedirectFromGoogleAuth(googleRedirectUri: string): string | null {
  if (!googleRedirectUri.includes(GOOGLE_OAUTH_REDIRECT_PATH)) return null;
  return googleRedirectUri.replace(GOOGLE_OAUTH_REDIRECT_PATH, "/api/gmail/oauth/callback");
}

/** Resolves Gmail OAuth credentials: explicit `GMAIL_OAUTH_*` or fallback to `GOOGLE_OAUTH_*` (README). */
function getOAuthEnv() {
  const clientId =
    process.env["GMAIL_OAUTH_CLIENT_ID"]?.trim() || process.env["GOOGLE_OAUTH_CLIENT_ID"]?.trim();
  const clientSecret =
    process.env["GMAIL_OAUTH_CLIENT_SECRET"]?.trim() || process.env["GOOGLE_OAUTH_CLIENT_SECRET"]?.trim();
  let redirectUri = process.env["GMAIL_OAUTH_REDIRECT_URI"]?.trim();
  if (!redirectUri) {
    const googleUri = process.env["GOOGLE_OAUTH_REDIRECT_URI"]?.trim();
    if (googleUri) {
      redirectUri = deriveGmailRedirectFromGoogleAuth(googleUri) ?? undefined;
    }
  }
  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }
  return { clientId, clientSecret, redirectUri };
}

/** Service Account configuration for Domain-wide Delegation */
function getServiceAccountEnv() {
  const clientEmail = process.env["GMAIL_SERVICE_ACCOUNT_EMAIL"]?.trim();
  const privateKey = process.env["GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY"]?.trim();
  // Optional: default subject (domain user) to impersonate when not specified per-request
  const defaultSubject = process.env["GMAIL_SERVICE_ACCOUNT_SUBJECT"]?.trim();

  if (!clientEmail || !privateKey) {
    return null;
  }
  return { clientEmail, privateKey, defaultSubject };
}

export function isGmailOAuthConfigured(): boolean {
  return getOAuthEnv() !== null;
}

export function createOAuth2Client() {
  const env = getOAuthEnv();
  if (!env) {
    throw new Error(
      "Gmail OAuth is not configured (set GMAIL_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI, or GOOGLE_OAUTH_* with the Gmail callback registered in Google Cloud)",
    );
  }
  return new google.auth.OAuth2(env.clientId, env.clientSecret, env.redirectUri);
}

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
// openid + email scopes are needed so the OAuth2 userinfo endpoint can return
// the connected mailbox address after the user grants Gmail access.
export const GMAIL_OAUTH_SCOPES = [
  GMAIL_SEND_SCOPE,
  "openid",
  "email",
];

export function gmailOAuthAuthorizeUrl(state: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_OAUTH_SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function getGmailAddressFromRefreshToken(refreshToken: string): Promise<string | null> {
  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  // gmail.users.getProfile requires gmail.readonly or gmail.metadata scope.
  // Since we only grant gmail.send, we use the OAuth2 userinfo endpoint instead,
  // which is accessible with any valid Google OAuth token.
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const info = await oauth2.userinfo.get();
    return info.data.email ?? null;
  } catch {
    // Fallback: attempt Gmail profile (works if broader scopes are granted)
    try {
      const gmail = google.gmail({ version: "v1", auth: client });
      const prof = await gmail.users.getProfile({ userId: "me" });
      return prof.data.emailAddress ?? null;
    } catch {
      return null;
    }
  }
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodeRfc2047(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

function wrapBase64(b64: string): string {
  return b64.replace(/(.{1,76})/g, "$1\r\n").trimEnd();
}

/** Build a minimal multipart MIME message for Gmail `users.messages.send` raw payload. */
export function buildMimeMessage(opts: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; mimeType: string; content: Buffer }>;
}): string {
  const boundary = `gcinv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const subj = encodeRfc2047(opts.subject);
  const htmlB64 = wrapBase64(Buffer.from(opts.html, "utf8").toString("base64"));
  const lines: string[] = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
  ];
  if (opts.cc?.trim()) lines.push(`Cc: ${opts.cc.trim()}`);
  if (opts.bcc?.trim()) lines.push(`Bcc: ${opts.bcc.trim()}`);
  lines.push(`Subject: ${subj}`, "MIME-Version: 1.0");
  if (!opts.attachments?.length) {
    lines.push(
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      htmlB64,
    );
    return lines.join("\r\n");
  }
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`);
  lines.push(
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    htmlB64,
  );
  for (const a of opts.attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${a.filename}"`,
      `Content-Disposition: attachment; filename="${a.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(a.content.toString("base64")),
    );
  }
  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

/**
 * Send email via Gmail API.
 * Supports both OAuth2 refresh token and Service Account (JWT) with Domain-wide Delegation.
 *
 * When using Service Account:
 * - Provide serviceAccountCredentials in the opts (or rely on env vars)
 * - The 'from' address must be a valid user in your Google Workspace domain
 * - The Service Account must be granted Domain-wide Delegation authority
 *   for the gmail.send scope in the Google Admin Console
 */
export async function sendViaGmailApi(opts: {
  refreshToken?: string;
  serviceAccountCredentials?: {
    clientEmail: string;
    privateKey: string;
  };
  /** The sender email address. Must be a workspace user when using Service Account. */
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; mimeType: string; content: Buffer }>;
}): Promise<void> {
  // Determine which authentication method to use
  const useServiceAccount = opts.serviceAccountCredentials || getServiceAccountEnv();

  let auth: Auth.OAuth2Client | Auth.JWT;

  if (useServiceAccount) {
    // Use Service Account with Domain-wide Delegation
    const clientEmail = opts.serviceAccountCredentials?.clientEmail || getServiceAccountEnv()?.clientEmail;
    const privateKey = opts.serviceAccountCredentials?.privateKey || getServiceAccountEnv()?.privateKey;

    if (!clientEmail || !privateKey) {
      throw new Error("Service Account credentials are incomplete");
    }

    // Extract the domain user to impersonate from the 'from' address
    const subjectMatch = opts.from.match(/<([^>]+)>/);
    const subject = subjectMatch ? subjectMatch[1] : opts.from;

    auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey.replace(/\\n/g, "\n"),
      scopes: [GMAIL_SEND_SCOPE],
      subject: subject,
    });
  } else if (opts.refreshToken) {
    // Use OAuth2 with refresh token (original behavior)
    const client = createOAuth2Client();
    client.setCredentials({ refresh_token: opts.refreshToken });
    auth = client;
  } else {
    throw new Error(
      "No authentication method available. Provide either refreshToken or serviceAccountCredentials, " +
        "or set GMAIL_SERVICE_ACCOUNT_EMAIL and GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY environment variables."
    );
  }

  const gmail = google.gmail({ version: "v1", auth });
  const raw = base64UrlEncode(Buffer.from(buildMimeMessage(opts), "utf8"));
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}

/** Check if the GmailAccount can be used to send via Service Account */
export function canUseServiceAccount(account: GmailAccount | null | undefined): boolean {
  if (!account?.senderEmail) return false;
  return Boolean(account.serviceAccountCredentials || getServiceAccountEnv());
}
