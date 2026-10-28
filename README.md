# GC-INV

Internal invoicing and business management system 

GC-INV is a private, multi-user cloud web application that lets staff manage the
full quote-to-cash lifecycle from a single workspace: clients, **proposals**,
quotations, invoices, payments, consultants, job orders, recurring invoices,
receipts, quotation templates, and company settings. Authentication is restricted
to authorised Google accounts — there are no password-based logins.

For ISO consulting engagements, staff can **generate multi-section proposal PDFs**
(with cover photo and Gantt timeline), send clients a **share link** to view the
PDF, log client activity (views, downloads, questions), and convert confirmed
proposals into job orders.

> Contact: info@gabriel.hk

---

## Table of Contents

1. [Features](#features)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Architecture](#architecture)
5. [Database Schema](#database-schema)
6. [API Surface](#api-surface)
7. [Getting Started](#getting-started)
8. [Environment Variables](#environment-variables)
9. [Development Workflows](#development-workflows)
10. [Deployment](#deployment)
11. [Troubleshooting](#troubleshooting)
12. [License](#license)

---

## Features

### Core modules

| Module | Highlights |
|---|---|
| **Dashboard** | Revenue summary, outstanding balances, status breakdowns, recent activity feed |
| **Clients** | Full CRUD, search, active/inactive status, sortable columns, bulk delete & bulk status change, CSV import/export |
| **Proposals** | ISO consulting proposal generation: multi-section PDF (cover photo, firm intro, scope phases, month-grid Gantt, fee, payment schedule, T&C, signing); workflow `draft → pending approval → approved → sent → confirmed / revision requested / no response`; **client portal** (share link) with PDF viewer, optional download, questions, confirm & sign; **activity log**; create **job order** from confirmed proposal; staff editor for scope phases, payment schedule, consultants (max 3) with portfolio bios/photos, job references, and testimonials; **guided wizard** with ISO setup templates (9001 / 14001+45001 / 27001), job-reference and testimonial template libraries, session draft restore; **Templates** tab for admin-editable defaults; **milestone billing** to draft invoices; **Gmail send** (PDF + portal link) with configurable template; **revoke share link**; cover photo upload |
| **Quotations** | Status workflow `draft → pending → approved → sent → confirmed/canceled → invoiced`; PDF generation with company logo; shareable public preview link with revocable share token; expiry tracking and warnings; sortable columns; bulk operations; CSV import/export (with line items); reusable quotation templates with drag-and-drop reordering; **automated daily reminder email** before quotations expire |
| **Invoices** | Status workflow `draft → pending → approved → sent → revised → paid`; inline PDF preview & download; consultant assignment (up to 3 per invoice); sortable columns; bulk operations; CSV import/export; **continuity verification** (last number per month, sequence gaps, voided invoices) |
| **Payments** | Record payments against invoices; invoice paid amount & status update automatically; per-payment receipt uploads; CSV import/export |
| **Receipts** | Generate, edit, and email payment receipts as PDFs |
| **Consultants** | Manage consultant profiles with short codes and assign them to invoices |
| **Job Orders** | Track job orders linked to clients; create from quotation, invoice, or **confirmed proposal**; PDF generation and email |
| **Recurring Invoices** | Schedule invoices that repeat on a defined cadence |
| **Quotation Templates** | Reusable line-item bundles with custom ordering |
| **Company** | Company info (name, address, phone, email, default currency), bank accounts, branding & images (logo + header logo) |
| **Document layouts** | Per-document-type PDF layout editing: **snap-to-grid canvas** (8 PDF-point grid) to drag main sections left/right and up/down; section visibility, line-item column order, and footer text; **Preview** opens a sample PDF for invoices, quotations, receipts, or job orders without saving changes |
| **Email** | Gmail API OAuth (up to three optional sender slots: primary + two alternates) with `gmail.send`; email templates |
| **Admin** | Users, DeepSeek API key, and API keys for external integrations |

### Cross-cutting capabilities

- **Google Sign-In only** — restricted to authorised staff via direct Google OAuth 2.0 against the company's own Google Cloud OAuth client (no third-party auth provider)
- **Sortable columns** with persisted sort preference (per-page, sessionStorage)
- **Bulk operations** (delete, change status) on clients, invoices, quotations
- **CSV import / export** for every list-based module, with downloadable templates
- **PDF generation** for invoices, quotations, receipts, job orders, and **proposals** (PDFKit)
- **Proposal pipeline** — confirmed **Proposal → Job Order**; milestone billing creates draft invoices from the payment schedule; programmatic month-grid Gantt (no AI image generation)
- **PDF document layouts** — section positions use PDF points (±120 pt per axis); saved settings live in company settings (`pdf_document_layouts`). Applies to invoices, quotations, receipts, and job orders — **not proposals** (proposals use a fixed layout in `proposalPdfDraw.ts`). Older layouts stored only a vertical nudge are treated as `{ x: 0, y: n }` when rendering
- **Public share links** for quotations (revocable tokens) and **proposals** (expiring share tokens tied to validity); proposal portal logs client views, downloads, and questions
- **Scheduled background jobs** (node-cron) — e.g. daily quotation expiry reminders (run a **single** API instance, or duplicate sends are possible)
- **Per-user data isolation** — every row is scoped by authenticated user ID

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 7, Wouter routing, TanStack Query, Tailwind CSS 4, shadcn/ui (Radix), Recharts |
| Backend | Node.js (20 LTS in production Docker; `package.json` engines allow ≥18), Express 5, TypeScript 5.9 |
| Database | PostgreSQL + Drizzle ORM |
| Auth | Direct Google OAuth 2.0 (company Google Cloud OAuth client) + signed HttpOnly session cookie |
| Validation | Zod (Orval-generated schemas in `@workspace/api-zod` for core CRUD; hand-written Zod in route modules for job orders & proposals) |
| API codegen | Orval (TanStack Query hooks + Zod schemas) for OpenAPI-defined routes; `modulesApi.ts` for job orders & proposals |
| PDF | PDFKit (invoices, quotations, receipts, job orders, **proposals**) |
| Images | Sharp (logo/cover rasterisation for storage & PDF embedding) |
| AI (optional) | DeepSeek API — proposal text extraction for job orders (Admin-configured per company) |
| Email | Gmail API (`googleapis`) + OAuth2 refresh tokens |
| Object storage | Google Cloud Storage **or** a host directory bind-mounted at `/data` (Simple Application Server system disk) for logos, chops, proposal covers, payment files |
| Scheduling | node-cron |
| Build | esbuild (API), Vite (frontend) |
| Monorepo | pnpm workspaces |

---

## Project Structure

```
gc-inv/
├── artifacts/
│   ├── api-server/             # Express API server (default port 8080 in docs)
│   │   └── src/
│   │       ├── index.ts        # Server bootstrap + cron jobs
│   │       ├── app.ts          # Express app & middleware
│   │       ├── routes/         # health, auth, storage, proposals, invoiceplane, invoiceplane-modules
│   │       ├── jobs/           # Scheduled background jobs
│   │       └── lib/            # PDF (incl. proposalPdfDraw), email, storage, proposalDefaults
│   ├── invoiceplane/           # React + Vite frontend (default dev PORT 5000 — see vite.config.ts)
│   │   └── src/
│   │       ├── pages/          # Dashboard, clients, proposals, invoices, quotations, ...
│   │       ├── components/     # Reusable UI (sortable-header, dialogs, ...)
│   │       └── lib/            # Frontend utilities (+ modulesApi for job orders & proposals)
│   └── mockup-sandbox/         # Internal canvas / component preview server
├── attached_assets/            # Static assets wired into InvoicePlane via Vite alias `@assets`
├── lib/
│   ├── api-spec/               # OpenAPI spec (openapi.yaml) — source of truth
│   ├── api-client-react/       # Generated TanStack Query hooks
│   ├── api-zod/                # Generated Zod schemas
│   └── db/                     # Drizzle schema, migrations, config, push command
├── scripts/
│   └── post-merge.sh           # Runs after task merges (drizzle push, etc.)
├── deploy/
│   └── ubuntu/                 # Simple Application Server (Ubuntu 24.04): Compose, nginx, systemd
├── Dockerfile                  # Production image (Node 20 Alpine; run on the Ubuntu VM)
├── .dockerignore
├── pnpm-workspace.yaml
└── package.json
```

---

## Architecture

For the latest maintainability, data ownership, workflow, and UI/UX assessment,
see [the software review and improvement roadmap](docs/software-review.md).

```
┌──────────────────┐    HTTPS    ┌──────────────────┐    SQL    ┌────────────┐
│  React Frontend  │ ──────────► │  Express API     │ ────────► │ PostgreSQL │
│  (Vite, TS)      │             │  (Node, TS)      │           └────────────┘
│  TanStack Query  │             │  Session cookie  │
└──────┬───────────┘             │  Zod validation  │           ┌────────────┐
       │  Signed session         │  PDFKit          │ ────────► │  Google    │
       │  cookie (HttpOnly)      │  Gmail API send  │           │  Cloud     │
       │                         │  node-cron jobs  │           │  Storage   │
       ▼                         └───────┬──────────┘           └────────────┘
   ┌─────────────────┐                   │
   │  Google OAuth   │ ◄─────────────────┘  (company OAuth client,
   │  (company GCP)  │                       sign-in + Gmail API)
   └─────────────────┘
```

### Contract-first development

The OpenAPI spec at `lib/api-spec/openapi.yaml` is the **single source of truth**.
Running codegen produces:

- `lib/api-client-react` — strongly-typed TanStack Query hooks consumed by the frontend
- `lib/api-zod` — Zod schemas used by the API server for request/response validation

**Always update the OpenAPI spec first**, then run codegen, then implement the
handler and the UI. This keeps the frontend, backend, and types in lock-step.

**Exception:** Job orders use hand-written routes in `invoiceplane-modules.ts` and
`modulesApi.ts`. **Proposals** are largely defined in OpenAPI (CRUD, workflow, portal,
dashboard, setup templates); route handlers in `proposals.ts` still use hand-written Zod
and the UI uses `modulesApi.ts`.

### Per-user data scoping

Every business row carries a `userId` foreign key. The auth middleware
attaches the authenticated Google `sub` (from the signed session cookie)
to the request, and every query is filtered by it — there is no cross-user
visibility.

### Route ordering caveat

In `artifacts/api-server/src/routes/invoiceplane.ts`, **bulk routes
(`/clients/bulk-delete`, `/invoices/bulk-status`, etc.) are registered before
`/:id` routes**. Reversing the order would cause Express to capture `bulk-delete`
as an `:id` parameter and break bulk operations.

---

## Database Schema

All tables are prefixed with `invoiceplane_`:

| Table | Purpose |
|---|---|
| `invoiceplane_users` | Authenticated staff users |
| `invoiceplane_clients` | Customer records |
| `invoiceplane_invoices` | Invoices with status workflow & totals |
| `invoiceplane_quotations` | Quotations with status workflow, items (JSON), share tokens |
| `invoiceplane_payments` | Payments applied to invoices |
| `invoiceplane_payment_receipts` | Files attached to payments (receipts, screenshots, cheque deposits) |
| `invoiceplane_receipts` | Payment receipts |
| `invoiceplane_consultants` | Consultant profiles & short codes |
| `invoiceplane_job_orders` | Job orders linked to clients (source: quotation, invoice, or proposal) |
| `invoiceplane_recurring_invoices` | Scheduled recurring invoices |
| `invoiceplane_quotation_templates` | Reusable quotation templates |
| `invoiceplane_client_proposals` | Lightweight per-client proposal metadata (legacy tracker; fee, payment schedule, Drive link) |
| `invoiceplane_proposal_documents` | Full generated proposal documents (sections, workflow status, share token) |
| `invoiceplane_proposal_activity` | Client & staff activity log for proposals (views, downloads, questions, etc.) |
| `invoiceplane_proposal_questions` | Client questions raised from the public proposal portal |
| `invoiceplane_company_settings` | Per-company branding, bank, & Gmail config |
| `invoiceplane_api_keys` | API keys for integrations |

Schema lives at `lib/db/src/schema/invoiceplane.ts`. After editing it, push to
the database with:

```bash
pnpm --filter @workspace/db run push
```

---

## API Surface

All routes are mounted under `/api`. Selected highlights:

### Dashboard

- `GET /dashboard` — summary metrics
- `GET /activity` — recent activity feed

### Clients

- `GET /clients` — list (supports `sortBy`, `sortDir`, `search`)
- `POST /clients` — create
- `GET /clients/:id`, `PATCH /clients/:id`, `DELETE /clients/:id`
- `DELETE /clients/bulk-delete`, `PATCH /clients/bulk-status`
- `GET /clients/export`, `POST /clients/import`, `GET /clients/import/template`

### Invoices

- `GET /invoices` — list (sortable, filterable)
- `POST /invoices`, `GET /invoices/:id`, `PATCH /invoices/:id`, `DELETE /invoices/:id`
- `DELETE /invoices/bulk-delete`, `PATCH /invoices/bulk-status`
- `GET /invoices/:id/pdf` (authenticated) and `/invoices/:id/pdf/public` (share link)
- `GET /invoices/export`, `POST /invoices/import`
- `GET /invoices/continuity` — last invoice number per month, missing sequence slots (with alternate stamps when ambiguous), voided (soft-deleted) invoices, reissued numbers, and duplicate sequence/base collisions. Permanently purged invoices are omitted and may appear as gaps.

### Quotations

- `GET /quotations` (sortable), `POST /quotations`, full CRUD on `/quotations/:id`
- `DELETE /quotations/bulk-delete`, `PATCH /quotations/bulk-status`
- `POST /quotations/:id/convert` — convert to invoice
- `POST /quotations/:id/share-token`, `DELETE /quotations/:id/share-token`
- `GET /quotations/:id/pdf`, `GET /quotations/:id/pdf/public`
- `GET /quotations/export` (CSV includes line items as JSON)

### Proposals

Proposal routes live in `artifacts/api-server/src/routes/proposals.ts` (also documented in OpenAPI).

**Staff (authenticated):**

- `GET /proposals/dashboard` — pipeline summary (status breakdown, needs-attention queue, recent proposals)
- `GET /proposals` — list (search, filter by status, paginated)
- `POST /proposals`, `GET /proposals/:id`, `PATCH /proposals/:id`, `DELETE /proposals/:id`
- `POST /proposals/:id/submit` — submit for approval
- `POST /proposals/:id/approve`, `POST /proposals/:id/reject`
- `POST /proposals/:id/send` — mark sent and issue share token without emailing (also available as **Skip** in the send dialog)
- `POST /proposals/:id/email` — send proposal PDF + client portal link via Gmail; marks sent and issues share token
- `DELETE /proposals/:id/share-token` — revoke the client portal link
- `POST /proposals/:id/share-link` — refresh or generate share token without changing status
- `POST /proposals/:id/no-response`, `POST /proposals/:id/new-revision`
- `GET /proposals/:id/pdf` — staff PDF preview
- `GET /proposals/:id/activity` — activity log
- `GET /proposals/:id/questions`, `POST /proposals/:id/questions/:questionId/reply`
- `POST /proposals/:id/job-order` — create job order from confirmed proposal
- `POST /uploads/proposal-cover` — upload cover photo (stored in object storage)

**Client portal (public, token in query/body):**

- `GET /proposals/:id/public?token=` — portal metadata; logs link opened
- `GET /proposals/:id/pdf/public?token=` — PDF viewer; logs PDF viewed
- `POST /proposals/:id/public/download` — download PDF; logs download
- `POST /proposals/:id/public/question` — submit a question
- `POST /proposals/:id/public/confirm` — confirm & sign
- `POST /proposals/:id/public/revise` — request revision

**Frontend routes:**

- `/proposals` — staff list with **slide-out detail panel** (approve/reject/PDF in header), optional pipeline tab (`?view=pipeline`), **guided create wizard** (New proposal button), and optional **full-page builder** at `/proposals/:id/build` (5-step editor + live PDF preview rail)
- `/proposals/:id/preview?token=` — client portal (PDF iframe + actions)

**Default ISO consulting template:** System Review & Foundation (6 wk) → System Documentation (4 wk) → System Implementation & Internal Check (12 wk) → Certification Audit Support (2 wk); presentation-style PDF with ISO benefits, approach phases, optional maintenance, and `templateData` fields (sales contact, certification body, fee table, terms variables).

**Phase 1 scope:** Core PDF sections and client portal are implemented.

**Phase 2 (current):** Gmail send-from-app with **Sending Proposal** email template (Admin → Email); presentation-style PDF template library with `templateData` editor fields; enhanced staff editor (scope phases, payment schedule, consultants with portfolio photos/bios, job references, testimonials); **Templates** tab with per-standard setup defaults; **guided wizard** as primary create flow (setup templates, session draft restore, job-reference and testimonial libraries) plus optional full-page **builder** (`/proposals/:id/build`) for PDF-preview refinement; milestone billing to draft invoices; revoke and **refresh** share link. The legacy per-client proposal tracker (`invoiceplane_client_proposals`, Clients sheet) coexists with full proposal documents — prefer **Proposals** for new work.

**Staff setup templates:** `GET /proposals/setup-templates`, `PATCH /proposals/setup-templates` (admin) — ISO 9001, ISO 14001 & 45001, and ISO 27001 defaults stored in `invoiceplane_company_settings.proposal_setup_templates`.

### Payments, Receipts, Templates

- `GET /payments`, `POST /payments`, `DELETE /payments/:id`
- `GET /payments/:id/receipts`, `POST /payments/:id/receipts` — upload receipt files per payment
- `GET /receipts`, `POST /receipts`, `GET /receipts/:id/pdf`, ...
- `GET /quotation-templates`, `POST /quotation-templates/reorder`, ...

The full spec lives at `lib/api-spec/openapi.yaml`.

### PDF document layouts

These routes persist layout profiles under company settings and power the **Document layouts** page (`/document-layouts` in the app):

- `GET /pdf-document-layouts` — return merged PDF layout profiles for the signed-in user’s company
- `PATCH /pdf-document-layouts` — merge partial layout updates into stored profiles
- `POST /pdf-document-layouts/preview` — generate a **temporary** sample PDF from a draft profile (`kind`: `invoice` \| `quotation` \| `receipt` \| `jobOrder`, plus `profile`) without writing to the database

Proposal PDFs are **not** configurable via this editor; they use the dedicated renderer in `artifacts/api-server/src/lib/proposalPdfDraw.ts`.

Receipt PDFs support `?inline=true` on `GET /receipts/:id/pdf` for embedding (for example in preview iframes).

---

## Getting Started

### Prerequisites

- **Node.js 20+** recommended for parity with production Docker (**18+** allowed per root `engines`)
- **pnpm 10+** (pinned in root `packageManager`; installs are **pnpm-only** — `npm install`/`yarn` are blocked by `preinstall`)
- **PostgreSQL** (local or managed)
- A **Google Cloud OAuth 2.0 Web client** (used for both Sign in with Google and the Gmail API — they can be the same client)

### Install & run locally

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment variables (see next section).
#    Use your own `.env` for secrets; never commit production credentials.

# 3. Push the database schema (includes proposal tables — migration 0018)
pnpm --filter @workspace/db run push
# Or apply lib/db/migrations/0018_proposal_documents.sql manually

# 4. Start the API server (port 8080, or 8081 if Vite already uses 8080 — see below)
PORT=8080 pnpm --filter @workspace/api-server run dev

# 5. In another terminal, start the frontend (Vite dev server)
pnpm --filter @workspace/invoiceplane run dev
```

The frontend proxies `/api/*` calls to the API server. If **both** would listen on port **8080** (e.g. Replit sets `PORT=8080` for Vite), start the API on **8081** (`PORT=8081 ...`) or set **`VITE_API_PROXY_TARGET`** to the API’s URL — otherwise the proxy targets the wrong process and API calls fail with “Failed to fetch”.

### Admin navigation (deep links)

The admin area is grouped into **Admin**, **Company**, and **Email** sections, and supports deep linking via `tab`:

- **Admin**
  - `tab=users`
  - `tab=deepseek`
  - `tab=api-keys`
- **Company**
  - `tab=company-info`
  - `tab=company-banks`
  - `tab=company-branding`
- **Email**
  - `tab=email-gmail`
  - `tab=email-templates`

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. On the Simple Application Server this is the Compose Postgres service (`postgres` hostname). `POSTGRES_CONNECTION_STRING`, `POSTGRES_URI`, and `POSTGRES_*` parts override `DATABASE_URL` when they are set. |
| `JWT_SECRET` | yes | Random secret (≥ 32 chars) used to sign the session JWTs (access/refresh tokens). Auth fails to start without it. |
| `SESSION_SECRET` | yes | Random secret (≥ 32 bytes) used to sign OAuth state and (as the default) the Gmail OAuth `state` HMAC |
| `PORT` | yes | API server port (e.g. `8080`) |
| `TRUST_PROXY_HOPS` | no | Number of reverse-proxy hops to trust for `X-Forwarded-For`/`X-Forwarded-Proto`. Use `1` (nginx on this VM). Use `2` only if a second proxy is later placed in front of nginx. Never trust an unbounded chain — a client can spoof its IP and defeat rate limiting. |
| `GOOGLE_OAUTH_CLIENT_ID` | yes | Google Cloud OAuth 2.0 Web client ID (used for Sign in with Google; can be the same client as the Gmail API) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | yes | OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | yes | e.g. `https://gcinvoice.cc/api/auth/google/callback` — must be registered as an authorised redirect URI on the OAuth client |
| `PUBLIC_APP_URL` | recommended | Canonical public URL of the frontend, e.g. `https://gcinvoice.cc`. Used to build post-login redirects and (with `CORS_ALLOWED_ORIGINS`) to restrict credentialed browser `Origin`s. |
| `CORS_ALLOWED_ORIGINS` | optional | Comma-separated extra browser origins allowed to call the API with cookies (e.g. `http://localhost:5173,https://www.gcinvoice.cc`). Combined with the origin derived from `PUBLIC_APP_URL`. |
| `CORS_RESTRICT` | optional | `true` forces strict CORS checking against `PUBLIC_APP_URL` + `CORS_ALLOWED_ORIGINS`; `false` forces permissive (allow all origins). When **unset**, CORS is **strict whenever an allowlist is configured** and permissive only if none is set. |
| `GOOGLE_SIGN_IN_INVITE_ONLY` | optional | If `true`/`1`/`yes`, only users who already exist in `invoiceplane_users` (matching Google `sub` or email, including pre-provisioned `pending:<email>` rows) may complete sign-in; no automatic new-user registration at login. |
| `GOOGLE_OAUTH_HOSTED_DOMAIN` | optional | Restrict sign-in to a single Google Workspace domain (e.g. `gabriel.hk`). Users from other domains are rejected. |
| `QUOTATION_REMINDER_DAYS` | optional | Days before expiry to send reminder email (default `3`; must be ≥ 1) |
| `TZ` | optional | IANA timezone (e.g. `Asia/Hong_Kong`). Quotation reminders (08:00), recurring invoices (06:00), overdue filters, and “today” for `validUntil` use this zone. When unset, those jobs still use `Asia/Hong_Kong` (the Ubuntu image clock is often UTC). The Docker image sets `TZ=Asia/Hong_Kong`. |
| `AUTH_DB_FALLBACK` | optional | **Local/test only.** When `1`, auth falls back to JWT session claims if Postgres is unreachable during login checks. Leave unset in production so deactivated users cannot bypass checks during a DB outage (API returns 503 instead). |
| `GOOGLE_APPLICATION_CREDENTIALS` | optional | Path to GCS service account JSON for object storage |
| `PUBLIC_OBJECT_SEARCH_PATHS` | optional | GCS prefixes like `/my-bucket/public`. When unset, public uploads (logos, chops) go to local disk (`LOCAL_PUBLIC_UPLOAD_DIR`, or `/data/public-objects` when a volume is mounted at `/data`). |
| `PRIVATE_OBJECT_DIR` | optional | GCS prefix for private uploads (e.g. `/my-bucket/private`). When unset, private files use `LOCAL_PRIVATE_UPLOAD_DIR` or `/data/private-objects` on a `/data` volume. |
| `LOCAL_PUBLIC_UPLOAD_DIR` | optional | Local directory for public uploads when GCS is unset (default `.local/public-objects`, or `/data/public-objects` when `/data` is a bind mount or `PERSIST_LOCAL_UPLOADS=1`). |
| `LOCAL_PRIVATE_UPLOAD_DIR` | optional | Local directory for private uploads when `PRIVATE_OBJECT_DIR` is unset. |
| `PERSIST_LOCAL_UPLOADS` | optional | Set to `1`/`true` so local disk is treated as persistent. Set this on the server together with the `/data` bind mount. A dedicated mount at `/data`, or a path on the Ubuntu root disk (ext4/xfs), is also detected as persistent. Overlay container disk is not. |
| `GMAIL_OAUTH_CLIENT_ID` | optional | Separate OAuth client for the Gmail API. Falls back to `GOOGLE_OAUTH_CLIENT_ID` if unset. |
| `GMAIL_OAUTH_CLIENT_SECRET` | optional | Separate OAuth client secret for Gmail. Falls back to `GOOGLE_OAUTH_CLIENT_SECRET`. |
| `GMAIL_OAUTH_REDIRECT_URI` | optional | Gmail OAuth redirect URI, e.g. `https://gcinvoice.cc/api/gmail/oauth/callback`. |
| `GMAIL_OAUTH_STATE_SECRET` | optional | Override secret for signing the Gmail OAuth `state` parameter. Defaults to `SESSION_SECRET`. |
| `INVOICEPLANE_STATIC_ROOT` | optional | Absolute path to the built Vite `public` folder (`index.html`). Auto-detected when the API runs next to `artifacts/invoiceplane/dist/public`; set this if you deploy the bundle elsewhere. |
| `VITE_API_ORIGIN` | optional (frontend build) | Full API origin used by the browser app when frontend and API are on different hosts, e.g. `https://api.gcinvoice.cc`. Leave unset when `/api/*` is same-origin and proxied. |
| `VITE_API_PROXY_TARGET` | optional (Vite dev/preview) | URL the dev server proxies `/api/*` to (default `http://127.0.0.1:8080`, or `:8081` when Vite’s `PORT` is `8080`). Set explicitly if your API listens elsewhere. |
| `DEEPSEEK_API_BASE` | optional | Override DeepSeek API base URL (default `https://api.deepseek.com`) — used by Admin “Test connection” |
| `NODE_ENV` | yes in production | Set to `production` (the Docker image does this). Production refuses to boot without Google OAuth, strict CORS, and a long `JWT_SECRET`. |

Gmail and DeepSeek secrets for production are stored **per company** in `invoiceplane_company_settings` where applicable, not only in env vars.

### Google Cloud OAuth client setup

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create (or reuse) an **OAuth 2.0 Web application** client.
2. Add these **Authorised JavaScript origins**:
   - `https://gcinvoice.cc`
   - Your local InvoicePlane origin, e.g. `http://localhost:5000` (default Vite `PORT`; use `5173` only if you set `PORT` that way)
3. Add these **Authorised redirect URIs**:
   - `https://gcinvoice.cc/api/auth/google/callback` (Sign in with Google)
   - `https://gcinvoice.cc/api/gmail/oauth/callback` (Gmail API “Connect mailbox” flow)
   - Matching `http://localhost:8080/...` redirects for local dev, if needed
4. Enable the **Gmail API** on the same Google Cloud project. The Gmail connect flow requests the **`gmail.send`** scope.
5. Paste the client ID/secret into the `GOOGLE_OAUTH_*` env vars (and optionally the `GMAIL_OAUTH_*` vars if you want to split clients).

---

## Development Workflows

### Add a new API endpoint

1. Edit `lib/api-spec/openapi.yaml` — add the path, request, and response schemas.
2. Regenerate types and hooks:
   ```bash
   pnpm --filter @workspace/api-spec run codegen
   ```
3. Implement the route handler in `artifacts/api-server/src/routes/invoiceplane.ts`, `invoiceplane-modules.ts`, or `proposals.ts`, depending on the feature area (all mount under `/api`).
   - Validate request bodies with the generated Zod schema from `@workspace/api-zod`.
   - Remember to register routes like `/foo/bulk-*` **before** `/foo/:id` in whichever router owns that path.
4. Use the generated TanStack Query hook from `@workspace/api-client-react` in the frontend.

### Add a new database column or table

1. Edit `lib/db/src/schema/invoiceplane.ts`.
2. Push the change:
   ```bash
   pnpm --filter @workspace/db run push
   ```
3. If the column should be exposed via the API, update `openapi.yaml` and re-run codegen.

### Typecheck the whole monorepo

```bash
pnpm run typecheck
```

### Run frontend tests (helpers and invoice form)

```bash
pnpm --filter @workspace/invoiceplane run test
```

The new-invoice form previews an available number, allows edits, and checks availability before submitting. The server rechecks before inserting and the existing unique index protects concurrent saves. Conflicts return HTTP 409 with `Duplicate invoice number`. Uniqueness follows the existing account/data-mode scope and excludes soft-deleted invoices (migration 0046). Previewing a number does not reserve it.

The supporting authenticated endpoints are `GET /api/invoices/next-number` (`{ invoiceNumber }`) and `GET /api/invoices/number-availability?invoiceNumber=...` (`{ available }`). Creating an invoice accepts an optional `invoiceNumber`; omitting it keeps server-side automatic numbering.

Run the PostgreSQL integration tests against a **disposable database** with the current schema installed:

```bash
INVOICE_NUMBER_TEST_DATABASE_URL=postgresql://localhost/gc_inv_test \
  pnpm --filter @workspace/api-server exec tsx --test src/routes/invoices-number.integration.test.ts
```

These cover previewing and saving the assigned number, custom numbers, duplicate creation/update, concurrent saves, database enforcement, and occupied automatic numbers. Without `INVOICE_NUMBER_TEST_DATABASE_URL`, this suite is skipped.


### Build for production

```bash
# API server (esbuild → artifacts/api-server/dist/index.mjs)
pnpm --filter @workspace/api-server run build

# Frontend (Vite → artifacts/invoiceplane/dist/)
pnpm --filter @workspace/invoiceplane run build
```

---

## Deployment

> **Vercel:** the app can also be deployed to Vercel (static SPA + one serverless API function + Vercel Cron). See [docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md).

Production runs on an **Alibaba Cloud Simple Application Server** in **China (Hong Kong)** with **Ubuntu 24.04**. One Docker container serves both `/api/*` and the InvoicePlane SPA. Nginx on the same server terminates TLS with Let’s Encrypt. Run **one** app container: the quotation-reminder and recurring-invoice jobs live in that process.

This server’s subscription ends on **17 Nov 2026**. Renew it in the console before that date. An expired server stops the site even when the app itself is healthy.

The image is Node 20 on Alpine. The host stays Ubuntu. Build on the server with the root `Dockerfile`. Do not `pnpm install` on the host and copy `node_modules` into the image — Alpine and Ubuntu do not share native binaries.

Ubuntu 24.04’s default Node is 18. The container already supplies Node 20, so the host does not need a Node install.

### What you need on the server

| Piece | Recommendation |
|---|---|
| Compute | Simple Application Server, Ubuntu 24.04, 2 GB RAM or more (PDF and image processing) |
| Login | The key pair is unbound. Sign in with the password from the console, or attach a key pair first. |
| Database | Postgres 16 in Compose on this server (`--profile local-db`). The server is not in a user VPC, so an RDS internal address is not the normal setup. |
| Uploads | Host directory `/var/lib/gc-inv/uploads` on the system disk, bind-mounted at `/data`. There is no Alibaba OSS client in this app. GCS remains optional. |
| TLS | Let’s Encrypt on nginx (`certbot --nginx`). Leave `TRUST_PROXY_HOPS=1`. |
| Firewall | On the server’s **Firewall** page, allow TCP 22, 80, and 443 only. Leave 5432 and 8080 closed. If `ufw` is active, allow the same three ports. |
| Clock | `TZ=Asia/Hong_Kong` (the image default). Reminders run at 08:00 in that zone even when the Ubuntu clock is UTC. |
| Backups | Console snapshots. A system reset or image reinstall wipes `/var/lib/gc-inv`. |

### Docker and the private address

The server’s private address is inside `172.17.0.0/16`, which is also Docker’s default bridge. After the repo is cloned, install `deploy/ubuntu/docker-daemon.json` **before** the first container starts. That file sets the bridge to `172.31.0.1/16`. Check first that `172.31.0.0/16` and `172.30.0.0/16` are free (`ip route`). If `/etc/docker/daemon.json` already exists (logging, registry mirrors, etc.), **merge** the `bip` and `default-address-pools` keys into that file instead of replacing it wholesale.

### First-time setup

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
sudo systemctl enable --now docker

sudo mkdir -p /var/lib/gc-inv/uploads /var/lib/gc-inv/postgres /opt/gc-inv
sudo chown "$USER":"$USER" /opt/gc-inv
git clone <repo-url> /opt/gc-inv
cd /opt/gc-inv
ip route
sudo mkdir -p /etc/docker
sudo cp deploy/ubuntu/docker-daemon.json /etc/docker/daemon.json
sudo systemctl restart docker

cp deploy/ubuntu/env.example deploy/ubuntu/.env
# Edit deploy/ubuntu/.env — POSTGRES_PASSWORD, JWT_SECRET, SESSION_SECRET, Google OAuth.
# Compose builds DATABASE_URL from POSTGRES_*; you do not maintain a second password copy.

cd deploy/ubuntu
docker compose --profile local-db up -d --build
```

`deploy/ubuntu/docker-compose.yml` publishes the app on `127.0.0.1:8080` only and mounts `/var/lib/gc-inv/uploads` at `/data`. SQL migrations in `lib/db/migrations` run on each boot (they are idempotent). You do not run `drizzle-kit push` against production.

Check the process:

```bash
docker compose --profile local-db ps
curl -fsS http://127.0.0.1:8080/api/readyz
```

Open TCP 80 and 443 on the server **Firewall** page, then install the nginx site (`deploy/ubuntu/nginx-gc-inv.conf`):

```bash
sudo cp /opt/gc-inv/deploy/ubuntu/nginx-gc-inv.conf /etc/nginx/sites-available/gc-inv
sudo ln -sf /etc/nginx/sites-available/gc-inv /etc/nginx/sites-enabled/gc-inv
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d gcinvoice.cc
```

Leave `TRUST_PROXY_HOPS=1`. Nginx sends `X-Forwarded-Proto` so session cookies are marked Secure. If a second proxy is later placed in front of nginx, set `TRUST_PROXY_HOPS=2` and forward that proxy’s proto header. See the comment in `deploy/ubuntu/nginx-gc-inv.conf`.

Optional boot unit: `deploy/ubuntu/gc-inv.service` (it starts the `local-db` profile without rebuilding the image). After `git pull`, run `docker compose --profile local-db up -d --build` manually. Docker’s `restart: unless-stopped` already restarts a container that was running before reboot.

### Database

Postgres runs on this server. Set `POSTGRES_PASSWORD` in `deploy/ubuntu/.env`; Compose builds `DATABASE_URL` with hostname `postgres`. The database port is not published on the host, and it stays closed on the Firewall page.

```bash
docker compose --profile local-db up -d --build
```

### Uploads

Container disk is wiped when the container is recreated. Logos, chops, proposal covers, and payment files live on the system disk through the host mount:

- `PERSIST_LOCAL_UPLOADS=1`
- `LOCAL_PUBLIC_UPLOAD_DIR=/data/public-objects`
- `LOCAL_PRIVATE_UPLOAD_DIR=/data/private-objects`
- Host path: `/var/lib/gc-inv/uploads`

Take a console snapshot after logos are uploaded. A system reset or image reinstall removes this directory. Re-upload logos once after the directory is first created (it starts empty). The Branding tab warning clears when storage is persistent. If the warning disappears but files vanish after a container recreate, verify the host bind mount (`GC_INV_UPLOAD_DIR` → `/data`) — `PERSIST_LOCAL_UPLOADS=1` alone does not persist uploads without that mount.

A later data disk can replace the system-disk path: mount it, point `GC_INV_UPLOAD_DIR` and `GC_INV_PG_DIR` at directories on that disk, and restart Compose. Google Cloud Storage is still supported via `PUBLIC_OBJECT_SEARCH_PATHS` and `GOOGLE_APPLICATION_CREDENTIALS`.

### Updates

```bash
cd /opt/gc-inv
git pull
cd deploy/ubuntu
docker compose --profile local-db up -d --build
```

Keep a single app container. A second replica would send duplicate reminder emails.

### Moving an existing database and uploads

If the live site was on Zeabur, copy data before changing DNS:

1. `pg_dump` the current database and restore it into the Compose Postgres service. Startup migrations are safe to re-run on a database that already has the tables.
2. Copy the old upload volume into `/var/lib/gc-inv/uploads/` so `public-objects` and `private-objects` sit directly under that directory (the container sees them as `/data/public-objects` and `/data/private-objects`).
3. Point `gcinvoice.cc` at the public IP on the server’s Basic Information page. If the domain is unchanged, the Google OAuth client keeps the same redirect URIs.

### Google OAuth

Register these on the OAuth client, matching `GOOGLE_OAUTH_REDIRECT_URI` and `PUBLIC_APP_URL`:

- Authorised JavaScript origin: `https://gcinvoice.cc`
- Redirect: `https://gcinvoice.cc/api/auth/google/callback`
- Redirect: `https://gcinvoice.cc/api/gmail/oauth/callback` (if Gmail send is used)

### Same-origin app

Nginx proxies every path, including `/api/*`, to the Node process. Do not point the site root at a static file directory. If the SPA and API are ever split across hosts, proxy `/api/*` to the API and set `VITE_API_ORIGIN` at **frontend build** time (`artifacts/invoiceplane/vite.config.ts`, `BASE_PATH` for a subpath). Backend secrets are not read by the browser bundle.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Bulk delete returns 404 or “invalid id” | A `/:id` route was registered before the `/bulk-*` route in Express. Reorder them. |
| Frontend hook missing after editing OpenAPI | Re-run `pnpm --filter @workspace/api-spec run codegen`. |
| `drizzle-kit push` says “No changes detected” after schema edit | Make sure you saved the file and that `lib/db/src/schema/invoiceplane.ts` is exported via `lib/db/src/schema/index.ts`. |
| Quotation reminder email never sends | Check the daily 08:00 cron log line `Quotation expiry reminder job scheduled`, confirm `QUOTATION_REMINDER_DAYS` is a valid integer ≥ 1, set `TZ` if the server’s “today” does not match your locale, and that `gmailAccount1` is configured in company settings. If a user has signed in but has no row in `invoiceplane_users`, reminders for their quotations are skipped (see server warning log). |
| Duplicate reminder emails | Only one API replica should run the cron job; scale horizontally with separate workers or disable the job on extra instances. |
| Public share / auth rate limits seem too loose | In-memory rate limits apply **per API replica**. Behind a load balancer, effective limits are multiplied by instance count unless you run a single replica for public routes or add a shared store (e.g. Redis). |
| API fails with `connect ECONNREFUSED …:5432` | `DATABASE_URL` must use hostname `postgres` with `docker compose --profile local-db`. `127.0.0.1` inside the app container is the container itself. Confirm the `postgres` service is running and port 5432 is not required on the Firewall page. |
| Postgres log: `FATAL: terminating connection due to administrator command` (SQLSTATE **57P01**) | Normal when the Postgres container restarts or the server kills an idle connection. The pool drops that client and opens a new one; retry the request. If the API crash-loops, confirm the `postgres` service is up and `DATABASE_URL` matches `POSTGRES_PASSWORD`. Tune `PG_POOL_MAX_LIFETIME_SECONDS` / `PG_POOL_IDLE_TIMEOUT_MS` if idle kills are frequent. |
| Site times out from the internet while `curl` on the server works | The server Firewall page does not allow TCP 80/443, or `ufw` is blocking them. |
| Docker fails to start, or the server loses its private address after installing Docker | The Docker bridge overlapped `172.17.0.0/16`. Install `deploy/ubuntu/docker-daemon.json` and restart Docker. |
| Docker build: `429 Too Many Requests` pulling `node` from Docker Hub | The root `Dockerfile` uses `public.ecr.aws/docker/library/node:20-alpine`. Keep that `FROM` line. |
| Docker build: `cd: can't cd to artifacts/invoiceplane` or missing `dist/index.mjs` | Build with the root `Dockerfile` (context is the repo root). Do not exclude `artifacts/invoiceplane` in `.dockerignore`. |
| Google sign-in: “web page instead of API” / HTML for `/api/*` | Nginx is serving a static directory, or `/api` is not proxied to the container. Proxy the whole site to `127.0.0.1:8080` (see `deploy/ubuntu/nginx-gc-inv.conf`). |
| Sign-in succeeds then the session disappears | Nginx forwarded `X-Forwarded-Proto http`, or `TRUST_PROXY_HOPS` does not match the proxy chain (it should be `1` with certbot on this server). See the deployment section. |
| Google sign-in returns `redirect_uri_mismatch` | Add the exact `GOOGLE_OAUTH_REDIRECT_URI` value (e.g. `https://gcinvoice.cc/api/auth/google/callback`) to the OAuth client's **Authorised redirect URIs** in Google Cloud Console. |
| Google sign-in returns `unauthorized_domain` | The signed-in Google account is not in the Workspace domain configured by `GOOGLE_OAUTH_HOSTED_DOMAIN`. Remove the env var to allow any account, or sign in with an approved `@{domain}` identity. |
| Logo upload fails | Set `GOOGLE_APPLICATION_CREDENTIALS` and grant the service account `Storage Object Admin` on the bucket. |
| Header logo / company logo / company stamp disappear after a redeploy | Uploads were on container disk. Bind-mount a host directory at `/data` and set `PERSIST_LOCAL_UPLOADS=1` (see Deployment). Or configure GCS. Re-upload logos once after the mount is first attached. |
| Proposal tables missing | Run `pnpm --filter @workspace/db run push` or apply `lib/db/migrations/0018_proposal_documents.sql`. |
| Client proposal link returns 410 | Token expired, revoked, or proposal superseded/cancelled; use **Send to client** or **Mark sent (no email)** to issue a new link. |

---

## License

Private — internal use by Gabriel Consultant Limited only. All rights reserved.
