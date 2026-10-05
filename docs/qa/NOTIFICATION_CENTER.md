# Notification Center — DEV

Scope: notifications UI, preferences and deep-link adapters only. Canonical branch `integration/backyard-current`; BASE_SHA `1151067351d903121fc67c2b045f7684f6c5d162`. DEV `/api/health` was HTTP 200, Preview, with that SHA before edits. No main/beta/Production changes.

## Implementation and contracts

- Primary bell opens `?screen=notifications` directly. Secondary screen retains the existing five bottom-nav destinations. Gear opens `?screen=notificationPreferences`.
- One compact presentation normalizes `notification_events_v2` and valid incoming `group_email_invitations` through the existing group RPC. Deduplication uses invitation identity or event type/resource identity; distinct reactions/comments remain distinct. Read markers never accept/reject invitations. Outgoing, expired and resolved invitations do not count.
- Bell fetches unread pages (50 per request, bounded at 1,000); list pages are 50. Filters are Todas, Amigos, Grupos, Rondas. Optional filter counts are omitted rather than presenting counts from an incomplete page.
- Friendship actions reuse `/api/social/connections` ACCEPTED/REJECTED and require a confirmed state in the returned graph. Profiles open the existing Friends destination. Group acceptance reuses `useGroupInvitationInbox` and `retryCloudSync`.
- After ACCEPTED, a notification-only adapter rechecks the canonical accepted request under the accepting account's RLS and sends `friend_accepted` only to its verified requester. It respects that recipient's event preference, uses a deterministic ID, preserves read markers on retry and stores references only. Failure to deliver does not reverse or fake the friendship. Server permissions remain pending; no client role receives insertion capability.
- Rounds open their canonical cloud UUID through the unchanged `RoundParticipationCard`; review uses the existing participant-links endpoint and refreshes notifications/history. Social events open the authorized activity card. The compact list contains no financial payload or guessed score.
- `GET/PATCH /api/social/notification-preferences` reads/writes only authenticated `user_id`, validates the seven event types and boolean-only values, denies client-supplied owner IDs, and sends private/no-store responses. Missing legacy event rows retain existing IN_APP behavior. A conflict-safe initialization plus channel-specific update preserves another device's unrelated channel.
- One preferences screen composes event preferences and `/api/social/preferences`. All 15 boolean controls use accessible switches; push/email controls remain disabled with truthful availability copy. No OS permission request. Sharing/privacy flags are preserved; their unrelated UX is retained.
- Master reuses the existing canonical account notification authorization action and `user_preferences.notifications_enabled`; it does not overwrite individual flags. OFF mutes presentation and badge, ON restores their previous configuration.
- Friend-request OFF updates both existing gates (`in_app` and `notify_friend_request`). The existing friend-request trigger suppresses event insertion when its social flag is false. This insertion behavior is preserved; historical events are not deleted.

## Supported capabilities / pending verification

- `friend_request`, operational group invitations and Social events are already persisted in DEV.
- `round_invite`, `round_finished`: presentation supports their contracts; no real emitter found in the current code/DEV data. Do not fabricate events to claim runtime success.
- `friend_accepted`: the previously absent emitter is now implemented through the existing acceptance API's notification adapter. Runtime emission remains blocked by the same pending server privileges.
- `GROUP_INVITE_REJECT_BLOCKED`: private invitation state includes DECLINED, but `group_invitation_action_v1` exposes no decline action. No fake reject control, alternate group backend or private-table exposure was added.
- `round_started` / `scorecard_ready`: existing canonical emitter is present; DEV lacks its server column privileges. Reviewable SQL below is pending approval/application. Card read/review capability itself is preserved.

## Controlled notification permission migration

File: `supabase/migrations/20261005143022_notification_server_delivery_permissions.sql` (generated with Supabase CLI).

Exact relevant SQL:

```sql
grant select (user_id, event_type, in_app) on public.notification_preferences_v2 to service_role;
grant insert (id, recipient_id, event_type, resource_type, resource_id) on public.notification_events_v2 to service_role;
grant select (id, recipient_id) on public.notification_events_v2 to service_role;
```

