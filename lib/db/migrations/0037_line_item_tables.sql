-- Replaces the `items` jsonb array on invoices, quotations, job orders,
-- recurring invoices, and quotation templates with per-row child tables that
-- preserve line-item order via an explicit `position` column. The jsonb
-- arrays had no referential integrity and, more importantly, no queryable
-- structure -- every read/write had to round-trip the entire array even to
-- touch one line. `position` is required (not merely useful) because PDF
-- renderers (invoicePdfDraw.ts, quotationReceiptPdfDraw.ts, jobOrderPdfDraw.ts
-- via pdfInvoiceLines.ts) iterate line items top-to-bottom -- array order was
-- load-bearing under jsonb and stays load-bearing here, now made explicit and
-- enforced by a (parent_id, position) unique constraint instead of being
-- implicit in array order.
--
-- quantity/price/tax_rate use double precision, not numeric: proposal
-- milestone billing computes `amount = proposalTotal * (percentage / 100)`
-- with no rounding before it becomes a line item's `price` (see
-- proposalMilestoneBilling.ts), which can produce values like
-- 8333.333333333334 that a fixed-scale numeric column would silently round.
-- jsonb already stored these fields as plain IEEE-754 doubles, so double
-- precision is the lossless, zero-behavior-change column type.
--
-- Idempotent: each table's own CREATE TABLE IF NOT EXISTS makes re-running
-- safe, and the jsonb column's continued existence is the backfill sentinel
-- (same style as 0035/0036) -- once a parent table's `items` column is
-- dropped, that table's DO block becomes a no-op on every later run.
-- jsonb_array_elements(...) WITH ORDINALITY supplies the position (1-based
-- in Postgres; stored as-is, callers don't rely on 0-based positions, only
-- on relative order). Non-array/NULL `items` values (never expected in
-- practice, since every parent column was NOT NULL with a jsonb array
-- default) are guarded the same way 0036 guards consultant_ids, so a
-- corrupt/legacy row can't abort the migration.

CREATE TABLE IF NOT EXISTS "invoiceplane_invoice_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoice_id" uuid NOT NULL REFERENCES "invoiceplane_invoices"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "description" text,
  "details" text,
  "quantity" double precision NOT NULL DEFAULT 0,
  "price" double precision NOT NULL DEFAULT 0,
  "tax_rate" double precision,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "invoiceplane_invoice_items_parent_position_uniq" UNIQUE ("invoice_id", "position")
);

CREATE TABLE IF NOT EXISTS "invoiceplane_quotation_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quotation_id" uuid NOT NULL REFERENCES "invoiceplane_quotations"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "description" text,
  "details" text,
  "quantity" double precision NOT NULL DEFAULT 0,
  "price" double precision NOT NULL DEFAULT 0,
  "tax_rate" double precision,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "invoiceplane_quotation_items_parent_position_uniq" UNIQUE ("quotation_id", "position")
);

CREATE TABLE IF NOT EXISTS "invoiceplane_job_order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_order_id" uuid NOT NULL REFERENCES "invoiceplane_job_orders"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "description" text,
  "details" text,
  "quantity" double precision NOT NULL DEFAULT 0,
  "price" double precision NOT NULL DEFAULT 0,
  "tax_rate" double precision,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "invoiceplane_job_order_items_parent_position_uniq" UNIQUE ("job_order_id", "position")
);

CREATE TABLE IF NOT EXISTS "invoiceplane_recurring_invoice_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "recurring_invoice_id" uuid NOT NULL REFERENCES "invoiceplane_recurring_invoices"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "description" text,
  "details" text,
  "quantity" double precision NOT NULL DEFAULT 0,
  "price" double precision NOT NULL DEFAULT 0,
  "tax_rate" double precision,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "invoiceplane_recurring_invoice_items_parent_position_uniq" UNIQUE ("recurring_invoice_id", "position")
);

CREATE TABLE IF NOT EXISTS "invoiceplane_quotation_template_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quotation_template_id" uuid NOT NULL REFERENCES "invoiceplane_quotation_templates"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "name" text NOT NULL DEFAULT '',
  "description" text,
  "details" text,
  "quantity" double precision NOT NULL DEFAULT 0,
  "price" double precision NOT NULL DEFAULT 0,
  "tax_rate" double precision,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "invoiceplane_quotation_template_items_parent_position_uniq" UNIQUE ("quotation_template_id", "position")
);

