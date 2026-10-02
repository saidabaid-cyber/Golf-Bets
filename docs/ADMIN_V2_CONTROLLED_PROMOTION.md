# Admin V2: preparation for controlled DEV promotion

This phase changes local source only. No migration, role assignment, environment
variable, Auth setting, Preview, deployment or alias is changed remotely.

Working branch: `promotion/admin-v2-to-dev`. Base integration commit:
`cc13c108c820ff5c61e5d000f6cd93ff551869ec`. DEV remains at
`1b53cf2e200d5ae6bd95d8f405b3dbe05004ede8`.

## Ownership and catalog boundary

The existing permissive RLS policies remain installed. Their private ownership
path requires `USER_MANUAL`, `PRIVATE`, `created_by = auth.uid()` and the existing
owned parent checks. New restrictive policies allow that path rather than
requiring SUPER_ADMIN for every base-row write. They do not grant any new
personal permission. Active-account checks still apply.

Players cannot edit another owner's course, convert their course to PUBLIC,
transfer ownership, attach it to someone else's private club, write a global
catalog row or use Admin APIs. Tees, holes, yardages and geometry keep the
existing owned-private-course checks. Direct deletes remain prohibited.

Global Admin mutations continue through reviewed/versioned publication and the
audited lifecycle RPC. Global revisions and lifecycle/configuration operations
reject player-owned private courses, including when attempted by SUPER_ADMIN.
The Admin catalog list excludes manual personal courses; player lists and
personal write providers are unchanged.

Offline Postgres tests reproduce the rejected guard's denial, apply the new
guard, demonstrate successful private create/edit, and still deny global writes.
Additional tests verify global create/edit publication, independent player
read-back, audit, archive, unused deletion and reference-protected deletion.
No remote test records or account lifecycle operations are executed.

## Environment binding

Same runtime source supports both environments:

| Setting | QA | Future DEV promotion |
| --- | --- | --- |
| `ADMIN_MODE_V2_ENABLED` | `true` | Explicit `true` after gates |
| `ADMIN_MODE_TARGET_ENV` | `qa` (default for existing Preview) | `dev` |
| `ADMIN_MODE_DB_REF` | Isolated project ref | Existing DEV project ref |
| `ADMIN_MODE_ISOLATED_DB_REF` | Existing alias supported | Prefer `ADMIN_MODE_DB_REF` |
| `PREVIEW_DB_REF` | Existing environment setting | Must equal DEV target ref |
| `NEXT_PUBLIC_SUPABASE_URL` | Exact isolated project HTTPS URL | Exact DEV project HTTPS URL |
| Git branch / Vercel environment | feature Admin V2 / Preview | promotion Admin V2 or integration / Preview |

Production, main, beta, invalid URLs, mismatched projects and missing explicit
promotion binding fail closed. The promotion branch cannot silently fall back
to DEV when Admin binding is absent. Public build binding contains only project
identifiers, target label and exact deployment/branch origins. It contains no
service key. Existing QA configuration remains compatible; no variable changes
are performed in this phase.

## Selected migrations only

`supabase/admin-v2-promotion-manifest.json` is the explicit ordered allowlist.
It contains four missing Admin foundations, the compatible authorization
replacement and six portable replacements. DO NOT use an unfiltered `db push`:
historical remote ledger versions differ from repository filenames, and the
repository retains immutable rejected/QA-only originals.

| Original migration | Purpose | QA coupling | Final replacement / fix | DEV compatible | Automatic destructive action |
| --- | --- | --- | --- | --- | --- |
| `20261001223854_admin_ux_catalog_lifecycle.sql` | Usage checks, archive and unused delete | Install and RPC project binding | `20261002035555`: remove binding; retain scope/audit/references; reject personal courses | Local SQL PASS | None |
| `20261001225620_admin_ux_bet_variants.sql` | Existing-engine configuration versions | Install and RPC project binding | `20261002035557`: remove binding; retain validation/hash/engine restrictions | Local SQL PASS | None |
| `20261001231103_admin_ux_operations_guards.sql` | Lifecycle, immutable engine, competition status | Install and lifecycle project binding | `20261002035559`: remove binding; preserve controls | Local SQL PASS | None |
| `20261001231702_admin_ux_request_record_link.sql` | Approved requests to reviewed records | Install binding and QA request helper | `20261002035601`: portable request environment; preserve old Advanced IN_REVIEW publication flow | Local SQL PASS | None |
| `20261001232711_admin_ux_snapshot_reference_guard.sql` | All JSON snapshots protect history | Install project binding | `20261002035602`: remove binding; retain FK/snapshot checks | Local SQL PASS | None |

