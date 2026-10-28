-- Runs after 0038_data_mode_test_sandbox (data_mode exists) and *before*
-- 0039_receipt_payment_link_and_indexes. Older 0039 images still execute:
--
--   ALTER TABLE "invoiceplane_clients"
--     ADD CONSTRAINT "invoiceplane_clients_user_mode_code_uniq"
--     UNIQUE ("user_id", "data_mode", "client_code");
--
-- That statement is 23505 when two rows share a code (production: GTL001).
-- Rename extras first so ADD CONSTRAINT — and 0044's partial unique index —
-- can succeed. Keep this SQL in lockstep with
-- artifacts/api-server/src/lib/db/healDuplicateClientCodes.ts (startup
-- preflight; that copy still runs if a stale Docker lib layer ships old 0039).

DO $$
DECLARE
  rel regclass;
  renamed_count int;
  pass int := 0;
  has_deleted_at boolean := false;
BEGIN
  rel := to_regclass('invoiceplane_clients');
  IF rel IS NULL THEN
    NULL;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = rel AND attname = 'data_mode' AND attnum > 0 AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = rel AND attname = 'client_code' AND attnum > 0 AND NOT attisdropped
  ) THEN
    NULL;
  ELSE
    has_deleted_at := EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = rel AND attname = 'deleted_at' AND attnum > 0 AND NOT attisdropped
    );

    LOOP
      pass := pass + 1;
      IF has_deleted_at THEN
        UPDATE "invoiceplane_clients" c
        SET "client_code" = c."client_code" || '-DUP-' || replace(c."id"::text, '-', '')
        FROM (
          SELECT "id", row_number() OVER (
            PARTITION BY "user_id", "data_mode", "client_code"
            ORDER BY ("deleted_at" IS NULL) DESC, "created_at" NULLS FIRST, "id"
          ) AS rn
          FROM "invoiceplane_clients"
        ) ranked
        WHERE c."id" = ranked."id" AND ranked.rn > 1;
      ELSE
        UPDATE "invoiceplane_clients" c
        SET "client_code" = c."client_code" || '-DUP-' || replace(c."id"::text, '-', '')
        FROM (
          SELECT "id", row_number() OVER (
            PARTITION BY "user_id", "data_mode", "client_code"
            ORDER BY "created_at" NULLS FIRST, "id"
          ) AS rn
          FROM "invoiceplane_clients"
        ) ranked
        WHERE c."id" = ranked."id" AND ranked.rn > 1;
      END IF;

      GET DIAGNOSTICS renamed_count = ROW_COUNT;
      IF renamed_count > 0 THEN
        RAISE NOTICE 'invoiceplane_clients: renamed % duplicate client_code row(s) (pass %)', renamed_count, pass;
      END IF;
      EXIT WHEN renamed_count = 0 OR pass >= 8;
    END LOOP;
  END IF;
END $$;
