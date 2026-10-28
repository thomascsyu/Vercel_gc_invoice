-- Staff-only internal note on invoices. Existing rows stay NULL (empty in the editor).
-- Never rendered on invoice PDFs or client-facing documents.

ALTER TABLE "invoiceplane_invoices"
  ADD COLUMN IF NOT EXISTS "internal_note" text;
