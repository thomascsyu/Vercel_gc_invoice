/** Path that starts Google OAuth (redirects to Google). */
export const GOOGLE_OAUTH_START_PATH = "/api/auth/google";

/** Path for Google OAuth callback; must match Authorized redirect URIs in Google Cloud. */
export const GOOGLE_OAUTH_REDIRECT_PATH = "/api/auth/google/callback";

export function getGoogleOAuthConfig() {
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  const redirectUri = process.env["GOOGLE_OAUTH_REDIRECT_URI"];

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

export function isGoogleOAuthConfigured(): boolean {
  return getGoogleOAuthConfig() !== null;
}
