# Exit paths from providers

No migration is executed in this task. The goal is a credible dependency-aware exit, not a claim that replacing a URL is sufficient.

## Supabase → new Supabase/self-hosted stack

Lowest application-change path: restore on compatible PostgreSQL 17 and Supabase Auth, PostgREST, Storage, Realtime and gateway services. Pin compatible service versions; preserve roles/RLS/RPC/auth UUIDs. Export configuration and storage bytes separately. Validate extensions (Vault/pg_net/http may not exist on another host). Read current official self-hosting documentation before choosing/pinning images; do not rely on an obsolete gateway recipe.

## Supabase → plain PostgreSQL or another backend

Preserve relational schema, constraints, snapshots and UUIDs in PostgreSQL. Next currently uses SupabaseJS Auth/REST/RPC/Storage; those APIs will not magically exist on PostgreSQL. A future migration must provide reviewed adapters for:
- identity/session verification and OAuth/OTP (including auth.uid/role semantics used by policies);
- PostgREST/RPC calls or server-side SQL equivalents with equivalent authorization;
- private object storage, signed URLs, owner metadata and upload constraints;
- subscriptions where used;
- distributed quotas/account lifecycle/social security functions.

Do not replace service-role access with anonymous unrestricted SQL. Never bypass RLS to make portability appear successful. Preserve existing deterministic bet/HCP code. Auth/password/identity migration requires provider compatibility; forced user re-authentication may be necessary.

Acceptance: identical user UUID ownership; two-user RLS negative tests; shared round integrity; catalogs/profiles/equipment cloud readback; round resumption; statistics/reset contract; consent fail-closed; storage private-access tests. No existing history rewrite.

## Vercel → another host

Use the full Next Node server, build-time public env values and server-only secrets. Serve HTTPS with appropriate request/response limits and service-worker headers. Keep database/storage durable outside ephemeral process disk. See VERCEL_RECOVERY. No dependency on Vercel for deterministic calculations, but platform metadata URLs/flags must be explicitly configured for the new non-Vercel environment.

## GitHub → GitLab / Bitbucket / bare Git

Use the verified independent bundle/mirror. Restore refs/history and attach a new empty authorized remote; recreate permissions/protection and deployment hooks manually. Source history does not contain GitHub administrative settings or OAuth credentials.

## Codex/OpenAI → developer/other tooling

Source, docs, tests and scripts are normal text/SQL/Node assets. No Codex account is needed to install/build. OpenAI runtime AI features are separate optional dependencies: leave them disabled if unavailable; do not emulate provider success, fabricate evidence or change deterministic calculations.

## Remaining nontechnical dependencies

Data/image/rules licensing, domain ownership, SMTP/OAuth access, legal retention and signing/Vault key custody cannot be reconstructed from source. Keep them in owner-controlled independent records; absent keys can make encrypted data irrecoverable even with a perfect SQL dump.
