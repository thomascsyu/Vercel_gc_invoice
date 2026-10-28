ALTER TABLE invoiceplane_proposal_documents
  ADD COLUMN IF NOT EXISTS milestone_invoices jsonb NOT NULL DEFAULT '[]'::jsonb;
