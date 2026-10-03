# Final consent/account closeout — 3 October 2026

## Recovery and isolation

Source branch: `fix/post-promotion-avatar-ai-ballfit-settings`.
Starting HEAD: `20a11d128166945aaccb81457fe66c6cc7aa179c`.
Annotated checkpoint: `freeze/pre-final-consent-account-closeout-2026-10-03`.
Previous READY Preview: `golf-bets-6160z3lfx-saha8.vercel.app`, deployment
`dpl_GJ185qJqk7EFnT9xmadjhgqUmEoY`.

DEV remains on `dpl_5STeMV2ibnqC6MUA8vy9wkyzVQNj`, SHA
`b2cdbe4f1a0cbe5326a13db951b299f1969e270f`. No alias, Auth/SMTP, roles,
remote variables or remote application rows changed in this closeout.
Supabase DEV `bymeopxkxapfizeeqeyb` was inspected read-only. QA
`gvzeymebltssgjkvksxt` remains untouched. No migration was applied remotely.

## Permission matrix

Current-value evidence is a read-only sample of the existing PLAYER QA account
`saidabaid+regressionqa@gmail.com`; it is **not** proof of a new registration on
this build. Its pre-existing accepted events and preferences were confirmed in
the shared DEV database. A new synthetic SQL account starts entirely OFF.
Existing users display their server-confirmed choices; only undecided purposes
start unchecked. Browser/OS permission cannot be inferred from a DB preference.

| Permission/purpose | Onboarding UI | Canonical storage | Sample current value | Runtime consumers | Settings/revocation |
|---|---|---|---|---|---|
| Location in-app intent | Separate unchecked choice | `optional_authorization_events.LOCATION_INTERNAL`; projection `user_preferences.location_internal_enabled` | Accepted / true | Nearby courses, device permission client | Device settings → disable location; owner-bound scope RPC |
| Location OS permission | Separate explicit OS prompt after saving choices | Browser/OS permission; device-local observation cache | Not measurable without device | Geolocation API | Shows actual device status; explains OS Settings must revoke device grant |
| Internal notifications master | Separate choice | `optional_authorization_events.NOTIFICATION_INTERNAL`; `user_preferences.notification_internal_enabled` / `notifications_enabled` | Accepted / true | Internal notifications and account intent | Notifications/device settings, same canonical scope |
| OS notification permission | Separate explicit prompt | Browser/OS `Notification.permission`; local observation cache | Not measured | Browser notification API | Actual device permission is shown separately |
| Push preference | Separate checkbox | `user_preferences.push_notifications_enabled` | true | Account notification preferences | Notifications → Push; delivery availability separate |
| Operational email | Separate checkbox | `user_preferences.email_notifications_enabled` | true | Account notification preferences | Notifications → Email; separate from marketing |
| Round notices | Separate checkbox | `user_preferences.round_notifications_enabled` | true | Round notification settings | Notifications → Rounds |
| Reminders | Separate checkbox | `user_preferences.reminders_enabled` | true | Reminder preference | Notifications → Reminders |
| Activity sharing master | Explicit checkbox, reasonable child defaults only on that tap | Existing social audience preference via `set_my_social_activity_preferences_v1` | Existing acceptance; exact audience re-read by API | Friends-only activity visibility | Activity I share → master; never real-time location |
| Finished rounds | Separate child checkbox | `social_activity_preferences_v3.share_rounds` | true | Shared round activities | Activity I share → rounds |
| Achievements | Separate child checkbox | `.share_achievements` | true | Shared achievements | Activity I share → achievements |
| Equipment changes | Separate child checkbox | `.share_equipment` | true | Equipment activities | Activity I share → equipment |
| Courses played | Separate child checkbox | `.share_courses` | true | Course activity | Activity I share → courses |
| Likes | Separate checkbox | `.notify_like` | true | Social notices | Social notification preferences |
| Comments | Separate checkbox | `.notify_comment` | true | Social notices | Social notification preferences |
| Round attestations | Separate checkbox | `.notify_attest` | true | Round validation notices | Social notification preferences |
| Friend achievements | Separate checkbox | `.notify_friend_achievement` | true | Friend notices | Social notification preferences |
| Friend equipment | Separate checkbox | `.notify_equipment` | true | Friend equipment notices | Social notification preferences |
| Friend requests | Separate checkbox | `.notify_friend_request` | true | Friend request notices | Social notification preferences |
| Personal memory | Separate checkbox | `optional_authorization_events.PERSONAL_MEMORY`; `user_preferences.personal_memory_enabled` | Accepted / true | Private personalization | Legal/privacy → memory; separate owner scope |
| Future global learning | Separate purpose-specific checkbox | `optional_authorization_events.GLOBAL_LEARNING`; `user_preferences.global_learning_enabled` | Accepted / true | Existing reviewed/deidentified eligibility only | Legal/privacy → global learning; copy explicitly does not promise active training |
| Backyard AI text/dictation | Separate checkbox | `ai_processing_consents.AI_PROVIDER_PROCESSING_CONSENT`, current policy version | Accepted | AI text entry / server consent guard | AI privacy → revoke; first-use contextual request remains |
| Photos/images | Separate checkbox | `ai_processing_consents.AI_IMAGE_PROCESSING_CONSENT` | Accepted | Avatar / image processing guards | AI privacy → revoke; contextual request remains |
| Practice/Launch Monitor images | Separate checkbox | `ai_processing_consents.AI_LAUNCH_MONITOR_PROCESSING_CONSENT` | Accepted | Photo/screenshot parsing | AI privacy → revoke; contextual request remains |
| Bets/results/expenses | Separate exact existing policy statement | `legal_evidence_events`, purpose `financial_data`, environment + policy/hash | Accepted in preview | Financial consent gate | Legal/privacy → ACTIVE / revoke |
| Marketing | Separate exact policy statement, never preselected for new user | `legal_evidence_events`, purpose `marketing`, environment + policy/hash | Accepted in preview | Marketing permission; no campaign is activated | Legal/privacy → switch; waits for backend confirmation |
| Required terms/age/privacy notice | Existing welcome ceremony, separate from options | Existing `legal_acceptances` and `legal_evidence_events` | Terms/age accepted, notice presented in preview | Required legal entry gate | Legal documents / evidence; no new contract acceptance by agent |
| GHIN/read-only linkage | Existing separate golf index flow | Existing GHIN connection/consent model | Not inspected in this pass | GHIN read-only profile | Existing index controls; not merged into privacy purposes |

