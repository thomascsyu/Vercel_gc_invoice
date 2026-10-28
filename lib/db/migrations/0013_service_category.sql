ALTER TABLE invoiceplane_invoices
  ADD COLUMN IF NOT EXISTS service_category text NOT NULL DEFAULT 'others';

ALTER TABLE invoiceplane_quotations
  ADD COLUMN IF NOT EXISTS service_category text NOT NULL DEFAULT 'others';
