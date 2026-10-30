-- Track which staff member created a proposal so portal alerts reach them
-- (proposal user_id is now the shared workspace owner).
ALTER TABLE invoiceplane_proposal_documents
  ADD COLUMN IF NOT EXISTS created_by_user_id text
  REFERENCES invoiceplane_users (google_sub) ON DELETE SET NULL ON UPDATE CASCADE;
