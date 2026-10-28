-- Durable backup of uploaded branding images (company logo, header banner,
-- company chop) in Postgres, keyed by the same relative path used in object
-- storage (e.g. `branding/company-logo/<uuid>.png`).
--
-- Branding uploads live on local container disk unless a persistent volume
-- or GCS bucket is configured (see PUBLIC_OBJECT_SEARCH_PATHS); that disk is
-- wiped on every redeploy/restart, so a logo/header banner that rendered
-- fine before a deploy can silently disappear from both the PDF and the
-- Document layouts editor preview afterwards, with no error — just a blank
-- image. Postgres is virtually always durable in this app's deployments, so
-- this table gives PDF generation (fetchImageBuffer) and the public asset
-- route (GET /storage/public-objects/*) a fallback that survives regardless
-- of the storage backend.
CREATE TABLE IF NOT EXISTS "invoiceplane_branding_assets" (
  "rel_path" text PRIMARY KEY,
  "content_type" text NOT NULL,
  "data_base64" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
