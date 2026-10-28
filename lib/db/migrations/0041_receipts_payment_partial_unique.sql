-- The plain unique constraint on receipts.payment_id (added in migration
-- 0039) doesn't know about soft delete: once a receipt is soft-deleted, its
-- payment_id stays "occupied" in the index, blocking generation of a fresh
-- receipt for that same payment. Replace it with a partial unique index
-- that only applies to active (non-deleted) receipts.

ALTER TABLE "invoiceplane_receipts" DROP CONSTRAINT IF EXISTS "invoiceplane_receipts_payment_uniq";

CREATE UNIQUE INDEX IF NOT EXISTS "invoiceplane_receipts_payment_uniq"
  ON "invoiceplane_receipts" ("payment_id") WHERE "deleted_at" IS NULL;
