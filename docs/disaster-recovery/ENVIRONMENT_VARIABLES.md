# Environment variables

Inventory extracted from tracked app/lib/scripts source plus dedicated backup variables on 2026-09-21. `.env.example` contains **53 names and only empty assignments**. It is a name checklist, not a deploy-ready configuration. No secret values were read into this document.

Do not blindly load empty framework-managed values (NODE_ENV, VERCEL*); allow the platform to supply them. Set needed application variables through protected environment configuration, not repository files. Local private env files are ignored. Flags with security gates require explicit operator decisions; copying blank values does not enable those features.

One public Supabase key alias and one server admin alias suffice; do not accidentally configure aliases from different projects. Public URL/key are compiled into browser bundles. Server/backup keys must never be prefixed NEXT_PUBLIC_. Google/Apple client secrets and SMTP passwords live in Supabase/provider configuration, not imaginary Next app variables.

| Variable | Generated/owned by | Exposure | Required for | Configure at | Purpose / missing behavior |
|---|---|---|---|---|---|
| `ACCOUNT_LIFECYCLE_ENABLED` | Operator | Server config | Lifecycle only | Next runtime; NEXT_PUBLIC also at build | Explicit enable plus QA isolation required; absent disables lifecycle operations. |
| `AUTH_SOCIAL_ENABLED` | Operator | Server config | Auth/social cloud | Next runtime; NEXT_PUBLIC also at build | Default enabled in feature-flags; disabling removes cloud social availability. |
| `BACKUP_DECRYPT_ACK` | Recovery operator | Tooling acknowledgment | Decrypt only | Backup process environment | Must explicitly acknowledge PRIVATE_LOCAL_DIRECTORY; output path must be new; no DB writes occur. |
| `BACKUP_ENCRYPTION_KEY` | Owner password manager | SECRET offline custody | DB/Storage and decrypt yes | Backup process environment | Base64 of 32 random bytes; never printed or placed in snapshot/source. Loss prevents decryption. |
| `BACKUP_EXPECTED_REF` | Backup operator | Public identifier | QA backup yes | Backup process environment | Exact isolated QA ref required before DB/Storage network operations. |
| `BACKUP_PGDATABASE` | DB operator | Private connection metadata | Optional | Backup process environment | Defaults to postgres. Use the actual isolated target database. |
| `BACKUP_PGHOST` | Supabase Connect panel / local operator | Private connection metadata | Database yes | Backup process environment | Direct QA hostname or approved session pooler; unrelated/shared hosts rejected. |
| `BACKUP_PGPASSWORD` | Owner vault / Supabase DB settings | SECRET process only | Database yes | Backup process environment | Injected as child PGPASSWORD, not URL/argv/logs; missing blocks DB only. |
| `BACKUP_PGPORT` | Supabase Connect panel / local operator | Tooling config | Optional | Backup process environment | Defaults to direct/session 5432; transaction pooler 6543 rejected. |
| `BACKUP_PGSSLROOTCERT` | DB operator | Certificate file path | Optional | Backup process environment | Defaults to system trust with verify-full for QA; use verified CA bundle if required, not TLS disable. |
| `BACKUP_PGUSER` | Supabase Connect panel / local operator | Private connection metadata | Database yes | Backup process environment | Direct postgres user or session pooler postgres.<expected-ref>; mismatch rejected. |
| `BACKUP_ROOT` | Backup operator | Private local path | Optional | Backup process environment | Default ignored backups directory; outside repo allowed, never served app directory. |
| `BACKUP_SOURCE` | Backup operator | Tooling config | DB/Storage yes | Backup process environment | Only qa or local accepted; local applies to PostgreSQL only. No Production source permitted. |
| `BACKUP_STORAGE_KEY` | Supabase API settings / owner vault | SECRET process only | Storage yes | Backup process environment | Dedicated env binding of an authorized server credential for read/list; never infer it from app .env. |
| `BACKUP_STORAGE_URL` | Supabase API settings | Public identifier | Storage yes | Backup process environment | Exact QA HTTPS origin only; cross-origin requests/redirects rejected. |
| `BACKYARD_AI_CONSENT_PREVIEW_SUPABASE_URL` | Supabase/operator | Server public identifier | AI in Preview | Next runtime; NEXT_PUBLIC also at build | Exact consent DB binding; absent/mismatch must not authorize AI. |
| `BACKYARD_AI_ENABLED` | Operator | Server config | AI only | Next runtime; NEXT_PUBLIC also at build | Explicit opt-in; absent disables provider setup/vision. |
| `CATALOG_QA_FIXTURE` | QA operator | Private tooling path | QA script only | Operator/QA process only | Fixture input for catalog runner; missing prevents that automated scenario. |
| `CHROME_PATH` | QA operator | Tooling path | Browser QA only | Operator/QA process only | Chrome executable override; missing uses runner discovery/default if supported. |
| `CLOUD_ENABLED` | Operator | Server config | Cloud | Next runtime; NEXT_PUBLIC also at build | Default enabled; absent credentials still prevent cloud access. |
| `EQUIPMENT_CLOUD_ENABLED` | Operator | Server config | Equipment cloud | Next runtime; NEXT_PUBLIC also at build | Explicit enable after migrations/RLS; absent leaves cloud equipment disabled. |
| `FEEDBACK_FROM_EMAIL` | Verified Resend domain | Server sender address | Notification only | Next runtime; NEXT_PUBLIC also at build | Feedback notification sender; may fall back to GROUP_INVITES_FROM_EMAIL; DB receipt independent. |
| `FEEDBACK_RESEND_API_KEY` | Resend | SECRET server | Notification only | Next runtime; NEXT_PUBLIC also at build | Dedicated feedback sender credential; may fall back to group key; absence must not undo DB request. |
| `GEMINI_API_KEY` | Google AI | SECRET server | Gemini rules only | Next runtime; NEXT_PUBLIC also at build | Missing selected-provider key disables Gemini calls. |
| `GEMINI_RULES_MODEL` | Google AI/operator | Server config | Optional override | Next runtime; NEXT_PUBLIC also at build | Model selection; code supplies default, not a credential. |
| `GROUP_INVITES_APP_URL` | Operator | Server public URL | Optional | Next runtime; NEXT_PUBLIC also at build | Stable invitation origin override; missing uses environment fallback; verify allowlisted target. |
| `GROUP_INVITES_FROM_EMAIL` | Verified Resend domain | Server sender address | Group email only | Next runtime; NEXT_PUBLIC also at build | Without verified sender external-email invitations cannot be claimed sent. |
| `GROUP_INVITES_RESEND_API_KEY` | Resend | SECRET server | Group email only | Next runtime; NEXT_PUBLIC also at build | Missing disables email invitations, not internal Backyard invitations. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase API settings | PUBLIC browser | One public key alias | Next runtime; NEXT_PUBLIC also at build | Legacy public key; use this OR publishable alias with correct URL. It is not an admin key; RLS still required. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase API settings | PUBLIC browser | One public key alias | Next runtime; NEXT_PUBLIC also at build | Modern public-key alias preferred by client when set; absent falls back to anon. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API settings | PUBLIC browser | Cloud/auth yes | Next runtime; NEXT_PUBLIC also at build | Project endpoint; absent disables cloud/auth. Rebuild Next when changed. |
| `NODE_ENV` | Node/framework | Automatic runtime config | Framework managed | Next runtime; NEXT_PUBLIC also at build | Do not copy an empty override into deployed environment; Next sets development/production appropriately. |
| `OPENAI_API_KEY` | OpenAI | SECRET server | OpenAI features only | Next runtime; NEXT_PUBLIC also at build | Missing disables relevant AI/indexing; never required for deterministic golf calculations. |
| `OPENAI_BACKYARD_MODEL` | OpenAI/operator | Server config | Optional override | Next runtime; NEXT_PUBLIC also at build | Round-setup model; keep approved model/default. |
| `OPENAI_RULES_MODEL` | OpenAI/operator | Server config | Optional override | Next runtime; NEXT_PUBLIC also at build | Rules model; keep approved default and evidence retrieval. |
| `OPENAI_RULES_VECTOR_STORE_ID` | OpenAI | Private tooling identifier | Legacy indexing only | Operator/QA process only | External vector-store identifier used by index script; not a runtime rules-readiness dependency. |
| `OPENAI_SCORECARD_MODEL` | OpenAI/operator | Server config | Optional override | Next runtime; NEXT_PUBLIC also at build | Scorecard image model; absent uses code default when feature enabled. |
| `POLLA_LIVE_ENABLED` | Operator | Server config | Not active release | Next runtime; NEXT_PUBLIC also at build | Code release lock is false; setting this alone cannot enable Polla. |
| `PREVIEW_DB_REF` | Supabase/operator | Server public identifier | Sensitive Preview operations | Next runtime; NEXT_PUBLIC also at build | Must match isolated project; missing/mismatch fails closed. |
| `PREVIEW_QA_ACCESS_URL` | QA operator | PRIVATE tooling URL | QA only | Operator/QA process only | Access URL can carry deployment access material; keep out of logs/source. |
| `PREVIEW_QA_URL` | QA operator | Public tooling URL | QA only | Operator/QA process only | Exact immutable authorized Preview to exercise, not a production URL. |
| `QA_CONFIRM_ISOLATED_PREVIEW` | QA operator | Tooling public identifier | Mutating QA scripts | Operator/QA process only | Explicit expected QA ref; never override to Production. Backup script has separate guard. |
| `RULES_AI_ENABLED` | Operator | Server config | Rules AI only | Next runtime; NEXT_PUBLIC also at build | Explicit feature availability; do not enable on restore without authority. |
| `RULES_AI_PROVIDER` | Operator | Server config | Optional selection | Next runtime; NEXT_PUBLIC also at build | Selects supported rules provider; default OpenAI path, not a promise of authorization. |
| `SOCIAL_ACTIVITY_ENABLED` | Operator | Server config | Social activity | Next runtime; NEXT_PUBLIC also at build | Explicit activation; absent disables activity endpoints. |
| `SOCIAL_PREVIEW_DB_REF` | Supabase/operator | Server public identifier | Social Preview | Next runtime; NEXT_PUBLIC also at build | Additional isolated-project binding; absent/mismatch fails closed. |
| `SUPABASE_SECRET_KEY` | Supabase API settings | SECRET server | One admin alias | Next runtime; NEXT_PUBLIC also at build | Modern server key alias; used by admin server routes; never NEXT_PUBLIC. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API settings | SECRET server | One admin alias | Next runtime; NEXT_PUBLIC also at build | Legacy server key; modern alias preferred. Missing both disables privileged server operations. |
| `VERCEL` | Vercel | Automatic server metadata | Vercel-managed | Next runtime; NEXT_PUBLIC also at build | Platform detection; do not pretend non-Vercel hosting is Vercel. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel deployment protection | SECRET tooling | Protected Preview automation | Operator/QA process only | Missing may prevent automated Preview access; never disable protection to bypass it. |
| `VERCEL_BRANCH_URL` | Vercel | Automatic public hostname | Optional metadata | Next runtime; NEXT_PUBLIC also at build | Branch-origin fallback in link construction; review stale aliases on new host. |
| `VERCEL_ENV` | Vercel | Automatic server metadata | Environment guards | Next runtime; NEXT_PUBLIC also at build | Runtime target detection; configure a reviewed safe adapter on alternative hosting, do not bypass guards. |
| `VERCEL_GIT_COMMIT_SHA` | Vercel | Automatic public identifier | Build provenance | Next runtime; NEXT_PUBLIC also at build | Missing leaves build provenance unavailable; record commit by deployment metadata. |

