-- Consultants assigned to job orders (same pattern as invoices; max 3 enforced in API).

ALTER TABLE "invoiceplane_job_orders"
  ADD COLUMN IF NOT EXISTS "consultant_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
