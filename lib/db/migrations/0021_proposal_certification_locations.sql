ALTER TABLE invoiceplane_proposal_documents
  ADD COLUMN IF NOT EXISTS certification_locations jsonb NOT NULL DEFAULT '[]'::jsonb;
