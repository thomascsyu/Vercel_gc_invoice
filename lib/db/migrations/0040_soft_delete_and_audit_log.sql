-- Soft delete for the core quote-to-cash entities (clients, invoices,
-- quotations, payments, receipts): deleting now sets deleted_at instead of
-- physically removing the row, so records are recoverable and app code
-- filters them out of normal reads. Paired with a generic audit log table
-- recording deletions, restores, and status changes across these entities.

ALTER TABLE "invoiceplane_clients" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "invoiceplane_invoices" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "invoiceplane_quotations" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "invoiceplane_payments" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "invoiceplane_receipts" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

CREATE TABLE IF NOT EXISTS "invoiceplane_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL REFERENCES "invoiceplane_users"("google_sub") ON UPDATE CASCADE ON DELETE RESTRICT,
  "data_mode" text NOT NULL DEFAULT 'live',
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "event_data" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "invoiceplane_audit_log_entity_idx"
  ON "invoiceplane_audit_log" ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_audit_log_user_mode_idx"
  ON "invoiceplane_audit_log" ("user_id", "data_mode");

-- Partial indexes so the very common "active rows" queries (deleted_at IS
-- NULL) stay fast without scanning soft-deleted history.
CREATE INDEX IF NOT EXISTS "invoiceplane_clients_active_idx"
  ON "invoiceplane_clients" ("user_id", "data_mode") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "invoiceplane_invoices_active_idx"
  ON "invoiceplane_invoices" ("user_id", "data_mode") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "invoiceplane_quotations_active_idx"
  ON "invoiceplane_quotations" ("user_id", "data_mode") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "invoiceplane_payments_active_idx"
  ON "invoiceplane_payments" ("user_id", "data_mode") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "invoiceplane_receipts_active_idx"
  ON "invoiceplane_receipts" ("user_id", "data_mode") WHERE "deleted_at" IS NULL;
