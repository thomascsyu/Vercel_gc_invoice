ALTER TABLE invoiceplane_invoices
  ADD COLUMN IF NOT EXISTS share_token text;

ALTER TABLE invoiceplane_invoices
  ADD COLUMN IF NOT EXISTS share_token_expires_at timestamptz;
