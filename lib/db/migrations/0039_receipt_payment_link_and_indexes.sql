-- Quote-to-cash data-structure fixes from the process review:
--   1. Link a formal receipt to the specific payment it documents, so
--      "generate a receipt from this payment" can pre-fill and validate
--      against real payment data instead of a free-typed amount.
--   2. Enforce clientCode uniqueness per user/mode, consistent with every
--      other document number in the system (invoice/quotation/job-order).
--   3. Add indexes that were missing on payment_receipts' join columns and
--      on quotation_templates.user_id.

ALTER TABLE "invoiceplane_receipts"
  ADD COLUMN IF NOT EXISTS "payment_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoiceplane_receipts_payment_id_fk'
  ) THEN
    ALTER TABLE "invoiceplane_receipts"
      ADD CONSTRAINT "invoiceplane_receipts_payment_id_fk"
      FOREIGN KEY ("payment_id") REFERENCES "invoiceplane_payments"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- A payment should be documented by at most one generated receipt; NULLs
-- (manually-created receipts, or rows predating this column) don't conflict
-- under a unique index. Checked via to_regclass (not pg_constraint) because
-- migration 0041 later replaces this with a plain partial unique index of
-- the same name (soft delete needs it to exclude deleted rows) — pg_constraint
-- would no longer see it, and this block would try to recreate it and fail.
DO $$
BEGIN
  IF to_regclass('invoiceplane_receipts_payment_uniq') IS NULL THEN
    ALTER TABLE "invoiceplane_receipts"
      ADD CONSTRAINT "invoiceplane_receipts_payment_uniq" UNIQUE ("payment_id");
  END IF;
END $$;

-- Client-code uniqueness enforcement lives in migration 0044, which
-- replaces this with a partial unique index that ignores soft-deleted rows
-- (deleted_at IS NULL) and self-heals any pre-existing duplicates. The plain
-- constraint this block used to add here couldn't distinguish soft-deleted
-- clients from active ones, so once soft delete shipped (migration 0040) a
-- deleted client's code stayed "occupied" and could collide with a
-- newly-created client reusing it — which is exactly the 23505 this file
-- used to throw on every startup once that happened.
--
-- Production also crashed here when two *active* rows shared a code
-- (user_id, live, GTL001): ADD CONSTRAINT UNIQUE creates a unique index, so
-- Postgres reports 23505 as "could not create unique index
-- invoiceplane_clients_user_mode_code_uniq" and the pod crash-loops.
-- Do not resurrect the ADD CONSTRAINT here; see migration 0044.
--
-- Duplicate rows are renamed *before* this file by
-- 0038_heal_duplicate_client_codes.sql and by migrate.ts's JS preflight
-- (healDuplicateClientCodes.ts), so even an old image that still contains
-- this file's original ADD CONSTRAINT can boot.

CREATE INDEX IF NOT EXISTS "invoiceplane_payment_receipts_payment_idx"
  ON "invoiceplane_payment_receipts" ("payment_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_payment_receipts_invoice_idx"
  ON "invoiceplane_payment_receipts" ("invoice_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_quotation_templates_user_idx"
  ON "invoiceplane_quotation_templates" ("user_id");
