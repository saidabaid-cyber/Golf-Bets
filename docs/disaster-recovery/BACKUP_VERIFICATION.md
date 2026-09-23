# Backup verification

**Status: `NOT_ACTIVE_PENDING_OWNER_SETUP`**

Verification is a publication gate, not proof that a disaster restore has succeeded. A restore exercise is a separate, explicitly authorized operation.

## Required publication result

An automated package may be published only when all of these conditions are true:

- `Source: PASS`
- `Database: PASS`
- `Storage: PASS`
- `Encryption: PASS`
- `Verification: PASS`
- `recoveryComplete: true`
- The recorded Git SHA matches the checked-out source.

Any missing artifact, count mismatch, checksum mismatch, failed encryption check, dirty or unexpected source state, or unsafe configuration must stop publication.

## Read-only database preflight

Before the database dump, the backup opens an explicit read-only transaction and checks its state:

```sql
BEGIN TRANSACTION READ ONLY;
SHOW transaction_read_only;
ROLLBACK;
```

The reported setting must be `on`. The preflight does not depend on `PGOPTIONS` or `default_transaction_read_only`. It confirms that the exact owner Session Pooler connection can enter an explicit read-only transaction; it does not make the password globally read-only or carry that transaction into separate processes. The following database operations are dump-only commands.

## What each gate means

| Gate | Meaning |
| --- | --- |
| Source | The expected source ref and Git SHA were recorded, required source files were captured, and the source state met the clean-state rules. |
| Database | The schema inventory, encrypted dump, metadata, and expected database flags are internally consistent. |
| Storage | Bucket and object inventories match the encrypted downloaded objects and their metadata. Source Storage was only listed and downloaded. |
| Encryption | Database and Storage payloads use the expected authenticated-encryption envelope. The outer package, source files, and manifest are not claimed to be encrypted. |
| Verification | The snapshot manifest, paths, sizes, counts, and checksums are internally consistent. |
| `recoveryComplete` | All artifacts required by the verifier for a complete recovery set are present and valid. It does not mean that a restore was executed. |

Files verified, Storage bucket counts, and Storage object counts must come from the generated manifest and verifier output. Do not estimate them from console lines or directory listings.

## Portable package checks

The portable package is accepted only when:

1. The archive contains the verified snapshot and its manifest.
2. Archive members use safe relative paths.
3. The SHA-256 sidecar matches the package bytes.
4. Package and sidecar names form one unique pair.
5. Neither file contains plaintext credentials.

The SHA-256 authenticates the package bytes but does not encrypt them. The `tar.gz` can expose source and manifest metadata; only the database and Storage payloads inside use the backup encryption envelope.

## Google Drive verification

Every daily upload verifies the remote file size and checksum sidecar before it is marked verified. Weekly promotion also downloads the package and recomputes its SHA-256. Monthly promotion verifies the copied pair and metadata but does not perform the weekly full-package download.

The Drive hierarchy and retention logic may act only on unique, verified package/checksum pairs. Duplicate names or ambiguous folders are failures; files must not be silently overwritten.

## Owner acceptance of the first run

For the controlled initial `workflow_dispatch`, after the approved change is merged, the owner must select `main`. The workflow job blocks every other ref. The owner must then confirm:

- All six publication results above are visible and successful.
- The package and `.sha256` file exist in the expected daily Drive folder.
- The GitHub artifact contains only the package and checksum and has the intended short retention.
- Retention output is a dry-run and reports no remote trash operation.
- Logs, annotations, summaries, and artifact names contain no secret values.
- No database, source Storage, Auth, migration, restore, or deployment write occurred.

Keep the status `NOT_ACTIVE_PENDING_OWNER_SETUP` until this controlled run and the subsequent scheduled observation have both been reviewed by the owner.
