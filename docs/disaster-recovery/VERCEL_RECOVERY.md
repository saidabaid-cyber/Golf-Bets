# Vercel / hosting recovery

Read-only project inspection on 2026-09-21: project golf-bets, framework nextjs, Node 24.x, rootDirectory null (repo root), buildCommand/installCommand/outputDirectory null (framework defaults). No settings were changed. Account/team ownership, runtime environment secret values and deployment protection configuration are not included in a Git snapshot.

## Recreate in a new account

1. Recover source, exact commit and frozen pnpm lock; run local quality gate first.
2. In a new authorized Vercel project import the recovered repository. Root: repository root; framework: Next.js; Node: 24.x. Explicit commands may be `pnpm install --frozen-lockfile` and `pnpm run build`; keep Next framework output handling, not static export.
3. Configure the variable names in ENVIRONMENT_VARIABLES, injecting real values through the new account's protected environment UI/password manager. Scope initial deployment to Preview only. Never paste secrets into source or command logs.
4. Review vercel.json: its existing Git rule enables phase2/course-catalog-feedback only. infra/disaster-recovery is not a new app release branch; do not remove release protections just to trigger a deploy.
5. Link the **new** project explicitly when using CLI; do not reuse an old .vercel directory (ignored). Verify project/team before any action.
6. Deploy Preview, verify branch and SHA metadata, then test Auth callbacks, cloud/RLS, catalog, equipment, rounds, offline sync, feedback and optional features.
7. Only after explicit owner cutover authorization, attach/repoint domains. That step was NOT performed here.

## Source configuration

`next.config.ts` sets:
- /sw.js → Cache-Control: public, max-age=0, must-revalidate
- /sw.js → Service-Worker-Allowed: /

No rewrites/redirects, Vercel cron or custom output directory were found. No standalone build was configured. Next API routes require a server; exporting static HTML alone loses backend features.

NEXT_PUBLIC_* values are baked into the client at build time; setting new server values after a build does not rewrite client bundles. Build again with the restored project URL/key. Keep service-role, Resend and AI keys server-only.

## Other Node hosts

A compatible host can run `pnpm install --frozen-lockfile`, `pnpm run build`, then `pnpm run start` behind HTTPS/reverse proxy. Keep .next, public, package/lock and runtime dependencies together. If adopting Next standalone output later, make that a reviewed deployment-only change and copy public/.next/static as required by the local Next deploying docs; it is NOT enabled here.

Plan proxy timeouts/body limits for current uploads and AI routes, writable runtime cache where needed, durable external PostgreSQL/Storage, healthchecks and graceful shutdown. No provider-specific background job guarantees should be inferred from a Next route.

## External custody still needed

Owner export/screenshots (secret values into vault, not docs): project settings, Preview/prod variable names/scopes, integration ownership, protection settings, domains, team billing/access and any log drains configured outside source. Secrets may be non-retrievable; reissue in a new provider account during a real incident, never rotate live credentials as a backup exercise.
