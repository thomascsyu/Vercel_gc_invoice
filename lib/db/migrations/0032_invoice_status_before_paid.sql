ALTER TABLE invoiceplane_invoices
  ADD COLUMN IF NOT EXISTS status_before_paid text;