## Backup-specific execution

Install PostgreSQL client utilities compatible with QA PostgreSQL 17 (pg_dump, pg_restore, pg_dumpall, psql). BACKUP_* values are inherited by the Node process; scripts do not source any application env file. Passwords are supplied only via process environment and never arguments. QA connection host/ref/user must match the hard-coded isolated allowlist. Database session has default_transaction_read_only and TLS hostname verification.

Keep the 32-byte encryption key in an independent password manager accessible without the failed providers. Do not put it in .env.example, docs, manifests or a command pasted into chat. For a restore, retrieve the key into the current process and run:

```sh
node scripts/backup/decrypt-backup.mjs /private/snapshot /private/new-restore-staging
```

The explicit BACKUP_DECRYPT_ACK is required. The output directory must not already exist. Decryption creates sensitive plaintext locally, not remote mutations. Protect permissions and do not upload the staging directory.

## External configuration not representable as these app variables

Export OAuth client registrations, authorized redirect URLs, Auth email templates/SMTP/signup policies, JWT signing/recovery strategy, Vault/column-encryption keys, Vercel scopes/protection, DNS zone, provider verification records and billing ownership to protected custody. CLI tokens for Supabase/Vercel/Git are tool authentication, not application requirements; use credential helpers/secret injection and their official setup instructions. Do not expose tokens while collecting metadata.

Automated inventory command: `node scripts/backup/inventory.mjs`. It reports names and filenames only. Dynamic future configuration must be reviewed when added; the regression test ensures every currently detected name remains represented.

