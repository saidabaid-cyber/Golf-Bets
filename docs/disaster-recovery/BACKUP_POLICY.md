# Backup policy

This policy combines the recovered provider-independent plan with the current automated workflow. The workflow is scheduled on the default branch and deliberately pins the authorized owner Supabase source while enforcing read-only database/storage behavior; it is not limited to QA/localhost. One scheduled backup success is evidenced, while destructive retention and a full restore drill remain unapproved.

| Component | Frequency | Suggested retention |
|---|---|---|
| Source + all fetched Git refs/tags | Every logical commit; independent mirror daily | Every release plus daily 14 days, weekly 8 weeks, monthly 12 months |
| Database encrypted logical snapshot | Daily; before significant controlled data changes | Daily 14 days, weekly 8 weeks, monthly 12 months |
| Storage bytes + bucket/object metadata | Daily while uploads active; after material upload batches | Same snapshot retention; never assume DB backup includes files |
| Configuration + provider ownership records | Monthly and immediately after relevant changes | 12 monthly snapshots and latest known-working pre-change |
| Release snapshot | Before any future authorized production release | Keep signed release snapshots under the agreed legal retention policy |

Retention is guidance only. The current setting is `BACKUP_RETENTION_APPLY=false`, so runs plan candidates without trashing them. The Drive implementation can trash a verified package/checksum pair when that flag is deliberately changed to `true`; that destructive path is not approved by this policy. Legal holds, deletion/consent obligations, backup PII retention and access logs require policy approval before any apply.

## Daily operator run

1. On a trusted private machine, fetch authorized code refs/tags and check clean worktree.
2. Run `npm run backup:security -- --history` before distributing Git history. Investigate any finding; never print matched values.
3. For a local provider-independent exercise, inject only the explicitly authorized `BACKUP_*` source values from a password manager. The current Actions workflow pins its owner-approved source and must not be repointed to QA, Preview, or another live project through this runbook. Generate one 32-byte cryptographically random encryption key per chosen rotation policy inside that manager; pass its base64 representation via environment, not shell history. Do not use an application service-role key as the encryption key.
4. Run `npm run backup`. Review every component state; exit 2 needs action.
5. Run `npm run backup:verify -- <snapshot>` using the same key.
6. Copy the complete immutable snapshot, including metadata, to owner-approved independent storage; copy back to another machine and verify there.
7. Record timestamp, commit, snapshot digest, copy location and operator in a private audit log. Do not store decryption keys next to snapshots.
8. Quarterly, restore to a disposable isolated environment and run the recovery checklist. Never use Production as a restore rehearsal.

## Independent storage

Use at least two media, with one encrypted copy off the development machine and outside GitHub/Supabase/Vercel. Local removable disk, owner-controlled NAS or an approved Drive/S3/R2 destination are possible. Google Drive publication is implemented and one scheduled run was observed, but that does not prove independent key custody or a successful restore. For any additional destination, copy the whole directory without changing internal paths; verification remains provider-independent.

Windows: mode 0600/0700 is not a complete ACL guarantee. Use a private user-only directory on BitLocker/encrypted media; inspect ACLs using `icacls`. Linux/macOS: restrict directory permissions and disk encryption. BACKUP_ROOT must be the default ignored backups directory or outside the repo, never public/ or a served directory.

## RPO / RTO

Suggested RPO: up to 24 hours of synced cloud data with daily backups; unsynced local edits need separate device custody. Proposed RTO: one business day after credentials/software are available. Neither target is measured or guaranteed until a full restore drill passes. DB and object listings are not a cross-service atomic transaction; schedule during an agreed quiet period and verify references after restoration.
