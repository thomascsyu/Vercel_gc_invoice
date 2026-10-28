-- Initial schema migration: create core tables if they don't exist.
-- Run this first, then apply incremental migrations 0001-0004.
-- Idempotent: uses CREATE TABLE IF NOT EXISTS.

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users table (core authentication)
CREATE TABLE IF NOT EXISTS "invoiceplane_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "google_sub" text NOT NULL UNIQUE,
  "email" text NOT NULL,
  "full_name" text,
  "role" text NOT NULL DEFAULT 'user',
  "bank_info" jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Clients table
CREATE TABLE IF NOT EXISTS "invoiceplane_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "client_code" text NOT NULL,
  "name" text NOT NULL,
  "contact_person" text,
  "email" text,
  "phone" text,
  "address" text,
  "address_line1" text,
  "address_line2" text,
  "address_line3" text,
  "address_line4" text,
  "country" text,
  "vat_id" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Invoices table
CREATE TABLE IF NOT EXISTS "invoiceplane_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "client_id" uuid NOT NULL,
  "invoice_number" text NOT NULL,
  "invoice_date" text NOT NULL,
  "due_date" text,
  "status" text NOT NULL DEFAULT 'draft',
  "currency" text NOT NULL DEFAULT 'HKD',
  "items" jsonb NOT NULL,
  "subtotal" numeric(12, 2) NOT NULL DEFAULT '0',
  "tax_amount" numeric(12, 2) NOT NULL DEFAULT '0',
  "discount_amount" numeric(12, 2) NOT NULL DEFAULT '0',
  "total" numeric(12, 2) NOT NULL DEFAULT '0',
  "paid_amount" numeric(12, 2) NOT NULL DEFAULT '0',
  "consultant_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "cancellation_reason" text,
  "notes" text,
  "terms_conditions" text,
  "remark" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Quotations table
CREATE TABLE IF NOT EXISTS "invoiceplane_quotations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "client_id" uuid NOT NULL,
  "quotation_number" text NOT NULL,
  "quotation_date" text NOT NULL,
  "valid_until" text,
  "status" text NOT NULL DEFAULT 'draft',
  "currency" text NOT NULL DEFAULT 'HKD',
  "items" jsonb NOT NULL,
  "subtotal" numeric(12, 2) NOT NULL DEFAULT '0',
  "discount_amount" numeric(12, 2) NOT NULL DEFAULT '0',
  "total" numeric(12, 2) NOT NULL DEFAULT '0',
  "converted_invoice_id" uuid,
  "cancellation_reason" text,
  "terms_conditions" text,
  "remark" text,
  "share_token" text,
  "share_token_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Payments table
CREATE TABLE IF NOT EXISTS "invoiceplane_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "invoice_id" uuid NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "payment_date" text NOT NULL,
  "payment_method" text NOT NULL,
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Consultants table
CREATE TABLE IF NOT EXISTS "invoiceplane_consultants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "short_code" text NOT NULL,
  "name" text NOT NULL,
  "email" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Job orders table
CREATE TABLE IF NOT EXISTS "invoiceplane_job_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "client_id" uuid NOT NULL,
  "job_order_number" text NOT NULL,
  "job_date" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "source_type" text,
  "source_id" uuid,
  "items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "consultant_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Recurring invoices table
CREATE TABLE IF NOT EXISTS "invoiceplane_recurring_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "client_id" uuid NOT NULL,
  "label" text NOT NULL,
  "frequency" text NOT NULL,
  "next_run_date" text NOT NULL,
  "currency" text NOT NULL DEFAULT 'HKD',
  "items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Company settings table
CREATE TABLE IF NOT EXISTS "invoiceplane_company_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_name" text NOT NULL DEFAULT '',
  "address" text,
  "address_line1" text,
  "address_line2" text,
  "address_line3" text,
  "address_line4" text,
  "phone" text,
  "email" text,
  "vat_id" text,
  "default_currency" text NOT NULL DEFAULT 'HKD',
  "bank_account_1" jsonb,
  "bank_account_2" jsonb,
  "logo_url" text,
  "header_logo_url" text,
  "signature_image_url" text,
  "company_logo_scale" numeric(5, 2) DEFAULT '1',
  "header_logo_scale" numeric(5, 2) DEFAULT '1',
  "deepseek_api_key" text,
  "gmail_service_account" text,
  "gmail_sender_email" text,
  "gmail_account_1" jsonb,
  "gmail_account_2" jsonb,
  "email_templates" jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- API keys table
CREATE TABLE IF NOT EXISTS "invoiceplane_api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "label" text NOT NULL,
  "token_hash" text NOT NULL,
  "last4" text NOT NULL,
  "created_by_user_id" text NOT NULL,
  "revoked" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Quotation templates table
CREATE TABLE IF NOT EXISTS "invoiceplane_quotation_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "currency" text NOT NULL DEFAULT 'HKD',
  "discount_amount" numeric(12, 2) NOT NULL DEFAULT '0',
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Receipts table
CREATE TABLE IF NOT EXISTS "invoiceplane_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "receipt_number" text NOT NULL,
  "invoice_id" uuid NOT NULL,
  "client_id" uuid,
  "amount" numeric(12, 2) NOT NULL DEFAULT '0',
  "currency" text NOT NULL DEFAULT 'HKD',
  "cheque_number" text,
  "cheque_details" text,
  "receipt_date" text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "invoiceplane_receipts_user_receipt_uniq" UNIQUE ("user_id", "receipt_number")
);
