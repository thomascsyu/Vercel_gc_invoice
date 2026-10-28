-- Speed up quotation expiry reminder cron and valid-until list filters

CREATE INDEX IF NOT EXISTS "invoiceplane_quotations_valid_until_idx"
  ON "invoiceplane_quotations" ("valid_until");

CREATE INDEX IF NOT EXISTS "invoiceplane_quotations_valid_until_status_idx"
  ON "invoiceplane_quotations" ("valid_until", "status");
