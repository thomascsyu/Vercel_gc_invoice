-- Toggle to hide the company chop on proposal PDFs (defaults to on, matching prior unconditional behavior).

ALTER TABLE "invoiceplane_company_settings"
  ADD COLUMN IF NOT EXISTS "proposal_show_chop" boolean NOT NULL DEFAULT true;