The existing canonical GET is `/api/account/optional-authorizations` plus the
owner-scoped `/api/social/preferences`. Saving uses the existing individual
scope/AI/evidence/preferences APIs. Four settings scopes retain their existing
`settings` provenance; the new UI does not invent a new ledger/source or alter
policy versions. AI/evidence decisions carry the existing onboarding source.
Partial writes are recoverable: the screen stays on this step, preserves the
selection, reads committed decisions, reuses request UUIDs, and verifies every
purpose before advancing. No single `authorize_all` action is used by the new
onboarding screen. No narrow sharing choice is widened on resume.

## Bugs and fixes

- Statistics reset was rejected by an obsolete isolated-QA environment guard
  before reaching the existing `reset_my_statistics` RPC. Removed only that
  environment restriction. Auth, active-account check, owner RLS, CSRF, exact
  word, request UUID, canonical reset cutoff and read-back remain enforced.
- Account deletion selection auto-filled `ELIMINAR`, replacing deliberate
  confirmation with an enabled button. It now clears the input; only exact,
  case-sensitive `ELIMINAR` enables the red final action. Existing deletion
  engine/policy remains unchanged.
- Initial optional onboarding exposed an all-purpose acceptance action while
  some settings read separate sources. Added 24 independently selectable
  choices grouped into five accordions, with no silent legal acceptance.
- Marketing previously announced success before background evidence sync
  finished. `recordLegalChoice` now waits for the owner-bound backend receipt;
  Settings also hydrates the canonical marketing decision.
- Healthy cloud states exposed Retry without a failure. It appears only for
  pending/offline/error states.
- Reversible deactivation was merely an unavailable card. It now has a separate
  server-authoritative contract, confirmation, logout and reactivation gate;
  deployment capability stays unavailable until the prepared migration is
  explicitly applied.