Existing tables/columns only; no tables, columns, constraints, indexes, functions or triggers created/changed. No data update/delete/backfill, no loss of data. No anon/authenticated grants and no policy changes. Compatible with verified DEV schema. Grants are idempotent. Conflict-target SELECT is necessary for `INSERT ... ON CONFLICT DO NOTHING`. Existing deterministic event IDs prevent spam and retain read state on retry. Rollback is the corresponding three column REVOKEs, documented in the file; it removes delivery capability without deleting notices.

DEV binding: `bymeopxkxapfizeeqeyb`, non-default `phase2-full-platform-qa`, branch UUID `a3dbcd66-bf2d-4f25-b0ea-92f0ebfa4c06`. Prior state: 78 events, 112 preference rows, RLS enabled; policy fingerprint `cac89dadc79f31769fdd5c5d04b4ca8d`. Anon SELECT, client INSERT and client recipient UPDATE are false.

**PENDING_CONTROLLED_DB_APPLY**: automatic approval review rejected the persistent service-role permission expansion because the task did not specifically authorize these grants. No permissions were applied. Explicit approval was requested; do not bypass the rejection.

## Automated validation

- Fresh isolated test compilation: 4,362 tests, 4,357 PASS, the same five preexisting FAIL, zero new failures. 42 new notification tests PASS, including a PostgreSQL test of the precise grants, recipient RLS, accepted-event attribution and idempotent retry.
- Additional package-script tests: 117 PASS, zero FAIL.
- Baseline failures: equipment-owner-review premium UI; equipment-ui-contract Mi Bolsa; final-brand-ghin-closeout Mi Bolsa; iphone-capture Reglas resources; nightly-catalog-quality stale equipment audit. No unrelated fixes or weakened assertions.
- Old `.test-dist` contained five compiled course suites absent from the current branch. Validation uses `tmp/notification-test-dist` built from current source, retaining those caches and the isolated course branch untouched.
- Notification-related legacy tests now test switches and the normalized badge rather than assuming checkbox rendering / a single unread page. Other assertions remain intact.
- Typecheck PASS; lint PASS; build PASS. Final runtime/browser checks will be recorded after DEV deployment.

## Runtime QA

Notification deployment `412d82a46cb13fc045fca0845eabe7f8ce50f7cd`: Vercel Preview READY, alias `dev.thebackyard.com.mx`, health HTTP 200 and exact SHA verified by the guarded QA runner. No Production deployment/promotion.

28 real DEV API checks PASS with existing Diego Green, Carlos Fairway and Fernanda Putt accounts. No accounts created/deleted, no fabricated notification insertion. Event/Social choices persist on fresh GET; master OFF/ON retains their values. Friend-request OFF suppresses the existing trigger insertion. Carlos' OFF request was cancelled by Carlos, his ON request rejected by Fernanda, and Diego's real request accepted by Fernanda. Reciprocal friendship and actor profile resolve correctly. Fernanda accepted the existing QA Foursome invitation, and canonical cloud sync contains the joined group. Read/unread/all-read do not resolve pending invitations. Existing Carlos canonical card `0d37b6e4-0aae-4cdf-81e1-93e8bded8d1d` can be read; confirmation retry preserves one history entry. This retry is not evidence of a newly emitted scorecard notification.

Client RLS checks PASS: Carlos cannot select Fernanda's notices or event preferences; his global notice selection contains only his own recipient ID. Post-QA metadata confirms RLS enabled, anon SELECT false, client recipient reassignment false, own read_at UPDATE true. Server delivery grants remain false: the rejected migration was not applied. 90 event rows / 112 preference rows after ordinary QA actions and existing triggers; no direct event insertion by the QA runner.

**PENDING_INTERACTIVE_QA**: browser access offers email-code login; existing QA credentials use example.invalid addresses and cannot receive that code. No Auth code change, session/storage injection, administrative login link or new account was used. An authenticated DEV browser session was requested. Consequently live bell/actions/Back/Forward/reload have not been declared verified.

Viewport component QA PASS at 390×844 and 430×932 using SSR of the actual notification rows/preferences and actual persisted QA data, in a local static artifact. No page overflow; rows with actions 115px; touch targets at least 44px; 15 switches and zero checkboxes. This static render does not prove client interactions or the authenticated DEV shell. Screenshots in ignored QA artifacts are explicitly labelled static. Physical Safari/PWA/iPhone QA remains **PENDING_DEVICE_QA**.

