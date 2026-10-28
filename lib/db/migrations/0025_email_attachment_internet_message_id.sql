-- Cross-mailbox dedup: same client email often shares RFC Message-ID across Gmail accounts.
ALTER TABLE invoiceplane_email_attachments
  ADD COLUMN IF NOT EXISTS internet_message_id text;

CREATE INDEX IF NOT EXISTS invoiceplane_email_attachments_cross_account_dedup_idx
  ON invoiceplane_email_attachments (user_id, internet_message_id, original_filename, file_size)
  WHERE internet_message_id IS NOT NULL;
