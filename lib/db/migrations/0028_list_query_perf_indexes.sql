-- Speed up invoice/quotation list filters and common sorts

CREATE INDEX IF NOT EXISTS "invoiceplane_invoices_user_client_idx"
  ON "invoiceplane_invoices" ("user_id", "client_id");

CREATE INDEX IF NOT EXISTS "invoiceplane_invoices_user_due_date_idx"
  ON "invoiceplane_invoices" ("user_id", "due_date");

CREATE INDEX IF NOT EXISTS "invoiceplane_invoices_user_number_idx"
  ON "invoiceplane_invoices" ("user_id", "invoice_number");

CREATE INDEX IF NOT EXISTS "invoiceplane_invoices_user_total_idx"
  ON "invoiceplane_invoices" ("user_id", "total");

CREATE INDEX IF NOT EXISTS "invoiceplane_quotations_user_client_idx"
  ON "invoiceplane_quotations" ("user_id", "client_id");

CREATE INDEX IF NOT EXISTS "invoiceplane_quotations_user_date_idx"
  ON "invoiceplane_quotations" ("user_id", "quotation_date");

CREATE INDEX IF NOT EXISTS "invoiceplane_quotations_user_number_idx"
  ON "invoiceplane_quotations" ("user_id", "quotation_number");

CREATE INDEX IF NOT EXISTS "invoiceplane_quotations_user_total_idx"
  ON "invoiceplane_quotations" ("user_id", "total");

-- Default quotation list orders expired actionable rows first
CREATE INDEX IF NOT EXISTS "invoiceplane_quotations_user_valid_status_idx"
  ON "invoiceplane_quotations" ("user_id", "valid_until", "status");
