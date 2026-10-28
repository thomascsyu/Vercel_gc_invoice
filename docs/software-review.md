# GC-INV software review

**Review date:** 2026-09-07  
**Scope:** data model, application structure, business logic and request sequence, and staff-facing UI/UX

## Executive summary

GC-INV has a sound baseline for an internal finance application: schema-level foreign keys and uniqueness rules, transactional multi-table writes, centralized authentication/CSRF/rate limiting, reusable workflow rules, route-level code splitting, and shared loading/error UI. The most important next step is not a rewrite. It is to make the product's ownership model explicit, then reduce parallel implementations and oversized feature files around that model.

The review identified four priorities:

1. **Decide and enforce one ownership model.** Most commercial records are scoped by `userId` and `dataMode`, while consultants and company settings are global. The README currently describes all business rows as per-user. This ambiguity is a data-access and product-behaviour risk.
2. **Make one API contract authoritative.** Core CRUD uses generated OpenAPI clients and schemas, while module/proposal endpoints use a 1,100-line handwritten client and separate types. That invites request/response drift.
3. **Separate orchestration from transport and presentation.** Several UI pages are 1,000–2,000 lines and several route modules combine parsing, validation, querying, workflow, CSV and response mapping. Smaller feature services and view-model hooks would make lifecycle changes safer.
4. **Align navigation and documentation with shipped functionality.** Proposal implementation remains extensive, but every staff proposal route currently renders a disabled page while the public preview remains enabled. This should be an explicit feature flag or removed from the advertised active workflow.

## Current architecture

```text
Browser (React/Vite)
  -> Wouter route + auth guard
  -> TanStack Query / generated client or modulesApi request helper
  -> Express middleware (logging -> security headers -> CORS -> body parsing)
  -> /api rate limit -> CSRF check -> auth/admin guard -> route handler
  -> Drizzle transaction/query
  -> PostgreSQL

Document delivery branches from route/service logic to PDFKit, object storage,
and Gmail. Scheduled jobs call the same database layer for recurring invoices
and quotation reminders.
```

### What is working well

- **Relational integrity has improved.** Document line items use child tables with parent-position uniqueness; consultant assignments use composite-key join tables; core records have foreign keys and useful list indexes.
- **Money is persisted deliberately.** Header totals use fixed-scale `numeric(12,2)`, and payment-driven status changes are centralized in shared helpers. The distinction between persisted money and line-item calculation values is documented.
- **Complex writes are generally atomic.** Invoice, quotation, payment, receipt, proposal milestone, recurring invoice, and backup operations use database transactions.
- **Security middleware is layered correctly.** API middleware runs before static delivery, mutation requests require a non-simple CSRF header, errors are normalized, and proxy trust is bounded.
- **The UI already has useful foundations.** Protected routes are lazy-loaded, list views share loading/error/empty handling, keyboard users get a skip link, and charts honor reduced-motion preferences.

## Findings and recommendations

### P0 — resolve ownership and isolation semantics

**Observation.** Clients, invoices, quotations, payments, receipts, job orders, templates and proposals carry a Google-subject `userId`. Consultants and company settings do not. Consultant list/update/delete queries are global. The UI and README otherwise present GC-INV as one company workspace for multiple staff.

**Risk.** If users are intended to collaborate, user scoping hides records and can produce duplicate company-wide document numbers. If users are intended to be isolated tenants, global consultants/settings can leak or modify shared data. A Google subject is also an authentication identity, not a durable company/tenant boundary.

**Recommendation.** Introduce an explicit `organization` (or `workspace`) entity and memberships:

```text
organizations(id, name, ...)
organization_members(organization_id, user_id, role)
business tables -> organization_id
audit rows -> organization_id + actor_user_id
```

Keep `createdByUserId`/`updatedByUserId` for attribution, not tenancy. Put organization and live/test mode into every relevant unique key and query. Add cross-organization integration tests for reads, writes, IDs supplied in URLs, bulk actions, exports, PDFs, uploads, and public-token endpoints before migrating production data.

**Decision required.** If GC-INV intentionally has exactly one company and all users should see the same data, simplify to company scope rather than pretending each Google account is a tenant. Document that invariant and enforce it consistently.

### P0 — reconcile the proposal feature state

