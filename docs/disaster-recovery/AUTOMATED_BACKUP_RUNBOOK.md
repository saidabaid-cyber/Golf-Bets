# Automated backup owner runbook

**Status: `NOT_ACTIVE_PENDING_OWNER_SETUP`**

This runbook activates and observes the first automated off-site backup. It does not authorize a restore, deployment, migration, database write, source Storage write, Auth change, or applied retention.

## Phase 1: owner preparation

1. Review the workflow and backup scripts in the approved change. Do not run the production workflow from that feature ref.
2. Confirm the pinned source, PostgreSQL, and Storage identifiers correspond to the intended production project without printing credential values.
3. Confirm `BACKUP_PGPASSWORD` is the exact owner Session Pooler password. Do not describe it as dedicated or read-only; the safety controls are the explicit `BEGIN TRANSACTION READ ONLY` preflight and the dump-only database commands.
4. Confirm `BACKUP_STORAGE_KEY` is the intended server-side key. Do not promise that the key itself has a narrow provider scope; confirm instead that the backup code allowlists only bucket listing, object listing, and object download.
5. Generate the backup encryption key through an approved cryptographic process and place an independent recovery copy under separate owner custody.
6. Complete the dedicated Google Drive service-account and root-folder setup.
7. Add the four GitHub Actions secrets and two Actions variables described in the setup guide.
8. Confirm `BACKUP_RETENTION_APPLY=false`.
9. Confirm the cron in the reviewed workflow is `0 9 * * *` and keep the workflow disabled, or complete setup outside its run window, so the schedule cannot start before the controlled manual test.
10. Confirm only trusted repository administrators can change Repository secrets, Repository variables, or dispatch Actions. The current workflow does not declare a protected GitHub Environment.
11. Merge the approved change into `main` only after the external setup is complete, then record the resulting `main` Git SHA.

If any item is incomplete, stop. Keep the status `NOT_ACTIVE_PENDING_OWNER_SETUP` and do not start the workflow.

## Phase 2: controlled `workflow_dispatch`

1. Choose a maintenance window in which the owner can monitor the complete run.
2. Confirm the approved merge is present in `main` and recheck the recorded `main` Git SHA.
3. Open **Actions** and select **The Backyard Automated Offsite Backup**.
4. If the workflow was disabled, click **Enable workflow** only now that setup is complete.
5. Click **Run workflow** and, in **Use workflow from**, select exactly `main`.
6. Recheck the `main` selection and click the green **Run workflow** button once. The job blocks every ref other than `refs/heads/main`; do not use a feature branch and do not start a second run while it is active.
7. Watch safe stage names and error codes. Never enable shell tracing, environment dumps, verbose HTTP authentication, or commands that echo secrets.
8. If the run fails, preserve only secret-free logs and follow the failure procedure below.

## Phase 3: acceptance checks

Accept the manual run only if every item is confirmed:

- Source, Database, Storage, Encryption, and Verification are `PASS`.
- `recoveryComplete` is `true`.
- The reported Git SHA is the reviewed SHA.
- PostgreSQL passed its explicit read-only transaction preflight.
- File, Storage bucket, and Storage object counts come from verified manifest output.
- The portable package and SHA-256 sidecar form a valid unique pair. Only the database and Storage payloads inside are encrypted; the outer archive, source files, and manifest are not claimed to be encrypted.
- The pair exists below the dedicated Drive `daily` hierarchy and remote verification passed.
- Any weekly or monthly copy agrees with the Mexico City calendar rule.
- The GitHub artifact contains only the package and checksum and has the intended seven-day retention.
- Retention is reported as dry-run and no Drive item was trashed.
- Logs, annotations, summaries, filenames, and artifacts reveal no secret values.
- No application database, source Storage, Auth, migration, restore, merge, or deployment write occurred.

Do not download and decrypt backup contents during this activation run. Restore validation requires a separate authorized exercise in an isolated target.

## Phase 4: scheduled observation

1. Leave `BACKUP_RETENTION_APPLY=false`.
2. Allow the next `0 9 * * *` scheduled run only after the controlled manual run is accepted.
3. Review the same gates, destination pair, artifact, retention dry-run, and secret hygiene.
4. Account for GitHub schedule delay; evaluate weekly/monthly classification from the recorded Mexico City date, not an assumed local start time.
5. Record the run URL, reviewed Git SHA, timestamps, safe result codes, counts, and owner approval. Do not record credentials or tokens.

Only after both runs are accepted may the owner propose changing the operational status in a separate reviewed change. This runbook does not itself activate retention apply.

## Failure procedure

1. Stop further manual dispatches and disable the schedule if another run could start before diagnosis.
2. Classify the failure using the safe workflow error code and stage; do not request raw secret output.
3. If exposure is suspected, revoke the affected provider credential first, replace the GitHub secret, and remove exposed logs or artifacts through the provider's incident process.
4. If the PostgreSQL read-only preflight fails, abort without running the dump.
5. If any verification or publication gate fails, treat the package as unpublished and unusable until a new complete run passes.
6. If Drive verification fails after a partial upload, do not overwrite or manually relabel the files. Preserve safe identifiers for owner-led cleanup.
7. If retention reports an unexpected candidate, keep dry-run enabled and review tier metadata and duplicate names.
8. Rerun only after the cause is corrected and the owner re-approves `main` and its exact SHA.

## Emergency suspension

To stop future backup writes, disable the workflow, restrict repository Actions administration and dispatch permissions, remove the service account from the Drive root, and revoke provider credentials as appropriate. The current workflow does not declare a GitHub Environment. Removing a GitHub secret alone does not revoke the credential at its source.

Existing packages, their encrypted database/Storage payloads, and the independent encryption-key recovery copy must remain under owner custody until a separately approved retention or recovery decision is made.