-- invoiceplane_invoices.items -> invoiceplane_invoice_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoiceplane_invoices'
       AND column_name = 'items'
  ) THEN
    INSERT INTO "invoiceplane_invoice_items"
      ("invoice_id", "position", "name", "description", "details", "quantity", "price", "tax_rate")
    SELECT
      i."id",
      elem.ord::integer,
      COALESCE(elem.value->>'name', ''),
      NULLIF(elem.value->>'description', ''),
      NULLIF(elem.value->>'details', ''),
      COALESCE((elem.value->>'quantity')::double precision, 0),
      COALESCE((elem.value->>'price')::double precision, 0),
      (elem.value->>'taxRate')::double precision
      FROM "invoiceplane_invoices" i
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(i."items") = 'array' THEN i."items" ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS elem(value, ord)
    ON CONFLICT ("invoice_id", "position") DO NOTHING;

    ALTER TABLE "invoiceplane_invoices" DROP COLUMN "items";
  END IF;
END $$;

-- invoiceplane_quotations.items -> invoiceplane_quotation_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoiceplane_quotations'
       AND column_name = 'items'
  ) THEN
    INSERT INTO "invoiceplane_quotation_items"
      ("quotation_id", "position", "name", "description", "details", "quantity", "price", "tax_rate")
    SELECT
      q."id",
      elem.ord::integer,
      COALESCE(elem.value->>'name', ''),
      NULLIF(elem.value->>'description', ''),
      NULLIF(elem.value->>'details', ''),
      COALESCE((elem.value->>'quantity')::double precision, 0),
      COALESCE((elem.value->>'price')::double precision, 0),
      (elem.value->>'taxRate')::double precision
      FROM "invoiceplane_quotations" q
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(q."items") = 'array' THEN q."items" ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS elem(value, ord)
    ON CONFLICT ("quotation_id", "position") DO NOTHING;

    ALTER TABLE "invoiceplane_quotations" DROP COLUMN "items";
  END IF;
END $$;

-- invoiceplane_job_orders.items -> invoiceplane_job_order_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoiceplane_job_orders'
       AND column_name = 'items'
  ) THEN
    INSERT INTO "invoiceplane_job_order_items"
      ("job_order_id", "position", "name", "description", "details", "quantity", "price", "tax_rate")
    SELECT
      j."id",
      elem.ord::integer,
      COALESCE(elem.value->>'name', ''),
      NULLIF(elem.value->>'description', ''),
      NULLIF(elem.value->>'details', ''),
      COALESCE((elem.value->>'quantity')::double precision, 0),
      COALESCE((elem.value->>'price')::double precision, 0),
      (elem.value->>'taxRate')::double precision
      FROM "invoiceplane_job_orders" j
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(j."items") = 'array' THEN j."items" ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS elem(value, ord)
    ON CONFLICT ("job_order_id", "position") DO NOTHING;

    ALTER TABLE "invoiceplane_job_orders" DROP COLUMN "items";
  END IF;
END $$;

-- invoiceplane_recurring_invoices.items -> invoiceplane_recurring_invoice_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoiceplane_recurring_invoices'
       AND column_name = 'items'
  ) THEN
    INSERT INTO "invoiceplane_recurring_invoice_items"
      ("recurring_invoice_id", "position", "name", "description", "details", "quantity", "price", "tax_rate")
    SELECT
      r."id",
      elem.ord::integer,
      COALESCE(elem.value->>'name', ''),
      NULLIF(elem.value->>'description', ''),
      NULLIF(elem.value->>'details', ''),
      COALESCE((elem.value->>'quantity')::double precision, 0),
      COALESCE((elem.value->>'price')::double precision, 0),
      (elem.value->>'taxRate')::double precision
      FROM "invoiceplane_recurring_invoices" r
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(r."items") = 'array' THEN r."items" ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS elem(value, ord)
    ON CONFLICT ("recurring_invoice_id", "position") DO NOTHING;

    ALTER TABLE "invoiceplane_recurring_invoices" DROP COLUMN "items";
  END IF;
END $$;

-- invoiceplane_quotation_templates.items -> invoiceplane_quotation_template_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invoiceplane_quotation_templates'
       AND column_name = 'items'
  ) THEN
    INSERT INTO "invoiceplane_quotation_template_items"
      ("quotation_template_id", "position", "name", "description", "details", "quantity", "price", "tax_rate")
    SELECT
      t."id",
      elem.ord::integer,
      COALESCE(elem.value->>'name', ''),
      NULLIF(elem.value->>'description', ''),
      NULLIF(elem.value->>'details', ''),
      COALESCE((elem.value->>'quantity')::double precision, 0),
      COALESCE((elem.value->>'price')::double precision, 0),
      (elem.value->>'taxRate')::double precision
      FROM "invoiceplane_quotation_templates" t
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t."items") = 'array' THEN t."items" ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS elem(value, ord)
    ON CONFLICT ("quotation_template_id", "position") DO NOTHING;

    ALTER TABLE "invoiceplane_quotation_templates" DROP COLUMN "items";
  END IF;
END $$;
