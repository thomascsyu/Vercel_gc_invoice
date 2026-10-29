# Deploying GC-INV on Vercel

One Vercel project serves the whole app:

| Part | How it runs on Vercel |
| --- | --- |
| React SPA (`artifacts/invoiceplane`) | Static files on Vercel's CDN |
| Express API (`artifacts/api-server`) | One Vercel Function at `/api/*` |
| Daily jobs (recurring invoices, quotation reminders) | Vercel Cron → `/api/cron/*` |
| SQL migrations | Run during the build of **production** deploys |
| Uploads (logos, chops, receipts) | Google Cloud Storage (required; the function disk is temporary) |
| Database | Any hosted PostgreSQL (Neon, Supabase, RDS, …) |

`vercel.json` runs `pnpm run vercel-build` (`deploy/vercel/build.mjs`), which
writes `.vercel/output` using Vercel's Build Output API. The existing Docker/Ubuntu
deployment (`Dockerfile`, `deploy/ubuntu`) still works unchanged.

## 1. Before you start

1. **PostgreSQL** reachable from the internet. Use the provider's *pooled*
   connection string (PgBouncer / "pooler" URL), because each function
   instance opens its own small pool. Add `?sslmode=require` if your provider needs SSL.
2. **Google Cloud Storage bucket** for uploads, plus a service account with
   *Storage Object Admin* on that bucket. Download its JSON key.
3. **Google OAuth client** (the one used today for sign-in). You'll add the
   Vercel domain to it in step 4.

## 2. Create the Vercel project

1. In Vercel: **Add New → Project**, import `thomascsyu/Vercel_gc_invoice`.
2. Leave **Root Directory** as the repository root. Framework preset: **Other**.
   Build/Install commands come from `vercel.json`; don't override them.
3. **Settings → General → Node.js Version**: 22.x.

## 3. Environment variables

Set these under **Settings → Environment Variables** (Production, and Preview if you use previews):

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | Pooled Postgres URL |
| `JWT_SECRET` | yes | Random string, 32+ characters (`openssl rand -base64 48`) |
| `SESSION_SECRET` | for Gmail | Random string (signs the Gmail OAuth state) |
| `GOOGLE_OAUTH_CLIENT_ID` | yes | OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | yes | OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | yes | `https://<your-domain>/api/auth/google/callback` |
| `PUBLIC_APP_URL` | yes | `https://<your-domain>` |
| `CRON_SECRET` | yes | Random string. Vercel sends it to the cron endpoints automatically |
| `PUBLIC_OBJECT_SEARCH_PATHS` | yes | `/<bucket>/public` |
| `PRIVATE_OBJECT_DIR` | yes | `/<bucket>/private` |
| `GCS_SERVICE_ACCOUNT_JSON` | yes | Paste the whole service-account JSON key |
| `WORKSPACE_DATA_USER_ID` | optional | Shared workspace owner Google `sub` for all business data |
| `PROPOSALS_ENABLED` | optional | Set `false` to disable staff proposal UI/API (public links still work) |
| `GOOGLE_OAUTH_HOSTED_DOMAIN` | optional | Restrict sign-in to one Workspace domain |
| `GMAIL_OAUTH_REDIRECT_URI` | optional | `https://<your-domain>/api/gmail/oauth/callback` |
| `BUSINESS_TIME_ZONE` | optional | Default `Asia/Hong_Kong`. Vercel doesn't let you set `TZ`, so use this instead |
| `PG_POOL_MAX` | optional | Connections per function instance (default 5 on Vercel) |
| `SKIP_DB_MIGRATIONS` | optional | `1` to skip migrations on a production build |
| `RUN_MIGRATIONS_ON_BUILD` | optional | `1` to also migrate on preview builds (only with a separate preview DB) |

The deployment's own `*.vercel.app` URLs are allowed by CORS automatically.
Add any other front-end origin to `CORS_ALLOWED_ORIGINS`.

## 4. Google OAuth

In Google Cloud Console → **APIs & Services → Credentials** → your OAuth client:

- Authorised JavaScript origin: `https://<your-domain>`
- Authorised redirect URIs: `https://<your-domain>/api/auth/google/callback`
  (and `/api/gmail/oauth/callback` if you connect Gmail)

Google sign-in only works on domains registered here, so preview URLs can't sign in
unless you add them too.

## 5. Deploy and check

1. Deploy. The build log shows `Applying migration …` lines for production deploys.
2. Open `https://<your-domain>/api/healthz`. It should return `{"status":"ok"}`.
3. Open `https://<your-domain>/api/readyz`. It should return `{"status":"ok"}`
   (this checks the database).
4. Sign in, upload the company logo, then redeploy and confirm the logo is still there.
5. **Settings → Cron Jobs** should list two jobs.

## Moving from the Docker server

- Database: `pg_dump` the current database and restore it into the new Postgres.
  The build's migrations are idempotent and safe to run on the restored copy.
- Uploads: copy `/var/lib/gc-inv/uploads/public-objects/*` to
  `gs://<bucket>/public/` and `private-objects/*` to `gs://<bucket>/private/`
  (`gsutil -m cp -r …`).
- Point DNS at Vercel, then update `PUBLIC_APP_URL` and the OAuth redirect URIs.

## Limits to know

- **4.5 MB request body limit** on Vercel Functions. The app accepts larger
  files in some places (proposal documents up to 15 MB, receipts and logos up to
  10–12 MB). On Vercel, anything above 4.5 MB fails with HTTP 413. Compress
  large PDFs or images before uploading.
- **Function timeout**: 60 s (`API_MAX_DURATION` at build time changes it, within your plan's limit).
- **Cron times** are in UTC: recurring invoices at 22:00 UTC (06:00 HKT), quotation
  reminders at 00:00 UTC (08:00 HKT). Edit `crons` in `deploy/vercel/build.mjs` to change them.
- **Rate limits** are counted per function instance, so they're looser than on the
  single Docker server.
- **CSV client import** runs in a single request on Vercel. The async
  progress-polling mode only works on a long-running server.