All selected files install schema/functions/policies/triggers only. They contain
no project-specific QA identifier, users, memberships, catalog fixtures or data
copy. Delete functions are installed as existing approved operations; they are
not invoked by migration installation. No account cleanup/reconciliation/purge
is included. Existing historical originals remain outside the apply allowlist.

The request replacement adds only private operator configuration. With no row,
the queue/review/link flow uses PRODUCTION requests. QA may be explicitly
configured by its operator later. TEST and SYNTHETIC are excluded in either
environment. Config changes require service-role privileges and are audited.
The migration seeds no configuration row. Replacements also install over the
existing QA structure without resetting its records, as tested offline.

Changes are additive or replace controls/functions with compatible definitions;
no existing domain table, stable ID or historical payload is dropped. The old
DEV code keeps its ownership path, reviewed catalog APIs and Advanced flow.

## Backup gate — still closed

DEV is a Supabase development branch. Scheduled/PITR availability for the parent
must not be presented as recoverability of this branch. Read the actual branch
backup information at:

https://supabase.com/dashboard/project/bymeopxkxapfizeeqeyb/database/backups/scheduled

1. Sign in with the existing authorized dashboard account and select the actual
   DEV branch/project; do not select its Production parent as a substitute.
2. Record scheduled backup/PITR availability, latest completed timestamp,
   status, retention and available recovery target. View only; do not restore.
3. If no branch backup is recoverable, obtain the branch's exact direct/session
   connection through secure operator configuration, make an additional logical
   backup, verify its encrypted manifest/checksums and restore into an authorized
   disposable target before accepting this gate. Do not send a password in chat.

Current dashboard access requires human sign-in. No current backup timestamp,
successful branch snapshot, PITR status or verified restore is claimed. The old
workflow artifact and pending restore drill in disaster-recovery docs are not a
current DEV backup. Local `pg_dump`/`psql` and branch DB credentials are not
available, so no logical backup was attempted with guessed credentials.

The existing backup tools support an explicitly allowlisted DEV direct URL,
read-only preflight, encrypted database/schema output and manifest verification.
After secure credentials/tools are available, the prepared procedure is
`node scripts/backup/backup.mjs --only=database`, then `--only=schema`, followed
by the documented manifest/checksum verification and isolated restore drill.
Use `BACKUP_SOURCE=qa` (the legacy tool label for the DEV branch) and
`BACKUP_EXPECTED_REF=bymeopxkxapfizeeqeyb`; never use the Production owner target.
No backup or restore command is run in this phase.

## Roles after the DB gate

Read-only evidence confirms the existing owner already has active persisted
GLOBAL SUPER_ADMIN. Preserve this membership; do not bootstrap or replace it.
Said exists as a real DEV user and currently has no ADMIN membership. No role is
assigned in this phase.

After backup, controlled apply and fresh role verification, an authenticated
SUPER_ADMIN can call the existing audited `admin_change_role_v2` with the
verified user UUID, expected PLAYER, desired ADMIN, reason and fresh operation
UUID. Read-back and audit must pass; revocation uses the same RPC with expected
ADMIN and desired PLAYER. Identity lookup is separate from authorization: no
permanent email rule or SQL account impersonation is used.

## Vercel 403 and next step

The local token's earlier 403 is respected. Read-only deployment connector and
health evidence identify the frozen deployment/alias/SHA, sufficient for this
preparation phase. No permission expansion or bypass is needed now. Revalidate
authorized deployment/environment access in the future promotion phase before
creating a DEV-connected Preview or moving an alias.

Until backup evidence passes: `PENDING_BACKUP_CONFIRMATION`. Even after all
gates pass, report readiness only; this phase does not authorize DB apply.
Keep the isolated Admin QA project active. No merge or promotion.
