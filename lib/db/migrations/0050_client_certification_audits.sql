CREATE TABLE IF NOT EXISTS invoiceplane_client_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES invoiceplane_users (google_sub) ON DELETE RESTRICT ON UPDATE CASCADE,
  data_mode text NOT NULL DEFAULT 'live',
  client_id uuid NOT NULL REFERENCES invoiceplane_clients (id) ON DELETE CASCADE,
  certification_body text NOT NULL,
  standard text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoiceplane_client_certifications_client_idx
  ON invoiceplane_client_certifications (client_id);

CREATE INDEX IF NOT EXISTS invoiceplane_client_certifications_user_mode_idx
  ON invoiceplane_client_certifications (user_id, data_mode);

CREATE TABLE IF NOT EXISTS invoiceplane_client_certification_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL REFERENCES invoiceplane_client_certifications (id) ON DELETE CASCADE,
  audit_date date NOT NULL,
  status text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoiceplane_client_certification_audits_cert_date_idx
  ON invoiceplane_client_certification_audits (certification_id, audit_date DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_client_certifications_data_mode_chk') THEN
    ALTER TABLE invoiceplane_client_certifications
      ADD CONSTRAINT invoiceplane_client_certifications_data_mode_chk
      CHECK (data_mode IN ('live', 'test')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoiceplane_client_certification_audits_status_chk') THEN
    ALTER TABLE invoiceplane_client_certification_audits
      ADD CONSTRAINT invoiceplane_client_certification_audits_status_chk
      CHECK (status IS NULL OR status IN ('sv', 'rn', 'sv_rn')) NOT VALID;
  END IF;
END $$;
