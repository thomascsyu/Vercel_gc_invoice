-- Prevent duplicate invoice/quotation/job-order numbers per user. Numbers are
-- generated as "count of existing rows + 1"; without a DB-level constraint, two
-- near-simultaneous requests (e.g. quotation-convert racing milestone auto-billing)
-- could silently mint the same number. This turns that race into a caught,
-- retried conflict instead (see withUniqueRetry.ts) rather than silent duplication.
--
-- Idempotent: startup migrations re-run every SQL file. PostgreSQL has no
-- ADD CONSTRAINT IF NOT EXISTS, so skip when the named unique already exists
-- (previous boot, or drizzle-kit schema push). Also skip when 0038/0046
-- already installed the mode-scoped successor index. Recreating the legacy
-- constraint would reject valid live/test or soft-deleted number reuse.
--
-- If this fails on an existing database, it means duplicate numbers already
-- exist and must be manually deduplicated (e.g. by suffixing the older row's
-- number) before the constraint can be applied.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoiceplane_invoices_user_number_uniq'
      AND conrelid = 'invoiceplane_invoices'::regclass
  ) AND to_regclass('invoiceplane_invoices_user_mode_number_uniq') IS NULL THEN
    ALTER TABLE "invoiceplane_invoices"
      ADD CONSTRAINT "invoiceplane_invoices_user_number_uniq" UNIQUE ("user_id", "invoice_number");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoiceplane_quotations_user_number_uniq'
      AND conrelid = 'invoiceplane_quotations'::regclass
  ) AND to_regclass('invoiceplane_quotations_user_mode_number_uniq') IS NULL THEN
    ALTER TABLE "invoiceplane_quotations"
      ADD CONSTRAINT "invoiceplane_quotations_user_number_uniq" UNIQUE ("user_id", "quotation_number");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoiceplane_job_orders_user_number_uniq'
      AND conrelid = 'invoiceplane_job_orders'::regclass
  ) AND to_regclass('invoiceplane_job_orders_user_mode_number_uniq') IS NULL THEN
    ALTER TABLE "invoiceplane_job_orders"
      ADD CONSTRAINT "invoiceplane_job_orders_user_number_uniq" UNIQUE ("user_id", "job_order_number");
  END IF;
END $$;
