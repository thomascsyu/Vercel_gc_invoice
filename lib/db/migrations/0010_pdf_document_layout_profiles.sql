-- Per-document PDF layout profiles (stored as JSON alongside company branding).
ALTER TABLE "invoiceplane_company_settings"
  ADD COLUMN IF NOT EXISTS "pdf_document_layouts" jsonb DEFAULT '{}'::jsonb;
