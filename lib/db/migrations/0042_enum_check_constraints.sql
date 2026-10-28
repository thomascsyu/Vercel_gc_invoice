-- Data-structure fix from the process review: status/paymentMethod/receiptType/
-- serviceCategory/dataMode are plain `text` columns with only application-layer
-- validation. Add Postgres CHECK constraints as a DB-side guard on top of the
-- existing columns -- no schema.ts type change needed, since these are already
-- typed as string literal unions in TypeScript via `.$type<...>()`.
--
-- Added NOT VALID: this enforces the constraint on every future INSERT/UPDATE
-- immediately, but skips scanning existing rows, so this migration (which
-- replays on every server boot, including against production data we can't
-- inspect ahead of time) can never fail or crash startup because of
-- historical data. Existing rows can be validated later with a separate
-- `VALIDATE CONSTRAINT` once the data is confirmed clean.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_invoices_status_chk') THEN
    ALTER TABLE "invoiceplane_invoices"
      ADD CONSTRAINT "invoiceplane_invoices_status_chk"
      CHECK ("status" IN ('draft', 'pending_approval', 'approved', 'sent', 'revised', 'paid')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_invoices_service_category_chk') THEN
    ALTER TABLE "invoiceplane_invoices"
      ADD CONSTRAINT "invoiceplane_invoices_service_category_chk"
      CHECK ("service_category" IN ('setup', 'main', 'pen', 'vscan', 'others')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_invoices_data_mode_chk') THEN
    ALTER TABLE "invoiceplane_invoices"
      ADD CONSTRAINT "invoiceplane_invoices_data_mode_chk"
      CHECK ("data_mode" IN ('live', 'test')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_quotations_status_chk') THEN
    ALTER TABLE "invoiceplane_quotations"
      ADD CONSTRAINT "invoiceplane_quotations_status_chk"
      CHECK ("status" IN ('draft', 'pending_approval', 'approved', 'sent', 'skip', 'canceled', 'confirmed', 'invoiced')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_quotations_service_category_chk') THEN
    ALTER TABLE "invoiceplane_quotations"
      ADD CONSTRAINT "invoiceplane_quotations_service_category_chk"
      CHECK ("service_category" IN ('setup', 'main', 'pen', 'vscan', 'others')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_quotations_data_mode_chk') THEN
    ALTER TABLE "invoiceplane_quotations"
      ADD CONSTRAINT "invoiceplane_quotations_data_mode_chk"
      CHECK ("data_mode" IN ('live', 'test')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_payments_payment_method_chk') THEN
    ALTER TABLE "invoiceplane_payments"
      ADD CONSTRAINT "invoiceplane_payments_payment_method_chk"
      CHECK ("payment_method" IN ('bank_transfer', 'cheque', 'echeque', 'cheque_deposit', 'other')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_payments_data_mode_chk') THEN
    ALTER TABLE "invoiceplane_payments"
      ADD CONSTRAINT "invoiceplane_payments_data_mode_chk"
      CHECK ("data_mode" IN ('live', 'test')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_receipts_data_mode_chk') THEN
    ALTER TABLE "invoiceplane_receipts"
      ADD CONSTRAINT "invoiceplane_receipts_data_mode_chk"
      CHECK ("data_mode" IN ('live', 'test')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_clients_data_mode_chk') THEN
    ALTER TABLE "invoiceplane_clients"
      ADD CONSTRAINT "invoiceplane_clients_data_mode_chk"
      CHECK ("data_mode" IN ('live', 'test')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_payment_receipts_receipt_type_chk') THEN
    ALTER TABLE "invoiceplane_payment_receipts"
      ADD CONSTRAINT "invoiceplane_payment_receipts_receipt_type_chk"
      CHECK ("receipt_type" IN ('receipt', 'screenshot', 'cheque_deposit', 'other')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_payment_receipts_data_mode_chk') THEN
    ALTER TABLE "invoiceplane_payment_receipts"
      ADD CONSTRAINT "invoiceplane_payment_receipts_data_mode_chk"
      CHECK ("data_mode" IN ('live', 'test')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_job_orders_data_mode_chk') THEN
    ALTER TABLE "invoiceplane_job_orders"
      ADD CONSTRAINT "invoiceplane_job_orders_data_mode_chk"
      CHECK ("data_mode" IN ('live', 'test')) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_audit_log_data_mode_chk') THEN
    ALTER TABLE "invoiceplane_audit_log"
      ADD CONSTRAINT "invoiceplane_audit_log_data_mode_chk"
      CHECK ("data_mode" IN ('live', 'test')) NOT VALID;
  END IF;
END $$;
