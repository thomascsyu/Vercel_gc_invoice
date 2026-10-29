-- Shared workspace: all staff read/write business data under one Google sub.
ALTER TABLE invoiceplane_company_settings
  ADD COLUMN IF NOT EXISTS workspace_data_user_id text
  REFERENCES invoiceplane_users (google_sub) ON DELETE SET NULL ON UPDATE CASCADE;
