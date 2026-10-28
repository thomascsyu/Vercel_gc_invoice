/**
 * Pre-migration heal for invoiceplane_clients.client_code duplicates.
 *
 * Production crash (SQLSTATE 23505):
 *   Key (user_id, data_mode, client_code)=(116820260239879027957, live, GTL001)
 *   could not create unique index "invoiceplane_clients_user_mode_code_uniq"
 *
 * migrate.ts replays every SQL file on boot. Older images still run 0039's
 *   ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (user_id, data_mode, client_code)
 * *before* 0044 can rename extras. This block is embedded in the API server
 * so it still runs when a stale Docker `lib` layer ships the old 0039 file.
 *
 * Safe on a fresh database: no-ops if the table or columns are missing.
 * Prefers keeping the code on an active (deleted_at IS NULL) row when that
 * column exists, so a soft-deleted client does not steal GTL001 from a live one.
 */
export const HEAL_DUPLICATE_CLIENT_CODES_SQL = `
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
`.trim();
