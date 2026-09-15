# Mi Bolsa V2 / Social / Attest — evidence and deployment gate

Initial branch: `phase2/full-platform`.
Initial HEAD: `351c32a4e798aeead6c748194ea844ce34aba1b0`.
Initial worktree clean. Home hero, approved Home CSS and assets remain NO TOUCH.

## Initial audit

| Area | Initial state | Reused / missing |
| --- | --- | --- |
| Equipment persistence | DONE locally, cloud capability gated | `useEquipmentProfile`, validated local writes, CAS/versioned cloud sync retained |
| Equipment mobile add/edit | PARTIAL | Existing long sheet replaced with full-page category/editor/success navigation |
| Equipment catalogue | DONE with manual fallback | Existing provider/catalogue and category fields retained |
| Social | PARTIAL | Private activity and friends directory existed; no durable interactions |
| Achievements | MISSING | Existing captured scores/putts/GIR reused; no fabricated data |
| Likes/comments/attest | MISSING | New authenticated API and additive RLS model required |
| Attest identity | PARTIAL | `round_participants_v2` organizer insertion alone is not proof of account participation |
| Notifications | PARTIAL | Private local notices existed; social notifications require persistent delivery |
| Isolated Preview DB | BLOCKED_EXTERNAL | Only shared project is available, no development branches |

## Safety boundary

Read-only infrastructure audit found project `zhqmlpljloumldaczcfp`, and `list_branches` returned `[]`.
No migration, fixture, account or interaction has been written to that shared database.
Cloud multiuser verification is **PENDING_CONTROLLED_DB_APPLY**, not PASS.
The existing [Preview DB runbook](STATS_PREVIEW_DB_QA.md) lists the additive prerequisite migrations and isolation checks.
New Social migration must be applied only after those prerequisites in a separate, data-less Preview DB; never replay old migrations blindly on the shared database.

## Implemented security and product rules

- Equipment activity follows persisted equipment changes, not a client-only success animation; consecutive changes are grouped.
- A completed round produces one summary card with several achievements, not separate spam posts.
- Sharing defaults to private; round/course/equipment/achievement visibility and notification preferences are checked server-side.
- Scores, participants and facts come from the persisted round snapshot, not a submitted social caption.
- An account-linked participant must confirm their own participation. Organizer-created membership and friendship alone do not authorize attest.
- No self-attest, anonymous attest, guest-by-name linking or incomplete-round attest.
- Attest references material scorecard content; changes to results stale prior attest. Likes, comments and avatar changes do not certify a new scorecard or change its sporting hash.
- Attest is a companion confirmation, **not** official WHS/GHIN certification or a prerequisite for Backyard Index.
- Social cards never expose betting balances, expenses, private notes or original scorecard photos.
- Comments are rendered as text; editing/deleting is restricted to their author.

## Implemented paths

- Mi Bolsa uses the existing validated local storage/CAS cloud hook, with full-page category,
  club/ball/distance editors, success, Add another (all nine categories), profile/bag destinations
  and cancellable delete confirmation. Ball fitting retains its separate existing flow; no new catalogue is fabricated.
- Persisted `rounds_cloud`/equipment versions create durable private base events transactionally.
  Server-side postcommit reconciliation produces SHA-256 sporting revisions and achievements;
  feed reads recover unfinished work. Publication failure does not misreport a successfully saved source as failed.
- Each authenticated self-confirmed participant gets their own card; organizer ownership is not
  required for the target. Friends who were not in the account-linked snapshot cannot confirm or attest.
- One round/account card merges multiple achievements; achievement-only sharing omits the scorecard.
  Course/tee identity is hidden when course sharing is disabled. Equipment changes coalesce into
  one current card per account, bumping feed time after a 30-minute window instead of posting each edit.
- Material hash is authoritative. A cosmetic cloud version increment with the same hash is allowed;
  an attest stores the actual locked source version. Material changes invalidate old attest.
- Like/unlike is unique per account/card; comments are bounded to 500 characters, author-only
  edit/delete. Old-revision comments are retained but cannot be rewritten to validate a new hash.
- Defaults: all sharing off; received like/comment/attest notices on; friend achievement/equipment
  notifications opt-in. Revoking privacy or participation also closes direct Data API reads.
- Feed has stable timestamp+UUID pagination and a bounded pending-publication recovery path.
  Backlogs beyond the bound fail explicitly instead of silently omitting records.
- Canonical profile avatar null is respected: selecting Sin imagen cannot resurrect a stale social photo.

## Verification ledger (local evidence only)

- Full Node test suite: **1,637 / 1,637 PASS**. TypeScript test compilation, ESLint and Next
  production build: **PASS**. Raw logs are under ignored `.qa-artifacts/bag-social-*`.
- `node scripts/test-social-activity-db.mjs` executes the actual additive migration on disposable
  PostgreSQL/WASM, with minimal prerequisite tables and synthetic authenticated/anon roles.
  It tests participant/self/guest/friend authorization, three attesters, duplicate/unlike,
  own/other comments, revision/CAS, source provisional-SHA visibility, link revoke/reconfirm,
  privacy opt-in/out, equipment coalescing and notification opt-in/idempotency.
- Real HTTP adapter tests substitute only Auth/config network boundaries: no token, anonymous,
  rejected session, arbitrary body userId, body size/shape, UUID and safe error response checks.
- Achievements tests cover comparable prior records, no first-round false personal best,
  incomplete captures, 18-hole eligibility, birdies, putts, GIR, chronology and material hash.
- Local browser Mi Bolsa: real `EquipmentProfilePanel` + `useEquipmentProfile`, empty catalogue,
  manual club/shaft, Driver → Add another → Wedge → edit → delete cancel/confirm → reload;
  Bola → Add another → category, distance save/reload. All 390/393/430 widths checked.
