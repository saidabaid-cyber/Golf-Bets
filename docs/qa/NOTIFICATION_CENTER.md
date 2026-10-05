# Notification Center — DEV

Scope: notifications UI, preferences and deep-link adapters only. Canonical branch `integration/backyard-current`; BASE_SHA `1151067351d903121fc67c2b045f7684f6c5d162`. DEV `/api/health` was HTTP 200, Preview, with that SHA before edits. No main/beta/Production changes.

## Implementation and contracts

- Primary bell opens `?screen=notifications` directly. Secondary screen retains the existing five bottom-nav destinations. Gear opens `?screen=notificationPreferences`.
- One compact presentation normalizes `notification_events_v2` and valid incoming `group_email_invitations` through the existing group RPC. Deduplication uses invitation identity or event type/resource identity; distinct reactions/comments remain distinct. Read markers never accept/reject invitations. Outgoing, expired and resolved invitations do not count.
- Bell fetches unread pages (50 per request, bounded at 1,000); list pages are 50. Filters are Todas, Amigos, Grupos, Rondas. Optional filter counts are omitted rather than presenting counts from an incomplete page.
- Friendship actions reuse `/api/social/connections` ACCEPTED/REJECTED and require a confirmed state in the returned graph. Profiles open the existing Friends destination. Group acceptance reuses `useGroupInvitationInbox` and `retryCloudSync`.
- Rounds open their canonical cloud UUID through the unchanged `RoundParticipationCard`; review uses the existing participant-links endpoint and refreshes notifications/history. Social events open the authorized activity card. The compact list contains no financial payload or guessed score.
- `GET/PATCH /api/social/notification-preferences` reads/writes only authenticated `user_id`, validates the seven event types and boolean-only values, denies client-supplied owner IDs, and sends private/no-store responses. Missing legacy event rows retain existing IN_APP behavior. A conflict-safe initialization plus channel-specific update preserves another device's unrelated channel.
- One preferences screen composes event preferences and `/api/social/preferences`. All 15 boolean controls use accessible switches; push/email controls remain disabled with truthful availability copy. No OS permission request. Sharing/privacy flags are preserved; their unrelated UX is retained.
- Master reuses the existing canonical account notification authorization action and `user_preferences.notifications_enabled`; it does not overwrite individual flags. OFF mutes presentation and badge, ON restores their previous configuration.
- Friend-request OFF updates both existing gates (`in_app` and `notify_friend_request`). The existing friend-request trigger suppresses event insertion when its social flag is false. This insertion behavior is preserved; historical events are not deleted.

## Supported capabilities / pending verification

- `friend_request`, operational group invitations and Social events are already persisted in DEV.
- `friend_accepted`, `round_invite`, `round_finished`: presentation supports their contracts; no real emitter found in the current code/DEV data. Do not fabricate events to claim runtime success.
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

- Fresh isolated test compilation: 4,355 tests, 4,350 PASS, the same five preexisting FAIL, zero new failures. 35 new notification tests PASS, including a PostgreSQL test of the precise grants, recipient RLS and idempotent retry.
- Additional package-script tests: 117 PASS, zero FAIL.
- Baseline failures: equipment-owner-review premium UI; equipment-ui-contract Mi Bolsa; final-brand-ghin-closeout Mi Bolsa; iphone-capture Reglas resources; nightly-catalog-quality stale equipment audit. No unrelated fixes or weakened assertions.
- Old `.test-dist` contained five compiled course suites absent from the current branch. Validation uses `tmp/notification-test-dist` built from current source, retaining those caches and the isolated course branch untouched.
- Notification-related legacy tests now test switches and the normalized badge rather than assuming checkbox rendering / a single unread page. Other assertions remain intact.
- Typecheck PASS; lint PASS; build PASS. Final runtime/browser checks will be recorded after DEV deployment.

## Runtime QA

PENDING_INTERACTIVE_QA until deployment. Physical Safari/PWA/iPhone QA remains `PENDING_DEVICE_QA`; viewport checks are not physical-device verification.

Course branch preserved at `6f4f06180d4b0572b298dc705fbcf9c568be70d7`, zero commits merged. Engines, Career, Rules, GHIN, Equipment, Auth, onboarding and Groups/Friends UX sources unchanged (only notification adapters in shared shells/inbox).
