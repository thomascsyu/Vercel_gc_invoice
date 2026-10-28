ALTER TABLE invoiceplane_proposal_documents
  ADD COLUMN IF NOT EXISTS template_data jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE invoiceplane_company_settings
  ADD COLUMN IF NOT EXISTS proposal_profile jsonb;
