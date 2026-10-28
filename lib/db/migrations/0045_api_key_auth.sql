ALTER TABLE "invoiceplane_api_keys"
  ADD COLUMN IF NOT EXISTS "permission" text NOT NULL DEFAULT 'read_write',
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_used_at" timestamp with time zone;

UPDATE "invoiceplane_api_keys"
SET "expires_at" = "created_at" + interval '90 days'
WHERE "expires_at" IS NULL;

ALTER TABLE "invoiceplane_api_keys"
  ALTER COLUMN "expires_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "invoiceplane_api_keys_token_hash_idx"
  ON "invoiceplane_api_keys" ("token_hash");
