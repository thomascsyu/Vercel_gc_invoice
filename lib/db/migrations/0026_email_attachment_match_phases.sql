-- Phase 1–3: manual match, ambiguity candidates, client sender email
ALTER TABLE invoiceplane_email_attachments
  ADD COLUMN IF NOT EXISTS match_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS email_from text;
