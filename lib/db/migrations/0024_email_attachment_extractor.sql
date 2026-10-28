-- Payment receipts (schema existed in Drizzle but had no migration)
CREATE TABLE IF NOT EXISTS invoiceplane_payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  payment_id uuid NOT NULL REFERENCES invoiceplane_payments(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoiceplane_invoices(id) ON DELETE CASCADE,
  receipt_type text NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer NOT NULL,
  mime_type text NOT NULL,
  description text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoiceplane_payment_receipts_path_uniq UNIQUE (file_path)
);

CREATE INDEX IF NOT EXISTS invoiceplane_payment_receipts_payment_idx
  ON invoiceplane_payment_receipts (payment_id);

CREATE INDEX IF NOT EXISTS invoiceplane_payment_receipts_invoice_idx
  ON invoiceplane_payment_receipts (invoice_id);

-- Third Gmail account slot
ALTER TABLE invoiceplane_company_settings
  ADD COLUMN IF NOT EXISTS gmail_account_3 jsonb;

-- Email attachment extraction jobs
CREATE TABLE IF NOT EXISTS invoiceplane_email_extraction_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  start_date text NOT NULL,
  end_date text NOT NULL,
  account_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  phase text NOT NULL DEFAULT '',
  processed integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  skipped_duplicate_count integer NOT NULL DEFAULT 0,
  error text,
  audit_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS invoiceplane_email_extraction_jobs_user_idx
  ON invoiceplane_email_extraction_jobs (user_id, created_at DESC);

-- Extracted email attachments
CREATE TABLE IF NOT EXISTS invoiceplane_email_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  job_id uuid REFERENCES invoiceplane_email_extraction_jobs(id) ON DELETE SET NULL,
  invoice_id uuid REFERENCES invoiceplane_invoices(id) ON DELETE SET NULL,
  payment_receipt_id uuid REFERENCES invoiceplane_payment_receipts(id) ON DELETE SET NULL,
  source_email text NOT NULL,
  source_account_slot integer NOT NULL,
  original_filename text NOT NULL,
  storage_path text NOT NULL,
  content_hash text NOT NULL,
  match_method text NOT NULL DEFAULT 'none',
  match_status text NOT NULL DEFAULT 'manual_review',
  matched_invoice_number text,
  receipt_type text NOT NULL DEFAULT 'other',
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  email_message_id text NOT NULL,
  email_subject text,
  email_received_at timestamptz,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  audit_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT invoiceplane_email_attachments_path_uniq UNIQUE (storage_path),
  CONSTRAINT invoiceplane_email_attachments_user_hash_uniq UNIQUE (user_id, content_hash)
);

CREATE INDEX IF NOT EXISTS invoiceplane_email_attachments_user_status_idx
  ON invoiceplane_email_attachments (user_id, match_status, extracted_at DESC);

CREATE INDEX IF NOT EXISTS invoiceplane_email_attachments_job_idx
  ON invoiceplane_email_attachments (job_id);
