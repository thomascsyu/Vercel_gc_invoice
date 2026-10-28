-- Data-structure fix from the process review: invoice/quotation/payment/receipt
-- date fields were stored as plain `text` ("YYYY-MM-DD" strings), so Postgres
-- never validated they were real calendar dates and couldn't do native date
-- arithmetic/range queries. Convert them to a native `date` column.
--
-- schema.ts uses Drizzle's `date(col, { mode: "string" })`, which keeps the
-- TypeScript type as `string` (identical to the old `text` columns), so no
-- application code needed to change -- only the underlying Postgres type.
--
-- Every value written through the app is expected to be "YYYY-MM-DD" (native
-- <input type="date"> pickers / the shared `today()` helper), so
-- `USING col::date` should succeed against existing data. But some request
-- schemas (e.g. CreateInvoiceBody.dueDate) only require a `string`, not a
-- non-empty ISO date, so historical rows can hold "" or other non-date text.
-- NULLIF(col, '') turns blanks into NULL before the cast, and each column is
-- converted in its own EXCEPTION-guarded block so a single bad value can
-- only skip that column's conversion (logged via RAISE WARNING) instead of
-- failing the whole migration and crash-looping the server on every boot.
--
-- Guarded on the column's current type so this is a no-op (not just safely
-- idempotent, but skipped entirely) once it has already run, since this
-- migration replays on every server boot.

DO $$
BEGIN
  BEGIN
    IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'invoiceplane_invoices' AND column_name = 'invoice_date') = 'text' THEN
      ALTER TABLE "invoiceplane_invoices" ALTER COLUMN "invoice_date" TYPE date USING NULLIF("invoice_date", '')::date;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Skipping invoiceplane_invoices.invoice_date date conversion: %', SQLERRM;
  END;

  BEGIN
    IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'invoiceplane_invoices' AND column_name = 'due_date') = 'text' THEN
      ALTER TABLE "invoiceplane_invoices" ALTER COLUMN "due_date" TYPE date USING NULLIF("due_date", '')::date;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Skipping invoiceplane_invoices.due_date date conversion: %', SQLERRM;
  END;

  BEGIN
    IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'invoiceplane_quotations' AND column_name = 'quotation_date') = 'text' THEN
      ALTER TABLE "invoiceplane_quotations" ALTER COLUMN "quotation_date" TYPE date USING NULLIF("quotation_date", '')::date;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Skipping invoiceplane_quotations.quotation_date date conversion: %', SQLERRM;
  END;

  BEGIN
    IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'invoiceplane_quotations' AND column_name = 'valid_until') = 'text' THEN
      ALTER TABLE "invoiceplane_quotations" ALTER COLUMN "valid_until" TYPE date USING NULLIF("valid_until", '')::date;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Skipping invoiceplane_quotations.valid_until date conversion: %', SQLERRM;
  END;

  BEGIN
    IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'invoiceplane_payments' AND column_name = 'payment_date') = 'text' THEN
      ALTER TABLE "invoiceplane_payments" ALTER COLUMN "payment_date" TYPE date USING NULLIF("payment_date", '')::date;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Skipping invoiceplane_payments.payment_date date conversion: %', SQLERRM;
  END;

  BEGIN
    IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'invoiceplane_payments' AND column_name = 'deposit_date') = 'text' THEN
      ALTER TABLE "invoiceplane_payments" ALTER COLUMN "deposit_date" TYPE date USING NULLIF("deposit_date", '')::date;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Skipping invoiceplane_payments.deposit_date date conversion: %', SQLERRM;
  END;

  BEGIN
    IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'invoiceplane_receipts' AND column_name = 'receipt_date') = 'text' THEN
      ALTER TABLE "invoiceplane_receipts" ALTER COLUMN "receipt_date" TYPE date USING NULLIF("receipt_date", '')::date;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Skipping invoiceplane_receipts.receipt_date date conversion: %', SQLERRM;
  END;
END $$;
