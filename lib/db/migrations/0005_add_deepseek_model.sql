-- Add deepseek_model column to company settings
ALTER TABLE "invoiceplane_company_settings"
  ADD COLUMN IF NOT EXISTS "deepseek_model" text;
