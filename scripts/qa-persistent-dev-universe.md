# Persistent DEV QA universe

This tooling operates exclusively on `bymeopxkxapfizeeqeyb` and
`https://dev.thebackyard.com.mx` with an exact deployed integration commit SHA.
It never sends email, changes Auth configuration, rotates passwords, runs a
migration, touches another user's records, or cleans up the five fixtures.

The five canonical fixtures are defined in `lib/qa-persistent-dev-fixtures.mjs`.
Auth ownership requires their exact synthetic email and server-only fixture
kind/version/key. A conflicting or unmarked identity aborts for review rather
than being adopted. Losing private fixture passwords aborts instead of resetting
them. UUIDs and credential plans are retained before an uncertain Admin create.

Required existing DEV configuration: `PREVIEW_DB_REF`,
`QA_CONFIRM_ISOLATED_PREVIEW`, `NEXT_PUBLIC_SUPABASE_URL`, the DEV publishable key,
the DEV Auth Admin secret, `PREVIEW_QA_URL`, `PREVIEW_QA_EXPECTED_SHA`, and
`VERCEL_ENV=preview`. Keys must be supplied privately through the existing
configuration; do not paste them into reports or commit them. Sensitive Vercel
environment metadata alone is not a usable Admin credential.

Compile and test the current domain, then provision twice:

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node --test scripts/qa-persistent-dev-universe.test.mjs
node scripts/qa-persistent-dev-universe.mjs --check-config --env-file=.qa-artifacts/persistent-dev-access.private.json
node scripts/qa-persistent-dev-universe.mjs --run --env-file=.qa-artifacts/persistent-dev-access.private.json
node scripts/qa-persistent-dev-universe.mjs --run --env-file=.qa-artifacts/persistent-dev-access.private.json
node scripts/qa-persistent-dev-e2e.mjs --run --env-file=.qa-artifacts/persistent-dev-access.private.json
node scripts/qa-persistent-dev-controlled-e2e.mjs --run --env-file=.qa-artifacts/persistent-dev-access.private.json
```

All three identity checks must pass before a fixture write: exact origin/ref,
Preview health with matching build SHA, and bundle/database credential binding.
Mutation guards recheck health before each write. SQL access alone is not used to
insert Auth users, bypass their sessions, or fabricate legal evidence.

Provisioning uses existing owner profile methods, manual HCP, the actual course
catalog and tees, current versioned legal evidence APIs for these explicitly
authorized synthetic accounts, social APIs and internal account invitations.
It preserves any existing rejected/revoked legal decision. Groups use existing
templates; at most three active implemented variants are selected, preferring
Nassau. An empty custom-preset catalog uses the same selectable built-in registry
and defaults as the existing GroupBuilder, without publishing Admin variants.
Cards are captured per hole; results and suggested settlements derive
from existing engines, with zero-sum/finite checks and historical recap validation.
Three shared rounds plus solo rounds provide at least six history cards per player through
existing participant confirmation. Missing active bet variants are reported as
blocked, never fabricated. Shared-card evidence and new-session reads are required.

Outputs under ignored `.qa-artifacts/`:

- `persistent-dev-qa.private.json`: synthetic login credentials; keep private.
- `persistent-dev-qa-universe.json`: public fixture IDs, clubs, relationships,
  groups, round IDs, engine settlements, QR paths and verification results.
- `qa_<fixture>.png`: stable DEV profile QR images, validated through real decode.
- `persistent-dev-qa-e2e.json`: results from real authenticated DEV API reads.

The second successful run compares UUIDs, group IDs and round IDs with the prior
manifest. It does not recreate them or overwrite historical cards. The verifier
keeps Mariana → Arturo pending and Fernanda unconnected. It verifies search,
privacy, QR image decoding, groups, history, real engine balances and feed dedupe;
it does not mislabel these API checks as browser E2E.

Separate controlled browser QA is still required for a new request/accept flow,
Home's five-second modal, timer cancellation, group creation/skip and exact round
draft return/resume. Use an additional authorized synthetic control account,
never reset the five persistent fixtures or use the owner's real account.
Physical camera/iPhone checks remain `PENDING_DEVICE_QA` without hardware.

The separate `CONTROLLED_DEV_QA` account exercises real request/notification/accept,
first-experience metadata, skip/create, active draft recovery in a fresh session,
and round closure through `/api/cloud/sync`. Its credentials remain private and
it does not consume the Mariana → Arturo pending baseline or Fernanda's empty graph.
The app's browser login offers OTP/OAuth rather than fixture passwords; without
an already-authenticated QA browser session, visual flows are reported blocked
instead of sending email, using OTP, changing Auth, or impersonating the owner.

If Auth Admin access is unavailable, `BLOCKED_AUTH_ADMIN_ACCESS` occurs before
fixture clients/network writes. A report with `users: []` means provisioning has
not happened; it must never be represented as five available QA players. After
external access is restored, update only the private expected SHA to the current
verified integration deployment and resume these commands. Preserve all fixture
data permanently until the user explicitly orders otherwise.
