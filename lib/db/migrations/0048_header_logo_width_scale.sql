-- Lets the header banner (e.g. certification badges) be narrowed to sit
-- beside the company logo on the same row instead of only stacking
-- full-width below it. Stored as 0.25-1 (25%-100% of content width);
-- existing rows default to 1 (today's full-width behavior, unchanged).
ALTER TABLE "invoiceplane_company_settings"
  ADD COLUMN IF NOT EXISTS "header_logo_width_scale" numeric(5, 2) DEFAULT '1';
