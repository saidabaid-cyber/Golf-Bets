# Git recovery without GitHub

Git is distributed; GitHub availability is not required for a bundle restore. Preserve refs, tags and history—not just ZIP files. LFS object bodies, submodule repositories, issues, PR discussions, branch protection, deploy keys and Actions secrets are separate. The repository now contains `.github/workflows/automated-offsite-backup.yml`; source preserves its definition, not GitHub settings, secret values or prior artifacts.

## Create independent backups

On a trusted owner-authorized machine with a credential helper (never put tokens in URLs):

```sh
git clone --mirror https://github.com/saidabaid-cyber/Golf-Bets.git /private/backups/Golf-Bets.git
git -C /private/backups/Golf-Bets.git fsck --full
git -C /private/backups/Golf-Bets.git bundle create /private/backups/Golf-Bets-all.bundle --all
git -C /private/backups/Golf-Bets.git bundle verify /private/backups/Golf-Bets-all.bundle
```

Use a new path per snapshot. For an existing dedicated mirror, fetch without prune first and snapshot before maintenance. Do not repoint or overwrite a working development tree. Before using the built-in source backup:

```sh
git fetch origin --tags
git status --short
npm run backup:source
```

The script bundles **all locally available refs**; it cannot capture remote commits that were never fetched. It rejects shallow clones. It also creates HEAD.tar and refs.txt. Uncommitted/untracked work is explicitly reported as not included; commit intended changes or preserve an independent reviewed patch outside source.

## Restore without the old provider

```sh
git clone --mirror /private/snapshot/source/repository.bundle /private/restored/Golf-Bets.git
git -C /private/restored/Golf-Bets.git fsck --full
git clone /private/restored/Golf-Bets.git /private/restored/worktree
git -C /private/restored/worktree checkout --detach <commit-recorded-in-backup-manifest>
git -C /private/restored/worktree rev-parse HEAD
```

Replace the placeholder only with the exact commit recorded in the backup manifest; a recorded branch may then be recreated deliberately if needed. Compare SHA with the manifest. The verifier tests the bundle from an empty Git repository so hidden object prerequisites cannot be supplied by the original repo.

To move to a newly authorized empty GitLab/Bitbucket/independent bare server, add a NEW remote to the recovered mirror, review `git show-ref`, and push only intended heads and tags. A mirror push can delete refs on a nonempty target: do not run it against existing repositories. Recreate access control and protected branches manually; no main/beta merge is part of recovery.

Local Git restore was exercised by automated fixtures; the final repository bundle execution is recorded in BACKUP_VERIFICATION. Off-device copy/restore remains a separate owner action.