## Delivery checklist

PASS below denotes an automated component/contract test or the real API checks described above. The separate interactive gate remains pending; **DONE is not declared**.

| NOTIFICATION CENTER | Result |
| --- | --- |
| BELL OPENS DIRECTLY / NO COMMUNITY INTERMEDIATE | PASS — navigation contract |
| UNIFIED LIST / FILTER ALL / FILTER FRIENDS / FILTER GROUPS / FILTER ROUNDS | PASS — presentation tests |
| UNREAD STATE / MARK READ / MARK ALL READ | PASS — components and real read_at API |
| NO DUPLICATES | PASS — identity normalization tests |

| FRIENDS | Result |
| --- | --- |
| REQUEST / ACCEPT / REJECT | PASS — real DEV requests |
| FRIEND ACCEPTED | FAIL — emitter implemented/tested; runtime blocked by pending server permission; friendship acceptance itself PASS |
| PROFILE DEEP LINK | PASS — exact actor destination contract and private profile API |

| GROUPS | Result |
| --- | --- |
| INCOMING GROUP INVITE / ACCEPT / GROUP APPEARS / OUTGOING NOT COUNTED | PASS — real API and badge normalization |
| REJECT | BLOCKED — GROUP_INVITE_REJECT_BLOCKED; canonical RPC has no decline action |

| ROUNDS | Result |
| --- | --- |
| ROUND INVITE | NOT_EMITTED |
| ROUND STARTED | FAIL — BLOCKED_EXTERNAL_NOTIFICATION_PERMISSIONS |
| ROUND FINISHED | NOT_EMITTED |
| SCORECARD READY | FAIL — BLOCKED_EXTERNAL_NOTIFICATION_PERMISSIONS |
| PARTICIPANT REVIEW | PASS — existing real card, idempotent confirmation API and component destination; new-notice interaction pending |

| PREFERENCES | Result |
| --- | --- |
| NO CHECKBOXES / SWITCHES ONLY | PASS — all 15 rendered controls |
| MASTER SWITCH | PASS — canonical preference preserves individual settings |
| FRIEND REQUEST / FRIEND ACCEPTED / GROUP INVITES / ROUND INVITES / ROUND STARTED / ROUND RESULTS / SCORECARD READY | PASS — each event preference saved and reread in DEV |
| LIKES / COMMENTS / ATTEST / FRIEND ACHIEVEMENTS / EQUIPMENT | PASS — each Social preference saved and reread in DEV |
| PERSIST AFTER RELOAD | PASS — fresh API reads; browser reload pending |

| DELIVERY / MOBILE | Result |
| --- | --- |
| IN_APP | PASS — real friend-request delivery and preference gates; round emitter limitation above |
| PUSH PROVIDER / EMAIL PROVIDER | NOT_CONFIGURED |
| NO FALSE PUSH CLAIM / NO FALSE EMAIL CLAIM | PASS |
| 390x844 / 430x932 / TOUCH TARGETS | PASS — component visual QA only |
| BOTTOM NAV | PASS — source unchanged, regression contract, baseline DEV observation |

| REGRESSION / BUILD | Result |
| --- | --- |
| FRIENDS UNCHANGED / GROUPS UNCHANGED | PASS — existing UX/API contracts; notification adapters only |
| ROUND ENGINE UNCHANGED / BET ENGINE UNCHANGED / CAREER UNCHANGED / RULES UNCHANGED | PASS — no source changes |
| TESTS | FAIL — only the five documented baseline failures; 4,357 PASS plus 117 script PASS, zero new FAIL |
| TYPECHECK / LINT / BUILD | PASS |
| DEV PUSH | PASS — canonical branch only |
| DEPLOYMENT | READY — Preview, DEV alias |

Course branch preserved at `6f4f06180d4b0572b298dc705fbcf9c568be70d7`, zero commits merged. Engines, Career, Rules, GHIN, Equipment, Auth, onboarding and Groups/Friends UX sources unchanged (notification adapter after friendship acceptance and adapters in shared shells/inbox only).
