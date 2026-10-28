ALTER TABLE invoiceplane_proposal_documents
  ADD COLUMN IF NOT EXISTS consultant_portfolio jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS job_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS testimonials jsonb NOT NULL DEFAULT '[]'::jsonb;