**Observation.** The router maps `/proposals`, `/proposals/new`, and `/proposals/:id/build` to `ProposalsDisabled`, but proposal pages, APIs, tables, jobs, public preview, and README feature descriptions remain present.

**Risk.** Staff cannot follow the documented proposal-to-job-order sequence. Disabled UI does not necessarily disable API capability, which creates an unclear support and security boundary.

**Recommendation.** Add a server-owned capability response such as `GET /capabilities` and gate navigation, routes, API mutations, and documentation from the same flag. Choose one state:

- **Enabled:** lazy-load the real proposal list/builder and add an end-to-end happy-path test.
- **Disabled:** return `404` or `403` from staff proposal mutations, hide proposal navigation, retain only explicitly supported public links, and label the README feature as unavailable.

Avoid compile-time UI-only disabling for a business capability.

### P1 — converge on one API contract

**Observation.** Generated clients cover core endpoints, while `modulesApi.ts` duplicates transport, DTOs, and endpoint strings for modules and proposals. Backend proposal/job-order validation is also partly handwritten.

**Risk.** Renames and optionality changes can compile on one side while failing at runtime on the other. The local request helper also has separate error and download handling paths.

**Recommendation.** Add every supported endpoint to OpenAPI in vertical slices, generate both the React client and server schemas, and shrink `modulesApi.ts` to only operations the generator cannot express. Keep one shared fetch policy for credentials, session refresh, CSRF, structured errors, and binary downloads. Add a CI check that code generation produces no diff.

Suggested sequence:

1. consultants and company settings;
2. job orders and recurring invoices;
3. proposal CRUD/workflow/portal;
4. uploads, backup and binary responses.

### P1 — centralize lifecycle orchestration

**Observation.** Invoice and quotation transition rules are shared, but route handlers still coordinate state checks, audit events, line-item replacement, consultant links, conversion, payment reconciliation, PDF/email actions, and response mapping in multiple files. Proposal workflow has its own parallel status model.

**Risk.** A new transition can be exposed in the UI without all required side effects, or bulk and single-record paths can diverge.

**Recommendation.** Create application services with explicit commands and transaction boundaries:

```ts
transitionInvoice({ organizationId, actorUserId, invoiceId, to, reason })
convertQuotationToInvoice({ organizationId, actorUserId, quotationId })
recordPayment({ organizationId, actorUserId, invoiceId, amount, ... })
```

The service should own authorization scope, locking/idempotency, transition validation, mutation, derived totals/status, and audit emission. Route handlers should parse input, call one command, and serialize output. Use database locking or idempotency keys for conversions, milestone billing, email sends, and scheduled invoice creation where retries could duplicate effects.

### P1 — split feature files by responsibility

**Observation.** The proposals, quotations, job orders, payments, invoices and clients pages range from roughly 1,000 to 2,000 lines. The handwritten API client is over 1,100 lines; invoice and quotation route modules are also large.

**Risk.** Review scope grows, state dependencies become implicit, rerenders are harder to reason about, and regression tests focus on utilities rather than user workflows.

**Recommendation.** Organize by feature rather than only by technical layer:

```text
features/invoices/
  api.ts
  model.ts
  workflow.ts
  use-invoice-list.ts
  invoice-list.tsx
  invoice-editor.tsx
  invoice-actions.tsx
  invoice-dialogs.tsx
```

Keep route pages as composition roots. Extract pure mapping/validation functions first, then hooks, then visual sections. On the server, split CSV import/export, query/read model, commands, PDF delivery and route registration. Set a review guideline (not a hard lint rule) that a file over about 500 lines should justify why cohesion is improved by keeping it together.

### P1 — make business states database-valid

**Observation.** TypeScript narrows many statuses and modes, and later migrations add some check constraints, but schema declarations still use generic text for workflow status, role, mode, source type, frequency, activity actor and question status.

**Risk.** Scripts, old deployments or a missed validation path can write states the application cannot render or transition.

**Recommendation.** Mirror every finite domain in the current Drizzle schema using check constraints or PostgreSQL enums, and add migration tests that compare expected constraints with a migrated database. Keep statuses in a shared domain package used by OpenAPI, services and UI labels. Prefer state-specific timestamps/events over inferring history from `updatedAt`.

### P2 — standardize list and filter UX