## Prepared migration — controlled apply gate

`supabase/migrations/20261003154026_account_reversible_activation.sql`
was generated with the installed Supabase CLI and is **PREPARED, NOT APPLIED**.

- Adds `deactivated` to the existing private lifecycle status constraint.
- Adds private `account_activation_security` and append-only activation event
  tables, with RLS and no anon/authenticated table access.
- Adds two service-only public RPCs: owner/session-bound status and transition.
- Extends the existing private data-access helper: inactive accounts are denied;
  accounts previously deactivated require a real, newly authenticated session.
- Uses the same per-user lifecycle transaction lock to avoid deletion races.
- Preserves Auth/profile/rounds/equipment and all existing retention semantics.
- Does not alter Auth providers/hooks/config, roles, SMTP or legal documents.
- Installation expected application rows modified: **0**. Verified locally.
- Reapplication is schema-idempotent. No deactivation/reset/delete runs during
  installation. No fixtures or QA user IDs are included.

Revoking refresh tokens alone cannot prevent reuse of a still-valid access JWT.
The new boundary checks the indexed real `auth.sessions` record and its creation
time after deactivation; old JWTs remain denied after reactivation. This follows
the documented [Supabase session semantics](https://supabase.com/docs/guides/auth/sessions).

Next safe action: approve/apply this one migration on the shared DEV database
after preserving the current helper/constraint definitions and confirming the
existing backup. Verify ledger, health and grants before a QA deactivation.
No bulk cleanup, data copy, role change or deployment promotion is involved.

## Verification and limits

- Targeted JS tests: 40/40 PASS, including separate reversible deactivation
  confirmation and exact destructive-word matching.
- Full suite: 4,124/4,128 PASS, exactly the same four historical failures below.
- Scripts: 117/117 PASS.
- Typecheck, lint, build: PASS.
- Real isolated PostgreSQL tests: activation 30 checks, granular consent 14
  checks, statistics reset 7 groups, full account-lifecycle migration graph PASS.
  These are SQL integration/RLS tests, not mocks or remote end-to-end claims.
- Local browser uses actual production React/CSS components and clearly labeled
  synthetic transport fixtures. Confirmed exact typed gate, 390/430 px, reduced
  390×430 viewport, cancel/X/CTA visibility and no horizontal document overflow.
  This does **not** prove physical Safari keyboard behavior or remote writes.
- Existing deletion HTTP 200 / prepare ~2.8s / Auth/profile/session cleanup PASS
  is retained from the prior controlled execution. No remote delete was retried.
- No active authenticated browser session remained for this turn. New-account
  OTP/legal acceptance and Preview read-back are PENDING_INTERACTIVE_QA.
- Deactivate/reactivate remote execution is PENDING_CONTROLLED_DB_APPLY.

Historical failures (unchanged):
1. `la UI final usa bolsa premium, selección guiada y modo manual explícito`
2. `Mi bolsa abre una ficha limpia por bastón y reserva el borrado para el detalle`
3. `Mi Bolsa keeps approved product media while permanent management stays compact`
4. `nightly audit artifacts reproduce from canonical runtime catalogs and captured QA metadata`
   (`equipment-gaps.json`, STALE_CATALOG_AUDIT).

## Human final checklist

1. Authorize the exact prepared migration; no alias promotion. Then use a clean
   PLAYER QA account, normal OTP and your own required-term acceptance; choose
   privacy purposes and confirm Settings after reload and a new login.
2. On that QA account, type `ELIMINAR` for statistics reset. Confirm old rounds
   remain, account/session remain active and a new round starts the new baseline.
3. After DB apply, deactivate → new legitimate OTP login → reactivate; verify
   the same profile/rounds/equipment. Finally authorize a separate disposable
   QA account deletion and complete the exact typed confirmation.
4. Check these controls once on physical iPhone Safari with the keyboard open.

Fixtures created remotely in this pass: **0**. Fixtures cleaned remotely: **0**.
Synthetic local fixtures are in memory only. Existing QA history was not deleted.

Final gate: **PENDING_CONTROLLED_DB_APPLY**. Not ready for DEV promotion yet.
