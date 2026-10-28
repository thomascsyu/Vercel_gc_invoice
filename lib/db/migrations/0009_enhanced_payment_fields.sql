-- Add enhanced payment tracking fields to invoiceplane_payments table
ALTER TABLE invoiceplane_payments
  ADD COLUMN IF NOT EXISTS cheque_number text,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS deposit_date text,
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS transaction_id text;

-- Add index for faster search on cheque number
CREATE INDEX IF NOT EXISTS idx_payments_cheque_number ON invoiceplane_payments(cheque_number);

-- Add index for bank name search
CREATE INDEX IF NOT EXISTS idx_payments_bank_name ON invoiceplane_payments(bank_name);

-- Add index for deposit date filtering
CREATE INDEX IF NOT EXISTS idx_payments_deposit_date ON invoiceplane_payments(deposit_date);
