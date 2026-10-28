-- Refresh-token rotation with reuse detection: each successful refresh bumps
-- this version and issues a new refresh token embedding it; a token stamped
-- with an older version (already-rotated, or force-revoked) is rejected.

ALTER TABLE "invoiceplane_users"
  ADD COLUMN IF NOT EXISTS "refresh_token_version" integer NOT NULL DEFAULT 0;