**Observation.** List pages repeat their own search, filter, bulk selection, dialog and row-action patterns. Sort order persists in session storage, while other filter state is partly URL-based and partly component state.

**Recommendation.** Define one `EntityListPage` pattern:

- URL is the source of truth for page, page size, sort, search and filters;
- changing a filter resets page to 1;
- browser back/forward restores the exact view;
- selection is cleared or reconciled when the result set changes;
- active filters are visible as removable chips with one **Clear all** action;
- loading preserves the table footprint; background refresh does not erase current rows;
- empty search results and empty datasets use different messages and actions;
- destructive bulk actions state the item count and require confirmation;
- tables have a mobile card/list representation or a clearly signposted horizontal scroll region.

Extract list state into one tested hook and reuse the existing query-state and pagination components.

### P2 — clarify the quote-to-cash sequence in the UI

**Observation.** Status rules exist, but users encounter actions across row menus, editor dialogs and separate modules. The dashboard summarizes totals but does not surface a unified work queue.

**Recommendation.** Present each document's lifecycle as a consistent header:

```text
Draft -> Pending approval -> Approved -> Sent -> Confirmed/Paid
```

Show the current state, one primary next action, secondary actions in a menu, blockers inline, and a compact audit timeline. Add dashboard queues for **Needs approval**, **Ready to send**, **Overdue**, **Payment to reconcile**, and **Expiring quotations**. Deep-link each card with filters in the URL. Keep status color supplemental; always display text and icons.

### P2 — strengthen accessibility and feedback

**Recommendation.** During component extraction, enforce these acceptance criteria:

- every icon-only action has an accessible name and tooltip where discovery matters;
- every form error is associated with its field and a submit summary focuses the first invalid field;
- async mutations expose pending text, disable duplicate submission, and announce completion/errors through a polite live region;
- dialogs return focus to their trigger and destructive confirmations name the affected record;
- chart meaning is also available as text/table data;
- touch targets remain at least 44×44 CSS pixels on coarse pointers;
- motion is disabled under `prefers-reduced-motion`;
- light/dark status badges and muted text pass WCAG AA contrast.

Add automated axe checks for login, dashboard, each core list, each editor dialog, and public previews, followed by keyboard-only smoke tests.

### P2 — remove runtime font dependency

**Observation.** The global stylesheet imports Google Fonts at runtime. A blocked third-party request causes layout changes and conflicts with a strict content security policy.

**Recommendation.** Self-host the selected WOFF2 subsets, preload only the primary body face, use `font-display: swap`, and define metrically compatible fallbacks. This also makes the internal application more reliable on restricted corporate networks.

## Recommended delivery plan

### Phase 1 — correctness and product alignment (1–2 iterations)

- Decide company/workspace ownership and document the authorization matrix.
- Reconcile proposal routing, API availability and README claims.
- Add organization/isolation and proposal-capability integration tests.
- Inventory all finite database states and missing constraints.
- Add CI gates for typecheck, unit/integration tests, build, OpenAPI generation diff, and migration idempotency.

### Phase 2 — contract and orchestration (2–4 iterations)

- Move modules into OpenAPI vertical slices.
- Introduce command services for transitions, conversion, payments and recurring generation.
- Add idempotency/concurrency tests around conversion, billing and scheduled work.
- Standardize structured API errors (`code`, `message`, `fieldErrors`, `requestId`).

### Phase 3 — UI consolidation (2–4 iterations)

- Build one reusable list-state hook and entity-list shell.
- Split invoices and quotations first because they share the most lifecycle behaviour.
- Add a workflow header/timeline and dashboard work queues.
- Run responsive, keyboard, contrast and axe checks across the extracted patterns.
- Self-host fonts and establish a small documented design-token layer for state colors, density and focus treatment.

## Suggested success measures

- 100% of tenant-scoped endpoints have cross-workspace denial tests.
- 100% of finite workflow columns have database constraints.
- 100% of supported endpoints appear in OpenAPI; generated-code diff is clean in CI.
- Duplicate conversion/billing/scheduler requests create exactly one result.
- Core list filters survive refresh and browser navigation.
- Zero serious/critical axe violations in core authenticated and public flows.
- Median task time and error rate improve for quote creation, approval, sending, conversion, payment entry and receipt delivery.
