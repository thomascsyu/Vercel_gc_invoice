CREATE TABLE IF NOT EXISTS invoiceplane_proposal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  client_id uuid NOT NULL REFERENCES invoiceplane_clients(id) ON DELETE CASCADE,
  proposal_no text NOT NULL,
  proposal_revision integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  valid_from text,
  valid_until text,
  cover_photo_url text,
  firm_intro text,
  certification_body_intro text,
  client_staff_count integer,
  iso_standards jsonb NOT NULL DEFAULT '[]',
  proposal_scope text,
  scope_phases jsonb NOT NULL DEFAULT '[]',
  pm_tools_intro text,
  training_platform_intro text,
  terms_conditions text,
  consultant_ids jsonb NOT NULL DEFAULT '[]',
  currency text NOT NULL DEFAULT 'HKD',
  total_amount numeric(12, 2) NOT NULL DEFAULT 0,
  payment_schedule jsonb NOT NULL DEFAULT '[]',
  share_token text,
  share_token_expires_at timestamptz,
  job_order_id uuid,
  revision_request_comment text,
  client_confirmed_at timestamptz,
  client_signature_name text,
  submitted_at timestamptz,
  approved_at timestamptz,
  sent_at timestamptz,
  superseded_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, proposal_no, proposal_revision)
);

CREATE INDEX IF NOT EXISTS invoiceplane_proposal_documents_user_id_idx
  ON invoiceplane_proposal_documents (user_id);
CREATE INDEX IF NOT EXISTS invoiceplane_proposal_documents_client_id_idx
  ON invoiceplane_proposal_documents (client_id);
CREATE INDEX IF NOT EXISTS invoiceplane_proposal_documents_status_idx
  ON invoiceplane_proposal_documents (status);

CREATE TABLE IF NOT EXISTS invoiceplane_proposal_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES invoiceplane_proposal_documents(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  event_type text NOT NULL,
  event_data jsonb,
  actor_type text NOT NULL DEFAULT 'client',
  client_ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoiceplane_proposal_activity_proposal_id_idx
  ON invoiceplane_proposal_activity (proposal_id);

CREATE TABLE IF NOT EXISTS invoiceplane_proposal_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES invoiceplane_proposal_documents(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  question_text text NOT NULL,
  client_name text,
  client_email text,
  status text NOT NULL DEFAULT 'open',
  staff_reply text,
  replied_at timestamptz,
  replied_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoiceplane_proposal_questions_proposal_id_idx
  ON invoiceplane_proposal_questions (proposal_id);
