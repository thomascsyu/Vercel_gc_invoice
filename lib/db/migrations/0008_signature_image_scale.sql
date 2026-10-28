ALTER TABLE "invoiceplane_company_settings"
  ADD COLUMN IF NOT EXISTS "signature_image_scale" numeric(5, 2) DEFAULT '1';
