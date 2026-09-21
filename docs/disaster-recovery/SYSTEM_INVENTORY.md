# System inventory

Evidence: repository at initial SHA `dbf30b080c8e76d3e56bab5c311a60e7ac65d897`; read-only QA SQL/management metadata and Vercel project inspection on 2026-09-21. [QA_METADATA_2026-09-21.json](QA_METADATA_2026-09-21.json) contains counts and complete migration identifiers, not user rows or secrets. No Production inspection was performed.

## Runtime and toolchain

| Item | Observed |
|---|---|
| Framework | Next.js App Router 16.3.3 installed/locked; package range ^16.0.0 |
| UI | React / react-dom 19.2.8 installed |
| Node | Local 24.19.0; Vercel project setting 24.x |
| Package manager | pnpm; v11.19.0 available in audit environment; lockfile v9 |
| TypeScript / ESLint | 5.7.2 / 9.39.5 installed |
| Supabase JS / OpenAI SDK | 2.112.4 / 7.8.0 installed |
| DB | QA PostgreSQL 17.6 |
| DB client utilities | pg_dump, pg_restore, psql not installed in this machine's PATH |
| Hosting | Vercel project golf-bets, framework nextjs, repository root; no custom install/build/output setting returned |

No Node engines or packageManager pin was present in the application manifest; restore uses the observed Node 24 runtime and frozen lock. No runtime dependency was added by this task.

## Repository map

- `app/`: Next pages, layout, API routes; backend runs in Next, not in a separate proprietary runtime.
- `components/`, `lib/`: UI and deterministic golf, handicap, betting, account, cloud and provider services.
- `data/`: versioned course imports/evidence, equipment catalogs and supplementary data.
- `public/`: PWA assets, service worker, web imagery and generated public assets.
- `supabase/migrations/`: 30 application SQL migrations.
- `supabase/tests/`, `tests/`: DB contracts, deterministic tests and regression tests.
- `scripts/`: imports, QA runners, rules indexing, PWA assets, and these backup scripts.
- `docs/`: requirements and prior QA reports; reports are not fresh runtime evidence.
- `rules-source/`, `rules-sources/`, `brand-source/`: ignored licensed/private originals, not included in Git.
- `node_modules/`, `.next/`, `.test-dist/`, `.qa-artifacts/`, `.vercel/`, `supabase/.temp/`: ignored installation/build/private artifacts.

## Branches and deployment

Relevant refs: main (protected Production baseline), beta (frozen stable), phase2/full-platform, phase2/course-catalog-feedback, and infra/disaster-recovery. Fetch all refs before independent mirroring; do not merge branches during recovery. Current `vercel.json` enables Git deployment only for phase2/course-catalog-feedback. No GitHub Actions workflow directory was found. No Vercel cron or Next rewrite/redirect configuration was found.

## Database readback

| Schema | Tables | Tables with RLS |
|---|---:|---:|
| public | 104 | 104 |
| auth | 27 | 16 |
| private | 4 | 3 |
| equipment_research | 2 | 2 |
| storage | 8 | 8 |
| realtime | 2 | 0 |
| net | 2 | 0 |
| supabase_functions | 2 | 0 |
| supabase_migrations | 1 | 0 |
| vault | 1 | 0 |

Public schema: 45 functions, 84 triggers, 310 policies. Managed schema RLS counts are not an instruction to change those schemas. Extensions: plpgsql, pg_stat_statements, uuid-ossp, pgcrypto, supabase_vault, pg_net, http, pg_trgm. No pg_cron extension was present. No application scheduling configuration was found; this does not certify that an external scheduler does not exist.

QA has **38 ledger entries vs 30 repository migrations**, including remote-only marketing, legal events, private equipment research and site publishing changes. Dates differ for earlier migrations. Never blindly replay 30 migrations on a restored DB. See SUPABASE_RECOVERY.

## Storage and Edge Functions

- scorecard-photos: private, 8,000,000 bytes max, JPEG/PNG/WEBP.
- feedback-private: private, 2,097,152 bytes max, JPEG/PNG/WEBP.
- the-backyard-site: public, 5,242,880 bytes max; HTML/CSS/JS/SVG/PNG/JPEG. Remote-only auxiliary site content; not a reason to expose the private buckets.
- Remote Edge functions: backyard-site v1 and publish-backyard-static v2, both verify_jwt=false. No supabase/functions directory or Supabase config.toml existed in source.

Read-only source exports are retained as inert `edge-functions/<slug>/index.ts.txt` files; deployment hashes are in QA_METADATA. They are not deployed by Next or automatically restored. **Security risk:** publish-backyard-static is callable without JWT verification and writes site content with service privileges. It was neither invoked nor modified here. Require an authorization review before any redeployment of that auxiliary function.

## Identity and integrations

Supabase Auth owns identities; app UUID ownership derives from the verified session. Email OTP and Google OAuth exist. Apple entry points exist but previous QA considered the provider unavailable; no real Apple sign-in was claimed. Browser PKCE state and session restoration are implemented locally; account mapping and RLS are server/database controls.

Next API routes use Supabase PostgREST/RPC and private Storage; optional AI uses OpenAI or Gemini according to feature flags. Auth SMTP is managed by Supabase; group/feedback notification email is a separate Resend integration. Missing email notification credentials must not invalidate a persisted feedback request.

Course data is an owner-supplied reviewed import, not a live official GHIN/GolfAPI integration. Previous catalogue evidence: 153 clubs / 176 courses / 769 tees / 91 geolocated / 758 complete cards / 11 incomplete. Those are prior data QA counts, NOT a fresh full row backup from this audit. Equipment catalog files and research staging are distinct; neither empty SQL catalog tables nor UI alone prove all data is backed up.

Known domains: app.thebackyard.com.mx, beta.thebackyard.com.mx, thebackyard.com.mx and auth.thebackyard.com.mx (email sender domain). Registrar, authoritative zone, current record values, billing owners and DNS credentials are not available from source. Do not infer them.

## Configuration inventory

Run `node scripts/backup/inventory.mjs` for variable-to-file references and ordered migrations. ENVIRONMENT_VARIABLES.md classifies every discovered application/tool variable. No real environment values are retained in Git. Provider keys, Vault encryption roots, OAuth/SMTP console settings, unsynced client data, ignored licensed originals and Git LFS objects (if subsequently used) need separate recovery custody.
