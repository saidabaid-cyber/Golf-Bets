# Storage recovery

## Storage is not a SQL backup

SQL contains bucket/object metadata, not the bytes served by Supabase Storage. A valid database dump with missing scorecard photos/feedback attachments is incomplete. QA metadata observed on 2026-09-21:

| Bucket | Visibility | Max bytes | Allowed types |
|---|---|---:|---|
| scorecard-photos | Private | 8,000,000 | JPEG / PNG / WEBP |
| feedback-private | Private | 2,097,152 | JPEG / PNG / WEBP |
| the-backyard-site | Public auxiliary site | 5,242,880 | HTML / CSS / JS / SVG / PNG / JPEG |

Do not turn the private buckets public on restore. Bucket configuration alone does not restore object policies, owner IDs or attachment lifecycle records.

## Export

Inject BACKUP_SOURCE=qa, exact BACKUP_EXPECTED_REF, BACKUP_STORAGE_URL and a server credential in BACKUP_STORAGE_KEY through the trusted process environment; also provide BACKUP_ENCRYPTION_KEY. No .env autodiscovery or Auth SMTP credential reuse occurs.

```sh
npm run backup:storage
npm run backup:verify -- /private/snapshot
```

The script lists all buckets, traverses folders, pages at 1000 entries, downloads each object's bytes, checks expected size where supplied, and verifies an unchanged pre/post listing. Objects are encrypted into hashed local filenames; their actual bucket/path/content-type/metadata and bucket definitions are in encrypted storage/index.json.enc. Names/PII are not printed. Zero-byte objects are valid. Wrong refs and cross-origin redirects fail closed.

This is a full read/list/download, not a bucket existence check. If anything changes while exporting, create a new snapshot and retry; the failed snapshot remains for investigation. There is no deletion or remote upload. Listing-before/after detects common races but does not supply cross-service atomic consistency; verify DB references afterward.

Current task: bucket metadata readback PASS; real private object export/restore **BLOCKED_EXTERNAL** (dedicated Storage credential + independent encryption-key custody not injected). Automated tests exercise actual encryption/decryption and file writes with a synthetic Storage transport; they are not live Storage recovery.

## Restore to a new authorized target

1. Decrypt a verified snapshot into a new private local directory. Read storage/index.json and the decrypted hashed object files.
2. Provision a separate target project/object store; verify its identity is new and authorized. Never use the source QA/Production project for a restore rehearsal.
3. Recreate each bucket with the recorded id, public flag, allowed MIME and size limit. Do not overwrite an existing conflicting bucket. Review the auxiliary public site separately; do not invoke its old unauthenticated publisher.
4. Upload bytes using the Storage API with the **original bucket/name**, contentType from metadata and upsert:false. Do not merely insert storage.objects rows or assume restored metadata creates files. Preserve cacheControl where documented.
5. Managed Supabase restoration must reconcile original object UUIDs/owner_id and app attachment references with uploaded object metadata. Service-role upload alone can leave incorrect ownership; use the platform-supported restoration process on a disposable target and compare policies/UUIDs before accepting it. Do not directly rewrite managed metadata on live databases.
6. On retry, compare existing object's downloaded SHA-256 to the archived plaintext object before skipping it; conflict means stop for review, never upsert over unknown content.
7. Recreate/reconcile Storage RLS from the schema and custom policies. Verify user A can access only authorized A/shared objects, B cannot read A private attachments, signed URLs expire correctly and cleanup references match DB records.
8. Re-download every restored object, hash against the decrypted file, and compare bucket/object counts and metadata. Repeat app feedback and scorecard attachment views using synthetic identities.

A practical API integration uses the existing @supabase/supabase-js library: storage.createBucket and storage.from(bucket).upload(originalName, bytes, {upsert:false, contentType}). Those are **future target writes**, not executed by backup scripts. Manual review of identity/ownership is necessary before running them. Record a private restoration report and retain source snapshot untouched.

## External object stores

For S3/R2-compatible storage keep original keys/metadata/private ACL equivalents and adapt app signed URLs/upload/cleanup services. Do not expose objects publicly to avoid auth integration. Supabase SDK paths are not transparently compatible with another provider. A complete SQL+Storage restore drill remains pending, not PASS because encrypted files exist.

