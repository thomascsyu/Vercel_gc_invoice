-- Migration for Task #85: Let users reorder or pin templates so the most-used ones appear first.
-- Idempotent: safe to apply over a database that has already been brought up
-- with `drizzle-kit push` against the new schema.

-- ---------- invoiceplane_quotation_templates: add sort_order column ----------
ALTER TABLE "invoiceplane_quotation_templates"
  ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;

-- Backfill: assign sort_order based on creation order so existing rows have
-- a meaningful initial sequence (oldest template gets lowest sort_order).
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC) - 1 AS rn
  FROM "invoiceplane_quotation_templates"
  WHERE sort_order = 0
)
UPDATE "invoiceplane_quotation_templates" qt
   SET sort_order = ordered.rn
  FROM ordered
 WHERE qt.id = ordered.id;
