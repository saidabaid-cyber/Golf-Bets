# Canonical runtime reconciliation — 3 October 2026

Canonical source: `fix/post-promotion-avatar-ai-ballfit-settings`.
Starting HEAD: `85f2582d1a63c8ec53699b68a23b27ac93b8027e`.
DEV base: `1b53cf2e200d5ae6bd95d8f405b3dbe05004ede8`.
Verified relation: 79 ahead / 0 behind. All 79 commits remain ancestors.
Checkpoint: `freeze/pre-canonical-dev-reconciliation-2026-10-03`.

## Actual runtime

`app/page.tsx` mounts `ProfileAccountPanel` for both profile and account views,
with `onStatisticsReset={applyStatisticsReset}`. `AccountPanel` is legacy and
is not used as evidence of these flows. It is retained for separate cleanup.

| UI | Production handler / request | Source of truth |
|---|---|---|
| Email access | `AccessScreen.sendCode` → POST `/api/auth/email-otp` | Service-only exact account lookup + Supabase OTP |
| Statistics | `ProfileAccountPanel.deleteStatistics` → DELETE `/api/account/statistics` | Existing reset cutoff / request / audit ledger |
| Deactivate | `AccountDataDialog.onDeactivate` → provider → POST `/api/account/activation` | Server activation state + revoked sessions |
| Reactivate | Provider's inactive account gate → POST `/api/account/activation` | Same user UUID / retained history |
| Delete | `AccountDataDialog.onConfirm` → `ProfileAccountPanel.deleteAccount` → DELETE `/api/account/delete` | Existing account lifecycle / Auth cleanup |
| Optional onboarding | Provider / `BetaOnboardingFlow` → `OnboardingPrivacyChoices` | Purpose-specific consent/evidence/preferences APIs |

The previous DEV deployment (`dpl_5STeMV2ibnqC6MUA8vy9wkyzVQNj`, SHA
`b2cdbe4f1a0cbe5326a13db951b299f1969e270f`) still has an isolated-QA-only
guard in the statistics endpoint and has no activation endpoint. Those fixes
already exist in the canonical branch; they are preserved, not reconstructed.

## Focused access correction

- The initial screen retains the existing editorial image and GOOD GOLF /
  BETTER FRIENDS identity, with Create account and Sign in.
- Email uses the existing eight-digit OTP configuration. No passwords.
- Google appears only after the real provider status confirms availability.
- Apple and public guest entry are removed. A cached legacy guest workspace
  cannot bypass sign-in; its local data is retained for explicit import.
- Login missing account returns 404 without invoking OTP.
- Registration existing account returns 409 without invoking OTP and offers
  an explicit Sign in action. Lookup failure fails closed for both intents.
- Existing server rate limits, cross-site checks and cooldown remain intact.

## Verification scope

New behavior tests execute the actual production AccessScreen and the actual
ProfileAccountPanel statistics handler. The page's JSX is parsed to verify
both mounted panels and their reset callback. Synthetic transport in these
tests is not remote persistence evidence.

The prior authenticated closeout evidence was obtained through this same
mounted panel, not AccountPanel: real reset, two deactivate/reactivate cycles,
separate disposable account deletion and subsequent account-not-found login.
The relevant panel, dialogs, activation/deletion/statistics APIs and consent
components are unchanged in this correction. Their successful destructive
operations are not repeated just to regenerate evidence. Runtime checks and
immutable deployment identifiers are recorded in the external reconciliation
report; local test success alone does not authorize promotion.

Validation after the access change: typecheck / lint / build PASS; full suite
4141/4145 with the same four historical failures; scripts 117/117; isolated
PostgreSQL activation 30 checks, granular onboarding 14 checks, statistics
reset and full lifecycle graph PASS. No migration is introduced or applied.

## Promotion boundary

Only a verified fast-forward of `integration/backyard-current` is permitted.
The source checkpoint and previous DEV deployment remain recoverable. No
reset, rebase, cherry-pick, force push, main/beta change, Production promotion,
Auth/SMTP/role change or QA-project deletion is part of this correction.
