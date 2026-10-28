import { loadAllowedCorsOrigins } from "./corsConfig";
import { isGoogleOAuthConfigured } from "./auth/google-oauth";
import { logger } from "./logger";
import { MIN_JWT_SECRET_LENGTH } from "./auth/jwt";
import { ObjectStorageService } from "./objectStorage";

/**
 * Fail fast in production when auth or CORS would be unsafe.
 * Call once during server bootstrap before listening.
 */
export function assertProductionSecurityConfig(): void {
  if (process.env["NODE_ENV"] !== "production") {
    return;
  }

  if (!isGoogleOAuthConfigured()) {
    throw new Error(
      "Production requires Google OAuth (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI).",
    );
  }

  const allowed = loadAllowedCorsOrigins();
  const corsRestrict = process.env["CORS_RESTRICT"];
  const permissive = corsRestrict === "false" || (corsRestrict !== "true" && allowed.size === 0);

  if (permissive) {
    throw new Error(
      "Production requires strict CORS: set PUBLIC_APP_URL and/or CORS_ALLOWED_ORIGINS (do not set CORS_RESTRICT=false).",
    );
  }

  if (!process.env["JWT_SECRET"] || process.env["JWT_SECRET"].length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`Production requires JWT_SECRET (at least ${MIN_JWT_SECRET_LENGTH} characters).`);
  }

  const uploadStorage = new ObjectStorageService().getUploadStorageStatus();
  if (!uploadStorage.persistent) {
    logger.warn(
      "Branding uploads (header logo, company logo, company chop/stamp) are on ephemeral " +
        "container disk and are lost when the container is recreated. On the Ubuntu host, " +
        "bind-mount a directory at /data (files go to /data/public-objects) or set " +
        "PERSIST_LOCAL_UPLOADS=1 and LOCAL_PUBLIC_UPLOAD_DIR on a data disk. Or set " +
        "PUBLIC_OBJECT_SEARCH_PATHS and GOOGLE_APPLICATION_CREDENTIALS for GCS.",
    );
  }

  logger.info("Production security configuration validated");
}