- Local browser Social: real components/client with an explicitly synthetic in-memory API,
  like/unlike, comment create/edit/delete/cancel, detail fetch, self-confirmation and attest,
  preferences, long name, 390/393/430 widths. This does **not** prove Supabase persistence.
- Screenshots outside Git: `../qa-bag-local/` and `../qa-social-local/`, prominently marked
  LOCAL QA / synthetic data. No legal terms, betting consent or AI consent accepted on behalf of a user.

## Controlled Preview activation — PENDING_CONTROLLED_DB_APPLY

1. Provision/identify a separate empty Supabase Preview project/branch, after required owner/cost approval.
   The only currently visible project is shared `zhqmlpljloumldaczcfp`; it is expressly rejected by the Social gate.
2. In that isolated ref only, audit the migration ledger and apply missing additive prerequisites in
   `STATS_PREVIEW_DB_QA.md`, then **`20260915183026_social_activity_v3.sql`**. Do not replay historical
   migrations or use `db push --include-all`. Apply using the Supabase migration tool with the verified
   Preview project ID, or a controlled `psql -v ON_ERROR_STOP=1 -f <migration>` connection to that ref.
3. Verify tables, explicit grants, RLS, restricted functions/triggers and Data API exposure. Confirm
   the restrictive Social notification policy does not hide unrelated existing notification types.
4. Configure only Vercel **Preview / phase2/full-platform** with that ref's existing Supabase URL,
   public client key and cloud service credentials (never expose service credentials to the browser).
   Add `SOCIAL_PREVIEW_DB_REF=<isolated-project-ref>` and `SOCIAL_ACTIVITY_ENABLED=true`.
   The code also rejects `VERCEL_ENV=production`. No such variables were changed in this task.
5. Redeploy Preview and use disposable, authenticated accounts Said/Pedro/Juan/Jorge plus a
   nonparticipant friend. Exercise the full browser → API → Auth → PostgreSQL → reload path.
   Confirm real session rejection, no self-attest, all three companions allowed, friend blocked,
   score changes stale attest, social edits do not, unique likes, ownership and preference revocation.
6. Run concurrent multi-connection score-edit/attest and comment/revocation tests. PGlite is serial
   and cannot certify remote locking/network/transaction behavior. Check Supabase security advisors.
7. Rollback strategy for this additive release: set `SOCIAL_ACTIVITY_ENABLED=false` in the same
   Preview scope and redeploy; preserve rows for investigation. Do not drop tables or touch shared data.

## Exact remaining gaps

- Cloud Social persistence, real Auth/RLS/API integration, multi-connection races and authenticated
  Preview mobile QA: **PENDING_CONTROLLED_DB_APPLY**. No cloud feature receives a final PASS yet.
- `NEW_COURSE_PLAYED` based on a verified different Home Club is not emitted: the current server
  model has no canonical verified Home Club/course association. Completed shared round cards may
  show their captured course only with course-sharing permission; no real-time location publication.
- Equipment posts currently use the safe grouped text “Actualizó su bolsa”, not model-specific
  announcements. Detailed equipment remains private.
- There is no official WHS/GHIN certification, push/email notification delivery or moderation UI.
  In-app notifications and future moderation fields are the scope of this release.
- Home has no code, CSS, image or shared-navigation changes. Visual acceptance of new screens remains with the owner.

## Closeout status

PASS below is local evidence unless explicitly stated. `PENDING_CONTROLLED_DB_APPLY` is not a cloud PASS.

| Requirement | Status | Evidence / remaining condition |
| --- | --- | --- |
| BAG_FULL_PAGE_FLOW | PASS (local) | Real component browser, no add/edit modal |
| BAG_ADD_ANOTHER | PASS (local) | Club and ball return to nine-category selector |
| BAG_EDIT | PASS (local) | Edit, confirmed delete, reload with real localStorage |
| EQUIPMENT_ACTIVITY | PENDING_CONTROLLED_DB_APPLY | Durable SQL trigger + coalescing local PostgreSQL PASS |
| ROUND_ACHIEVEMENTS | PASS (local) | Engine, historical component and captured-data tests |
| PERSONAL_BEST | PASS (local) | Comparable baseline, never first-round fabricated record |
| ROUND_SOCIAL_CARD | PENDING_CONTROLLED_DB_APPLY | UI fixture and redaction tests PASS; live data pending |
| LIKES | PENDING_CONTROLLED_DB_APPLY | Local SQL unique/unlike/auth tests PASS |
| COMMENTS | PENDING_CONTROLLED_DB_APPLY | Local SQL ownership + browser CRUD/cancel PASS |
| ATTEST_PARTICIPANT_ONLY | PENDING_CONTROLLED_DB_APPLY | Local SQL three confirmed participants allowed, friend-only denied |
| ATTEST_NO_SELF | PENDING_CONTROLLED_DB_APPLY | Local SQL denies self |
| ATTEST_SERVER_VALIDATION | PENDING_CONTROLLED_DB_APPLY | Session HTTP adapter + RLS local tests PASS |
| ATTEST_REVISION_INVALIDATION | PENDING_CONTROLLED_DB_APPLY | Material hash vs social/cosmetic version tests PASS |
| NOTIFICATIONS | PENDING_CONTROLLED_DB_APPLY | Local opt-in/coalescing/revocation tests PASS |
| PRIVACY | PENDING_CONTROLLED_DB_APPLY | Local direct-REST RLS and card redaction PASS |
| TESTS | PASS | 1,637 + isolated PostgreSQL script |
| LINT | PASS | ESLint exit 0 |
| BUILD | PASS | Next.js build exit 0 |
| HOME_UNCHANGED | PASS | Git diff for Home component/CSS/public assets empty |
