# Scorecard Vision v1 foundation

The new review is integrated into the existing scorecard scanner behind
`NEXT_PUBLIC_BACKYARD_SCORECARD_VISION_V1`. `scorecard_vision_v1` is false by
default in every environment. It does not enable any external provider.

`lib/scorecard-vision/review.ts` defines a provider-neutral versioned evidence
contract, per-field confidence, course/player/tee/hole/total observations,
warnings, unresolved fields and source image identity. It reuses the existing
normalizer and deterministic scorecard validator rather than duplicating golf
rules. No monetary calculation occurs here.

The review UI exposes all accepted cells for correction, not only uncertain
cells. Unknown course/tee/player, absent pars, invalid scores and inconsistent
totals require resolution. A tee must be one already selected for the round.
Missing guests are never created implicitly. Existing score corrections show
an impact warning.

Confirmation is bound to the exact evidence, round snapshot and corrections.
After asynchronous consent the scanner validates the latest snapshot again.
A changed round requires a new review. A successful command goes through the
existing owner-authorized score persistence callback; review itself performs
no storage writes and never creates or overwrites a round automatically.
Cancel and close return to the round without importing anything.

The provider contract fails with `BLOCKED_EXTERNAL` when unconfigured. Tests
use explicitly synthetic readings; no test is evidence of real OCR. Synthetic
provenance is not importable. No OCR/model service was called for this work.

Validation: 23 new contract/fixture tests; 43/43 including existing scorecard
validation tests. The full nightly gates are recorded separately after merge.
Physical capture/provider interaction remains PENDING_DEVICE_QA /
PENDING_INTERACTIVE_QA until explicitly exercised with a configured provider.

Cross-review reproduced a stale callback hazard during asynchronous betting
consent. The scanner now reads the latest persistence callback at commit and
binds confirmation to the full host round revision (including putts, rules,
ownership and lifecycle). A deferred-consent regression proves that an old
callback cannot overwrite a newer host snapshot.
