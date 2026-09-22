# Backup retention policy

**Status: `NOT_ACTIVE_PENDING_OWNER_SETUP`**

Retention is implemented as a plan-first process. The activation setting is `BACKUP_RETENTION_APPLY=false`, so the workflow reports candidates but does not trash Drive files.

## Retention tiers

| Tier | Creation rule | Retained verified pairs |
| --- | --- | ---: |
| Daily | Every successful published run | 7 |
| Weekly | Successful run on Sunday in `America/Mexico_City` | 4 |
| Monthly | Successful run on day 1 in `America/Mexico_City` | 6 |

A pair consists of one portable `tar.gz` package and its matching SHA-256 sidecar. The database and Storage payloads inside are encrypted, but the outer archive, source files, and manifest are not claimed to be encrypted. The schedule is `0 9 * * *` in GitHub's UTC cron evaluation; tier classification uses the Mexico City calendar at run time.

## Candidate safety rules

Only unique pairs already marked verified by the publication process are eligible for retention planning. The planner:

- Groups files by tier.
- Sorts verified pairs from newest to oldest.
- Preserves the configured count for each tier.
- Chooses only older pairs when a newer verified pair exists.
- Never selects an unpaired, ambiguous, duplicate, or unverified item.
- Never uses source database or Supabase Storage objects as retention targets.

Failures or ambiguity must stop the run rather than guess.

## Dry-run default

With `BACKUP_RETENTION_APPLY=false`:

- Candidate package/checksum pairs may be listed by safe identifiers or counts.
- No Drive file is trashed or deleted.
- The owner can review the proposed effect after successful publication.

The initial manual run and subsequent scheduled observation must both remain in dry-run mode.

## Future apply decision

Do not change `BACKUP_RETENTION_APPLY` to `true` under this activation guide. Applying retention would move eligible Drive items to trash and is a destructive external change.

Before any future apply, the owner must separately approve:

1. The tier counts and regulatory or business retention requirements.
2. A recent dry-run report and the exact candidate set.
3. Drive recovery and trash-expiration behavior.
4. The service account's delete/trash permissions.
5. Monitoring, incident response, and a rollback window.
6. A controlled first apply with documented evidence and no concurrent backup run.

That approval must be recorded without secret values. A code review or successful backup alone is not approval to apply retention.

## GitHub artifact retention

The workflow's GitHub Actions artifact is a separate short-lived convenience copy with a seven-day retention setting. It does not replace the Drive tiers, does not change Drive retention, and must contain only the portable package and checksum.

## Policy review

Review this policy after recovery exercises, compliance changes, material data growth, Drive ownership changes, or encryption-key rotation. Until the owner explicitly activates and approves the automation, the status remains `NOT_ACTIVE_PENDING_OWNER_SETUP`.
