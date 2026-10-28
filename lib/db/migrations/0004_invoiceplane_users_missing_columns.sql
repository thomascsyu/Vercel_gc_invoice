-- Align older `invoiceplane_users` rows with the current Drizzle schema.
-- Idempotent: ADD COLUMN IF NOT EXISTS only.

ALTER TABLE "invoiceplane_users"
  ADD COLUMN IF NOT EXISTS "bank_info" jsonb,
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
