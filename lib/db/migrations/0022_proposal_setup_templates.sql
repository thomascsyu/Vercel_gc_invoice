ALTER TABLE "invoiceplane_company_settings"
  ADD COLUMN IF NOT EXISTS "proposal_setup_templates" jsonb;
