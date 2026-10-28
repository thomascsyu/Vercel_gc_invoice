-- Replaces the `consultant_ids` jsonb array on invoices, job orders, and
-- proposal documents with proper join tables that carry a real foreign key
-- to invoiceplane_consultants (the jsonb arrays had no referential
-- integrity at all -- a deleted consultant id could linger forever, and a
-- typo'd id was never caught).
--
-- consultant_id -> RESTRICT: preserves the existing "can't delete a
-- referenced consultant" product behavior (see consultants.ts). parent_id ->
-- CASCADE: the link rows are meaningless once their invoice/job order/
-- proposal is gone. No surrogate id, no ordering column -- these are
-- unordered sets, PK is the (parent_id, consultant_id) pair itself.
--
-- Idempotent: the jsonb column's continued existence is the sentinel (same
-- style as 0003) -- once a table's column is dropped, that table's DO block
-- becomes a no-op on every later run. Orphaned ids (a consultant_ids entry
-- that doesn't resolve to a real consultant row) are reported via RAISE
-- NOTICE and silently dropped rather than failing the migration: invoices
-- and proposals never validated these on write historically (job orders did,
-- via assertJobOrderConsultantIds, but nothing stopped a row being written
-- some other way), so orphans are already invisible to every read path today.

CREATE TABLE IF NOT EXISTS "invoiceplane_invoice_consultants" (
  "invoice_id" uuid NOT NULL REFERENCES "invoiceplane_invoices"("id") ON DELETE CASCADE,
  "consultant_id" uuid NOT NULL REFERENCES "invoiceplane_consultants"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("invoice_id", "consultant_id")
);
CREATE INDEX IF NOT EXISTS "invoiceplane_invoice_consultants_consultant_idx"
  ON "invoiceplane_invoice_consultants" ("consultant_id");

CREATE TABLE IF NOT EXISTS "invoiceplane_job_order_consultants" (
  "job_order_id" uuid NOT NULL REFERENCES "invoiceplane_job_orders"("id") ON DELETE CASCADE,
  "consultant_id" uuid NOT NULL REFERENCES "invoiceplane_consultants"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("job_order_id", "consultant_id")
);
CREATE INDEX IF NOT EXISTS "invoiceplane_job_order_consultants_consultant_idx"
  ON "invoiceplane_job_order_consultants" ("consultant_id");

CREATE TABLE IF NOT EXISTS "invoiceplane_proposal_document_consultants" (
  "proposal_id" uuid NOT NULL REFERENCES "invoiceplane_proposal_documents"("id") ON DELETE CASCADE,
  "consultant_id" uuid NOT NULL REFERENCES "invoiceplane_consultants"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("proposal_id", "consultant_id")
);
CREATE INDEX IF NOT EXISTS "invoiceplane_proposal_document_consultants_consultant_idx"
  ON "invoiceplane_proposal_document_consultants" ("consultant_id");

-- invoiceplane_invoices.consultant_ids -> invoiceplane_invoice_consultants
DO $$
DECLARE bad_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoiceplane_invoices'
       AND column_name = 'consultant_ids'
  ) THEN
    SELECT count(*) INTO bad_count
      FROM "invoiceplane_invoices" i
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(i."consultant_ids") = 'array' THEN i."consultant_ids" ELSE '[]'::jsonb END
      ) AS cid
      LEFT JOIN "invoiceplane_consultants" c ON c."id"::text = cid
     WHERE c."id" IS NULL;
    IF bad_count > 0 THEN
      RAISE NOTICE 'migration 0036: % invoiceplane_invoices.consultant_ids entrie(s) reference a missing consultant; dropped (never enforced before)', bad_count;
    END IF;

    INSERT INTO "invoiceplane_invoice_consultants" ("invoice_id", "consultant_id")
    SELECT DISTINCT i."id", c."id"
      FROM "invoiceplane_invoices" i
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(i."consultant_ids") = 'array' THEN i."consultant_ids" ELSE '[]'::jsonb END
      ) AS cid
      JOIN "invoiceplane_consultants" c ON c."id"::text = cid
    ON CONFLICT DO NOTHING;

    ALTER TABLE "invoiceplane_invoices" DROP COLUMN "consultant_ids";
  END IF;
END $$;

-- invoiceplane_job_orders.consultant_ids -> invoiceplane_job_order_consultants
DO $$
DECLARE bad_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoiceplane_job_orders'
       AND column_name = 'consultant_ids'
  ) THEN
    SELECT count(*) INTO bad_count
      FROM "invoiceplane_job_orders" j
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(j."consultant_ids") = 'array' THEN j."consultant_ids" ELSE '[]'::jsonb END
      ) AS cid
      LEFT JOIN "invoiceplane_consultants" c ON c."id"::text = cid
     WHERE c."id" IS NULL;
    IF bad_count > 0 THEN
      RAISE NOTICE 'migration 0036: % invoiceplane_job_orders.consultant_ids entrie(s) reference a missing consultant; dropped (never enforced before)', bad_count;
    END IF;

    INSERT INTO "invoiceplane_job_order_consultants" ("job_order_id", "consultant_id")
    SELECT DISTINCT j."id", c."id"
      FROM "invoiceplane_job_orders" j
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(j."consultant_ids") = 'array' THEN j."consultant_ids" ELSE '[]'::jsonb END
      ) AS cid
      JOIN "invoiceplane_consultants" c ON c."id"::text = cid
    ON CONFLICT DO NOTHING;

    ALTER TABLE "invoiceplane_job_orders" DROP COLUMN "consultant_ids";
  END IF;
END $$;

-- invoiceplane_proposal_documents.consultant_ids -> invoiceplane_proposal_document_consultants
DO $$
DECLARE bad_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoiceplane_proposal_documents'
       AND column_name = 'consultant_ids'
  ) THEN
    SELECT count(*) INTO bad_count
      FROM "invoiceplane_proposal_documents" p
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p."consultant_ids") = 'array' THEN p."consultant_ids" ELSE '[]'::jsonb END
      ) AS cid
      LEFT JOIN "invoiceplane_consultants" c ON c."id"::text = cid
     WHERE c."id" IS NULL;
    IF bad_count > 0 THEN
      RAISE NOTICE 'migration 0036: % invoiceplane_proposal_documents.consultant_ids entrie(s) reference a missing consultant; dropped (never enforced before)', bad_count;
    END IF;

    INSERT INTO "invoiceplane_proposal_document_consultants" ("proposal_id", "consultant_id")
    SELECT DISTINCT p."id", c."id"
      FROM "invoiceplane_proposal_documents" p
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p."consultant_ids") = 'array' THEN p."consultant_ids" ELSE '[]'::jsonb END
      ) AS cid
      JOIN "invoiceplane_consultants" c ON c."id"::text = cid
    ON CONFLICT DO NOTHING;

    ALTER TABLE "invoiceplane_proposal_documents" DROP COLUMN "consultant_ids";
  END IF;
END $$;
