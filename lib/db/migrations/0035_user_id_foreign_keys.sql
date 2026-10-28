-- Ties every user_id / created_by_user_id column back to
-- invoiceplane_users(google_sub), which was previously enforced only in
-- application code. ON UPDATE CASCADE is required: auth.ts rewrites
-- google_sub in place when a `pending:<email>` pre-provisioned row is
-- upgraded to a real Google sub on first login. ON DELETE RESTRICT on every
-- table: all of these are NOT NULL so SET NULL isn't an option, and CASCADE
-- would risk silently deleting financial/legal records (invoices, payments,
-- receipts, proposals) whenever a user row is removed -- the app now guards
-- user deletion and asks for deactivation instead (see users.ts).
--
-- Legacy user_id values with no matching invoiceplane_users row (e.g. a user
-- hard-deleted before this migration existed) get a deactivated tombstone
-- row instead of blocking the migration or re-homing the data to someone
-- else: the data is preserved but unreachable (is_active = false).

-- Indexes the RESTRICT check needs, for tables that don't already have one.
CREATE INDEX IF NOT EXISTS "invoiceplane_recurring_invoices_user_id_idx" ON "invoiceplane_recurring_invoices" ("user_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_quotation_templates_user_id_idx" ON "invoiceplane_quotation_templates" ("user_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_proposal_activity_user_id_idx" ON "invoiceplane_proposal_activity" ("user_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_proposal_questions_user_id_idx" ON "invoiceplane_proposal_questions" ("user_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_payment_receipts_user_id_idx" ON "invoiceplane_payment_receipts" ("user_id");
CREATE INDEX IF NOT EXISTS "invoiceplane_api_keys_created_by_user_id_idx" ON "invoiceplane_api_keys" ("created_by_user_id");

DO $$
DECLARE spec record; n bigint;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
      ('invoiceplane_clients','user_id'),
      ('invoiceplane_invoices','user_id'),
      ('invoiceplane_quotations','user_id'),
      ('invoiceplane_payments','user_id'),
      ('invoiceplane_job_orders','user_id'),
      ('invoiceplane_recurring_invoices','user_id'),
      ('invoiceplane_quotation_templates','user_id'),
      ('invoiceplane_receipts','user_id'),
      ('invoiceplane_proposal_documents','user_id'),
      ('invoiceplane_proposal_activity','user_id'),
      ('invoiceplane_proposal_questions','user_id'),
      ('invoiceplane_client_proposals','user_id'),
      ('invoiceplane_payment_receipts','user_id'),
      ('invoiceplane_api_keys','created_by_user_id')
    ) AS t(tbl, col)
  LOOP
    EXECUTE format($f$
      INSERT INTO "invoiceplane_users" ("google_sub", "email", "full_name", "role", "is_active")
      SELECT DISTINCT x.%I,
             'deleted-user+' || x.%I || '@invalid.local',
             'Deleted user (auto-created by migration 0035)',
             'user',
             false
        FROM %I x
        LEFT JOIN "invoiceplane_users" u ON u."google_sub" = x.%I
       WHERE u."google_sub" IS NULL
      ON CONFLICT ("google_sub") DO NOTHING
    $f$, spec.col, spec.col, spec.tbl, spec.col);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE 'migration 0035: created % tombstone user row(s) for orphaned %.%', n, spec.tbl, spec.col;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE spec record;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
      ('invoiceplane_clients','user_id','invoiceplane_clients_user_fk'),
      ('invoiceplane_invoices','user_id','invoiceplane_invoices_user_fk'),
      ('invoiceplane_quotations','user_id','invoiceplane_quotations_user_fk'),
      ('invoiceplane_payments','user_id','invoiceplane_payments_user_fk'),
      ('invoiceplane_job_orders','user_id','invoiceplane_job_orders_user_fk'),
      ('invoiceplane_recurring_invoices','user_id','invoiceplane_recurring_invoices_user_fk'),
      ('invoiceplane_quotation_templates','user_id','invoiceplane_quotation_templates_user_fk'),
      ('invoiceplane_receipts','user_id','invoiceplane_receipts_user_fk'),
      ('invoiceplane_proposal_documents','user_id','invoiceplane_proposal_documents_user_fk'),
      ('invoiceplane_proposal_activity','user_id','invoiceplane_proposal_activity_user_fk'),
      ('invoiceplane_proposal_questions','user_id','invoiceplane_proposal_questions_user_fk'),
      ('invoiceplane_client_proposals','user_id','invoiceplane_client_proposals_user_fk'),
      ('invoiceplane_payment_receipts','user_id','invoiceplane_payment_receipts_user_fk'),
      ('invoiceplane_api_keys','created_by_user_id','invoiceplane_api_keys_created_by_user_fk')
    ) AS t(tbl, col, conname)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = spec.conname) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES "invoiceplane_users"("google_sub") ON UPDATE CASCADE ON DELETE RESTRICT',
        spec.tbl, spec.conname, spec.col);
    END IF;
  END LOOP;
END $$;
