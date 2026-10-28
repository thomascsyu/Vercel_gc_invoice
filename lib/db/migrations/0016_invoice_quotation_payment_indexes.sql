-- Performance indexes for invoice, quotation, and payment list/dashboard queries

CREATE INDEX IF NOT EXISTS "invoiceplane_invoices_user_id_idx" ON "invoiceplane_invoices" ("user_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_invoices_user_created_idx" ON "invoiceplane_invoices" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "invoiceplane_invoices_user_status_idx" ON "invoiceplane_invoices" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "invoiceplane_invoices_user_invoice_date_idx" ON "invoiceplane_invoices" ("user_id", "invoice_date");

CREATE INDEX IF NOT EXISTS "invoiceplane_quotations_user_id_idx" ON "invoiceplane_quotations" ("user_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_quotations_user_created_idx" ON "invoiceplane_quotations" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "invoiceplane_quotations_user_status_idx" ON "invoiceplane_quotations" ("user_id", "status");

CREATE INDEX IF NOT EXISTS "invoiceplane_payments_user_id_idx" ON "invoiceplane_payments" ("user_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_payments_user_created_idx" ON "invoiceplane_payments" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "invoiceplane_payments_invoice_id_idx" ON "invoiceplane_payments" ("invoice_id");
