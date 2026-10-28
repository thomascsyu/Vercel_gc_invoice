# Workspace

## Overview

pnpm workspace monorepo using TypeScript. The main product is InvoicePlane SaaS, a multi-user cloud invoicing and business management web app with a shared API server and PostgreSQL persistence.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite, Wouter routing, TanStack Query, Tailwind CSS, shadcn-style components, Recharts
- **Authentication**: Direct Google OAuth 2.0 sign-in against the company's own Google Cloud OAuth client; session is a signed HttpOnly cookie. No third-party auth provider.
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), generated from OpenAPI
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild for API, Vite for frontend

## Artifacts

- `artifacts/invoiceplane` — InvoicePlane SaaS web app at `/`
- `artifacts/api-server` — shared API server at `/api`
- `artifacts/mockup-sandbox` — canvas/mockup sandbox at `/__mockup`

## InvoicePlane MVP Features

- Internal-only access screen for signed-out visitors
- Multi-user Google-account sign-in/sign-up flow for authorized staff
- User-owned client, invoice, quotation, and payment data
- Dashboard summary with revenue, outstanding balances, status breakdowns, and recent activity
- Client CRUD with search and active status
- Invoice list/create/update/delete backend support with status workflow and totals calculation
- Quotation list/create/update/delete backend support and conversion to invoice
- Payment recording/deletion with automatic invoice paid amount/status synchronization
- Per-user seed data on first authenticated access

## Database Tables

- `invoiceplane_clients`
- `invoiceplane_invoices`
- `invoiceplane_quotations`
- `invoiceplane_payments`

## Key Commands

- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes in development
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/invoiceplane run dev` — run InvoicePlane web app locally

## Notes

- API contracts live in `lib/api-spec/openapi.yaml`; update this first for backend-backed changes, then run codegen.
- Frontend imports generated hooks from `@workspace/api-client-react`.
- Backend routes validate requests/responses with generated schemas from `@workspace/api-zod`.
- Business data is scoped by the authenticated user's Google `sub` claim (stored in `invoiceplane_users.google_sub`).
- Sign-in uses the company's own Google Cloud OAuth 2.0 Web client. Configure `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_REDIRECT_URI` (e.g. `https://gcinvoice.cc/api/auth/google/callback`). Optionally restrict to a single Workspace domain with `GOOGLE_OAUTH_HOSTED_DOMAIN`.
- Email delivery is via the Gmail API using OAuth refresh tokens stored per company in `invoiceplane_company_settings`.
