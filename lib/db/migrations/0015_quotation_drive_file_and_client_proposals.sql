ALTER TABLE invoiceplane_quotations
  ADD COLUMN IF NOT EXISTS drive_file_url text;

CREATE TABLE IF NOT EXISTS invoiceplane_client_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  client_id uuid NOT NULL REFERENCES invoiceplane_clients (id) ON DELETE CASCADE,
  proposal_no text,
  proposal_revision integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'HKD',
  total_amount numeric(12, 2) NOT NULL DEFAULT '0',
  drive_file_url text,
  payment_schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoiceplane_client_proposals_user_client_uniq UNIQUE (user_id, client_id)
);
