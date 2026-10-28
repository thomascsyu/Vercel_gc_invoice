-- Adds real FK constraints from client_id/invoice_id columns that were
-- previously plain uuid columns with no referential integrity: deleting a
-- client (or an invoice) could silently orphan invoices/quotations/job
-- orders/recurring invoices/payments that still pointed at it.
--
-- client_id -> RESTRICT: a client with existing documents must not vanish
-- silently; the app now catches the resulting 23503 and asks the user to
-- deactivate the client instead (same pattern already used for consultants).
-- payments.invoice_id -> CASCADE: payments are meaningless without their
-- invoice, and the app already deletes them together on invoice delete.
--
-- Idempotent: skip a constraint that already exists (no ADD CONSTRAINT IF
-- NOT EXISTS in PostgreSQL; see 0031 for the same pattern). If legacy
-- orphaned rows already exist, log a NOTICE and skip that one constraint
-- rather than failing startup -- those rows need manual cleanup first.

DO $$
DECLARE bad_count bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_invoices_client_fk') THEN
    SELECT count(*) INTO bad_count
      FROM "invoiceplane_invoices" i
      LEFT JOIN "invoiceplane_clients" c ON c."id" = i."client_id"
     WHERE c."id" IS NULL;
    IF bad_count > 0 THEN
      RAISE NOTICE 'migration 0034: % invoiceplane_invoices row(s) reference a missing client_id; skipping FK until cleaned up manually', bad_count;
    ELSE
      ALTER TABLE "invoiceplane_invoices"
        ADD CONSTRAINT "invoiceplane_invoices_client_fk"
        FOREIGN KEY ("client_id") REFERENCES "invoiceplane_clients"("id") ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;

DO $$
DECLARE bad_count bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_quotations_client_fk') THEN
    SELECT count(*) INTO bad_count
      FROM "invoiceplane_quotations" q
      LEFT JOIN "invoiceplane_clients" c ON c."id" = q."client_id"
     WHERE c."id" IS NULL;
    IF bad_count > 0 THEN
      RAISE NOTICE 'migration 0034: % invoiceplane_quotations row(s) reference a missing client_id; skipping FK until cleaned up manually', bad_count;
    ELSE
      ALTER TABLE "invoiceplane_quotations"
        ADD CONSTRAINT "invoiceplane_quotations_client_fk"
        FOREIGN KEY ("client_id") REFERENCES "invoiceplane_clients"("id") ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;

DO $$
DECLARE bad_count bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_job_orders_client_fk') THEN
    SELECT count(*) INTO bad_count
      FROM "invoiceplane_job_orders" j
      LEFT JOIN "invoiceplane_clients" c ON c."id" = j."client_id"
     WHERE c."id" IS NULL;
    IF bad_count > 0 THEN
      RAISE NOTICE 'migration 0034: % invoiceplane_job_orders row(s) reference a missing client_id; skipping FK until cleaned up manually', bad_count;
    ELSE
      ALTER TABLE "invoiceplane_job_orders"
        ADD CONSTRAINT "invoiceplane_job_orders_client_fk"
        FOREIGN KEY ("client_id") REFERENCES "invoiceplane_clients"("id") ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;

DO $$
DECLARE bad_count bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_recurring_invoices_client_fk') THEN
    SELECT count(*) INTO bad_count
      FROM "invoiceplane_recurring_invoices" r
      LEFT JOIN "invoiceplane_clients" c ON c."id" = r."client_id"
     WHERE c."id" IS NULL;
    IF bad_count > 0 THEN
      RAISE NOTICE 'migration 0034: % invoiceplane_recurring_invoices row(s) reference a missing client_id; skipping FK until cleaned up manually', bad_count;
    ELSE
      ALTER TABLE "invoiceplane_recurring_invoices"
        ADD CONSTRAINT "invoiceplane_recurring_invoices_client_fk"
        FOREIGN KEY ("client_id") REFERENCES "invoiceplane_clients"("id") ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;

DO $$
DECLARE bad_count bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_payments_invoice_fk') THEN
    SELECT count(*) INTO bad_count
      FROM "invoiceplane_payments" p
      LEFT JOIN "invoiceplane_invoices" i ON i."id" = p."invoice_id"
     WHERE i."id" IS NULL;
    IF bad_count > 0 THEN
      RAISE NOTICE 'migration 0034: % invoiceplane_payments row(s) reference a missing invoice_id; skipping FK until cleaned up manually', bad_count;
    ELSE
      ALTER TABLE "invoiceplane_payments"
        ADD CONSTRAINT "invoiceplane_payments_invoice_fk"
        FOREIGN KEY ("invoice_id") REFERENCES "invoiceplane_invoices"("id") ON DELETE CASCADE;
    END IF;
  END IF;
END $$;
