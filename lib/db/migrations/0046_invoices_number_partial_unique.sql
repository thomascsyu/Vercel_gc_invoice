-- Same class of bug already fixed for invoiceplane_clients.client_code in
-- migration 0044: invoice_number uniqueness was enforced with a plain
-- UNIQUE constraint on (user_id, data_mode, invoice_number), added in
-- migration 0038 before soft delete existed. Soft-deleting an invoice never
-- freed its number, so trying to reuse a deleted invoice's number on another
-- invoice (or importing/renumbering into it) always failed with a spurious
-- "already exists" conflict.
--
-- No self-heal step is needed here (unlike 0044's DUP-suffix dance): the old
-- constraint already guaranteed uniqueness across *all* rows including
-- deleted ones, so the surviving non-deleted subset is trivially unique too.

ALTER TABLE "invoiceplane_invoices" DROP CONSTRAINT IF EXISTS "invoiceplane_invoices_user_mode_number_uniq";
DROP INDEX IF EXISTS "invoiceplane_invoices_user_mode_number_uniq";

CREATE UNIQUE INDEX IF NOT EXISTS "invoiceplane_invoices_user_mode_number_uniq"
  ON "invoiceplane_invoices" ("user_id", "data_mode", "invoice_number") WHERE "deleted_at" IS NULL;
