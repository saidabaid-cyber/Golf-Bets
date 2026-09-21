# Backup policy

This is a proposed owner-operated policy, not a claim that scheduling or an external service is enabled. No new paid service was connected. Automated code permits localhost, isolated QA, and the separately authorized exact owner project for read-only encrypted backup; see the pinned identities in README. No arbitrary Production source is accepted.

| Component | Frequency | Suggested retention |
|---|---|---|
| Source + all fetched Git refs/tags | Every logical commit; independent mirror daily | Every release plus daily 14 days, weekly 8 weeks, monthly 12 months |
| Database encrypted logical snapshot | Daily; before significant controlled data changes | Daily 14 days, weekly 8 weeks, monthly 12 months |
| Storage bytes + bucket/object metadata | Daily while uploads active; after material upload batches | Same snapshot retention; never assume DB backup includes files |
| Configuration + provider ownership records | Monthly and immediately after relevant changes | 12 monthly snapshots and latest known-working pre-change |
| Release snapshot | Before any future authorized production release | Keep signed release snapshots under the agreed legal retention policy |

Retention is guidance only. Scripts never delete old backups. Legal holds, deletion/consent obligations, backup PII retention and access logs require policy approval before external-user production rollout.

## Daily operator run

1. On a trusted private machine, fetch authorized code refs/tags and check clean worktree.
2. Run `npm run backup:security -- --history` before distributing Git history. Investigate any finding; never print matched values.
3. Explicitly choose the authorized source (`qa`, `local` or `owner`) and inject its dedicated BACKUP_* variables from a password manager. Never mix project credentials/refs. Generate one 32-byte cryptographically random encryption key per chosen rotation policy inside that manager; pass its base64 representation via environment, not shell history. Do not use an application service-role key as the encryption key.
4. Run `npm run backup`. Review every component state; exit 2 needs action.
5. Run `npm run backup:verify -- <snapshot>` using the same key.
6. Copy the complete immutable snapshot, including metadata, to owner-approved independent storage; copy back to another machine and verify there.
7. Record timestamp, commit, snapshot digest, copy location and operator in a private audit log. Do not store decryption keys next to snapshots.
8. Quarterly, restore to a disposable isolated environment and run the recovery checklist. Never use Production as a restore rehearsal.

## Independent storage

Use at least two media, with one encrypted copy off the development machine and outside GitHub/Supabase/Vercel. Local removable disk, owner-controlled NAS or an approved Drive/S3/R2 destination are possible. No provider integration is activated here. After a destination is selected/authorized, copy the whole directory without changing internal paths; verification is provider-independent.

Windows: mode 0600/0700 is not a complete ACL guarantee. Use a private user-only directory on BitLocker/encrypted media; inspect ACLs using `icacls`. Linux/macOS: restrict directory permissions and disk encryption. BACKUP_ROOT must be the default ignored backups directory or outside the repo, never public/ or a served directory.

## RPO / RTO

Suggested RPO: up to 24 hours of synced cloud data with daily backups; unsynced local edits need separate device custody. Proposed RTO: one business day after credentials/software are available. Neither target is measured or guaranteed until a full restore drill passes. DB and object listings are not a cross-service atomic transaction; schedule during an agreed quiet period and verify references after restoration.
