-- Fix for a startup crash: migration 0039 originally enforced client-code
-- uniqueness with a plain UNIQUE constraint on (user_id, data_mode,
-- client_code). Soft delete shipped later (migration 0040) without updating
-- that constraint, so a soft-deleted client's code stayed "occupied" —
-- creating a new client that reused a deleted one's code produced a real
-- duplicate row, and 0039's ADD CONSTRAINT then failed with 23505 on every
-- subsequent boot (this file replay runs on every startup; see migrate.ts).
--
-- The same 23505 also happens when two *active* rows share a code (the
-- create/import path used to mint XXX001 for every name with the same
-- initials — production crashed on GTL001). Rename extras before the
-- index is built, using the full row id so the new code cannot collide.
--
-- Same class of bug already fixed for invoiceplane_receipts.payment_id in
-- migration 0041. Applied here the same way, plus a self-heal step: any
-- duplicate *active* (non-deleted) rows are renamed before the index is
-- built, so this migration can't get stuck the same way again regardless of
-- how much bad data has accumulated.

DO $$
DECLARE
  renamed_count int;
  pass int := 0;
BEGIN
  -- Repeat in case a renamed code collides with an already-suffixed row.
  LOOP
    pass := pass + 1;
    UPDATE "invoiceplane_clients" c
    SET "client_code" = c."client_code" || '-DUP-' || replace(c."id"::text, '-', '')
    FROM (
      SELECT "id", row_number() OVER (
        PARTITION BY "user_id", "data_mode", "client_code"
        ORDER BY "created_at" NULLS FIRST, "id"
      ) AS rn
      FROM "invoiceplane_clients"
      WHERE "deleted_at" IS NULL
    ) ranked
    WHERE c."id" = ranked."id" AND ranked.rn > 1;

    GET DIAGNOSTICS renamed_count = ROW_COUNT;
    IF renamed_count > 0 THEN
      RAISE NOTICE 'invoiceplane_clients: renamed % duplicate active client_code row(s) before adding unique index (pass %)', renamed_count, pass;
    END IF;
    EXIT WHEN renamed_count = 0 OR pass >= 8;
  END LOOP;
END $$;

ALTER TABLE "invoiceplane_clients" DROP CONSTRAINT IF EXISTS "invoiceplane_clients_user_mode_code_uniq";
DROP INDEX IF EXISTS "invoiceplane_clients_user_mode_code_uniq";

CREATE UNIQUE INDEX IF NOT EXISTS "invoiceplane_clients_user_mode_code_uniq"
  ON "invoiceplane_clients" ("user_id", "data_mode", "client_code") WHERE "deleted_at" IS NULL;
