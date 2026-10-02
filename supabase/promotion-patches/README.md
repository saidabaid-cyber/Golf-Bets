# Catalog deletion compatibility — prepared, not applied

Target: the DEV database already verified by the controlled promotion, `bymeopxkxapfizeeqeyb`.

The 11 approved migrations are already installed. This follow-up SQL is outside that approved ledger and requires explicit controlled-apply authorization. It must not be applied automatically to DEV or QA.

## Reproduction

The disposable course `course-c5907692-e719-4e31-bd8e-4900f4f09d11` was created and published through the Preview, edited by ADMIN, and deleted through the unused-record operation. The base row disappeared and `DELETE_CATALOG` audit 601 was recorded. The new Preview returned zero search results, but the frozen DEV API still returned the course through its PUBLISHED revision. Attempting to archive that residual revision through Advanced Admin was rejected by the permanently-retired-record guard.

## Minimal prepared correction

`catalog-delete-publication-filter.sql` keeps the public projection signature and grants intact. It excludes a PUBLISHED revision when its catalog entity is DELETED. Historical SUPERSEDED/ARCHIVED revisions remain available. This also protects the frozen reader during rollback without deploying new code.

The retired-record guard additionally permits only a transition to ARCHIVED with otherwise identical record contents (apart from the normal updated timestamp), and only for an actor with the existing ARCHIVE permission. Inserts, payload edits and republishing remain rejected. Existing publication validation, RLS and audit triggers continue to apply.

Installation performs no data changes, deletion, anonymization, cleanup or role assignments. It changes two function definitions only. No Auth, SMTP, secrets, project configuration or aliases change.

## Verification

The PGlite regression exercises the real promotion migrations, roles and publication RPCs. It reproduces the stale published result before the correction and verifies zero active results afterward, historical read access, audited status-only archival, denied resurrection, denied metadata editing, and preserved PLAYER private-course ownership.

The Supabase CLI migration-file command was blocked by Windows Application Control. The patch remains an explicitly prepared SQL artifact instead of an invented migration-ledger version. A controlled apply must register the actual server-assigned version and save the applied SQL under that verified version afterward.

After authorization: apply this patch alone, verify the new ledger row and DB/API/Auth health, archive only the disposable course's residual revisions through the owner's real SUPER_ADMIN session, recheck the frozen DEV search, and continue the Preview gates. Do not move the DEV alias.
