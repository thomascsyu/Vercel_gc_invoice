-- Incremental migration for Task #2 (polish & finish InvoicePlane modules).
-- Idempotent: safe to apply over a database that has already been brought up
-- with `drizzle-kit push` against the new schema.

-- ---------- invoiceplane_clients: 4 address lines + manual client_code ----------
ALTER TABLE "invoiceplane_clients"
  ADD COLUMN IF NOT EXISTS "client_code" text,
  ADD COLUMN IF NOT EXISTS "address_line1" text,
  ADD COLUMN IF NOT EXISTS "address_line2" text,
  ADD COLUMN IF NOT EXISTS "address_line3" text,
  ADD COLUMN IF NOT EXISTS "address_line4" text;

-- Backfill: move legacy single-line address into address_line1 when empty,
-- and seed client_code from the row id so existing rows satisfy NOT NULL.
UPDATE "invoiceplane_clients"
   SET "address_line1" = COALESCE("address_line1", "address")
 WHERE "address_line1" IS NULL AND "address" IS NOT NULL;

UPDATE "invoiceplane_clients"
   SET "client_code" = 'C-' || substr(REPLACE("id"::text, '-', ''), 1, 8)
 WHERE "client_code" IS NULL OR "client_code" = '';

ALTER TABLE "invoiceplane_clients"
  ALTER COLUMN "client_code" SET NOT NULL;

-- ---------- invoiceplane_company_settings: gmail x2 + email templates ----------
ALTER TABLE "invoiceplane_company_settings"
  ADD COLUMN IF NOT EXISTS "gmail_account_1" jsonb,
  ADD COLUMN IF NOT EXISTS "gmail_account_2" jsonb,
  ADD COLUMN IF NOT EXISTS "email_templates" jsonb,
  ADD COLUMN IF NOT EXISTS "company_logo_scale" numeric(5, 2) DEFAULT '1',
  ADD COLUMN IF NOT EXISTS "header_logo_scale" numeric(5, 2) DEFAULT '1';

-- Backfill: migrate the legacy single Gmail fields into gmail_account_1.
UPDATE "invoiceplane_company_settings"
   SET "gmail_account_1" = jsonb_build_object(
         'senderEmail',  COALESCE("gmail_sender_email", ''),
         'serviceAccount', COALESCE("gmail_service_account", '')
       )
 WHERE "gmail_account_1" IS NULL
   AND ("gmail_sender_email" IS NOT NULL OR "gmail_service_account" IS NOT NULL);

-- Backfill: seed default email templates with the supported shortcodes.
UPDATE "invoiceplane_company_settings"
   SET "email_templates" = jsonb_build_object(
         'quotation', jsonb_build_object(
           'subject', 'Quotation {{quotation_number}} from {{company_name}}',
           'body',    'Dear {{contact_person}},' || E'\n\n' ||
                      'Please find quotation {{quotation_number}} attached. Total: {{amount}}.' || E'\n\n' ||
                      'Thanks,' || E'\n' || '{{company_name}}'
         ),
         'invoice', jsonb_build_object(
           'subject', 'Invoice {{invoice_number}} from {{company_name}}',
           'body',    'Dear {{contact_person}},' || E'\n\n' ||
                      'Please find invoice {{invoice_number}} attached.' || E'\n' ||
                      'Invoice date: {{invoice_date}}' || E'\n' ||
                      'Due date: {{due_date}}' || E'\n' ||
                      'Amount due: {{amount}}.' || E'\n\n' ||
                      'Thanks,' || E'\n' || '{{company_name}}'
         ),
         'reminder', jsonb_build_object(
           'subject', 'Payment reminder for invoice {{invoice_number}}',
           'body',    'Dear {{contact_person}},' || E'\n\n' ||
                      'This is a friendly reminder that invoice {{invoice_number}} ({{amount}}) was due on {{due_date}}.' || E'\n\n' ||
                      'Thanks,' || E'\n' || '{{company_name}}'
         )
       )
 WHERE "email_templates" IS NULL;

-- vat_id stays nullable; UI no longer exposes it but the column is preserved.
