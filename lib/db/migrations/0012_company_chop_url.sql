-- Dedicated company chop (stamp/seal) URL + scale; legacy data lived in signature_image_*.

ALTER TABLE "invoiceplane_company_settings"
  ADD COLUMN IF NOT EXISTS "chop_url" text,
  ADD COLUMN IF NOT EXISTS "chop_scale" numeric(5, 2) DEFAULT '1';

UPDATE "invoiceplane_company_settings"
SET
  "chop_url" = NULLIF(trim(both from "signature_image_url"), ''),
  "chop_scale" = COALESCE("signature_image_scale", '1'::numeric)
WHERE trim(both from COALESCE("chop_url", '')) = ''
  AND "signature_image_url" IS NOT NULL
  AND trim(both from "signature_image_url") <> '';
