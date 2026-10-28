-- Company-wide test mode: sandbox rows use data_mode = 'test' and never
-- share unique document numbers with live data.

ALTER TABLE "invoiceplane_company_settings"
  ADD COLUMN IF NOT EXISTS "test_mode_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "invoiceplane_clients"
  ADD COLUMN IF NOT EXISTS "data_mode" text NOT NULL DEFAULT 'live';

ALTER TABLE "invoiceplane_invoices"
  ADD COLUMN IF NOT EXISTS "data_mode" text NOT NULL DEFAULT 'live';

ALTER TABLE "invoiceplane_quotations"
  ADD COLUMN IF NOT EXISTS "data_mode" text NOT NULL DEFAULT 'live';

ALTER TABLE "invoiceplane_payments"
  ADD COLUMN IF NOT EXISTS "data_mode" text NOT NULL DEFAULT 'live';

ALTER TABLE "invoiceplane_payment_receipts"
  ADD COLUMN IF NOT EXISTS "data_mode" text NOT NULL DEFAULT 'live';

ALTER TABLE "invoiceplane_receipts"
  ADD COLUMN IF NOT EXISTS "data_mode" text NOT NULL DEFAULT 'live';

ALTER TABLE "invoiceplane_job_orders"
  ADD COLUMN IF NOT EXISTS "data_mode" text NOT NULL DEFAULT 'live';

CREATE INDEX IF NOT EXISTS "invoiceplane_clients_user_mode_idx"
  ON "invoiceplane_clients" ("user_id", "data_mode");
CREATE INDEX IF NOT EXISTS "invoiceplane_invoices_user_mode_idx"
  ON "invoiceplane_invoices" ("user_id", "data_mode");
CREATE INDEX IF NOT EXISTS "invoiceplane_quotations_user_mode_idx"
  ON "invoiceplane_quotations" ("user_id", "data_mode");
CREATE INDEX IF NOT EXISTS "invoiceplane_payments_user_mode_idx"
  ON "invoiceplane_payments" ("user_id", "data_mode");
CREATE INDEX IF NOT EXISTS "invoiceplane_payment_receipts_user_mode_idx"
  ON "invoiceplane_payment_receipts" ("user_id", "data_mode");
CREATE INDEX IF NOT EXISTS "invoiceplane_receipts_user_mode_idx"
  ON "invoiceplane_receipts" ("user_id", "data_mode");
CREATE INDEX IF NOT EXISTS "invoiceplane_job_orders_user_mode_idx"
  ON "invoiceplane_job_orders" ("user_id", "data_mode");

-- Rebuild document-number uniqueness to be mode-scoped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_invoices_user_number_uniq') THEN
    ALTER TABLE "invoiceplane_invoices" DROP CONSTRAINT "invoiceplane_invoices_user_number_uniq";
  END IF;
END $$;

DO $$
BEGIN
  -- 0046 replaces this constraint with a partial unique index of the same
  -- name. pg_constraint cannot see that index; recreating the constraint
  -- would fail with 42P07 (or reject legitimate soft-deleted number reuse).
  IF to_regclass('invoiceplane_invoices_user_mode_number_uniq') IS NULL THEN
    ALTER TABLE "invoiceplane_invoices"
      ADD CONSTRAINT "invoiceplane_invoices_user_mode_number_uniq"
      UNIQUE ("user_id", "data_mode", "invoice_number");
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_quotations_user_number_uniq') THEN
    ALTER TABLE "invoiceplane_quotations" DROP CONSTRAINT "invoiceplane_quotations_user_number_uniq";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_quotations_user_mode_number_uniq') THEN
    ALTER TABLE "invoiceplane_quotations"
      ADD CONSTRAINT "invoiceplane_quotations_user_mode_number_uniq"
      UNIQUE ("user_id", "data_mode", "quotation_number");
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_job_orders_user_number_uniq') THEN
    ALTER TABLE "invoiceplane_job_orders" DROP CONSTRAINT "invoiceplane_job_orders_user_number_uniq";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_job_orders_user_mode_number_uniq') THEN
    ALTER TABLE "invoiceplane_job_orders"
      ADD CONSTRAINT "invoiceplane_job_orders_user_mode_number_uniq"
      UNIQUE ("user_id", "data_mode", "job_order_number");
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_receipts_user_receipt_uniq') THEN
    ALTER TABLE "invoiceplane_receipts" DROP CONSTRAINT "invoiceplane_receipts_user_receipt_uniq";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_receipts_user_mode_receipt_uniq') THEN
    ALTER TABLE "invoiceplane_receipts"
      ADD CONSTRAINT "invoiceplane_receipts_user_mode_receipt_uniq"
      UNIQUE ("user_id", "data_mode", "receipt_number");
  END IF;
END $$;
