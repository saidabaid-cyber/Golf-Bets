# GHIN Course Sync and score-posting guard — QA only

This phase is restricted to `integration/backyard-current`, Vercel Preview and
the canonical QA Supabase project `bymeopxkxapfizeeqeyb`. It does not authorize
Production, a global GHIN import, GPA/vendor access, or score posting with test
data.

## Upstream read flow

The server-only adapter follows the already proven two-step golfer flow and the
course endpoints used by `@spicygolf/ghin@0.20.0`:

1. Firebase Installation session.
2. `POST /golfer_login.json`.
3. Bearer token kept only in the server process cache.
4. `GET /facilities/search.json`.
5. `GET /crsCourseMethods.asmx/SearchCourses.json`.
6. `GET /crsCourseMethods.asmx/GetCourseDetails.json`.
7. `GET /TeeSetRatings/{id}.json`.
8. `GET /Courses/{course_id}/TeeSetRatingsForScorePosting.json`.

Failure of `TeeSetRatingsForScorePosting` is isolated from Course Details: a
golfer token may sync read-only course data even when score-posting entitlement
is unavailable. No client response, log or table contains the Firebase token,
golfer token, password, cookie or Authorization header.

## Canonical model and sync

The existing `golf_clubs → golf_courses → golf_course_tees → golf_holes` model
remains canonical. Additive columns record origin, provisional/layout status,
provider state and sync timestamps. Existing provider-link tables map GHIN IDs
to stable Backyard IDs. Names are not identities.

`lib/ghin/course-sync.ts` builds a deterministic normalized plan. The Preview
admin route supports:

- `dry_run`: stores only a sanitized normalized summary/diff;
- `apply_confirmed`: requires the course-sync flag, exact QA database binding,
  an active admin membership and an explicit confirmation literal.

The apply path upserts current catalog rows but never deletes history. Rounds
continue using their existing course/tee/hole and handicap snapshots, so later
catalog changes do not rewrite completed rounds.

## La Vista reconciliation

Three stable Backyard layout identities coexist:

- `course-la-vista`: standard Par 72 and candidate for GHIN course `23233`;
- `course-la-vista-temporary-par-70`: Backyard provisional, aggregate tee data
  supplied by the owner, no invented holes;
- `course-la-vista-temporary-par-69`: preserved provisional identity and
  aggregate tee data.

The legacy Par 69 hole array is not persisted because it says hole 6 is Par 3
while the owner confirmed the real hole is Par 4. Without a verified complete
18-hole configuration, this layout is marked
`MISSING_REAL_HOLE_CONFIGURATION` and cannot drive a round. This preserves the
layout without reproducing the prior capture workaround or inventing which
other hole changes keep total Par 69.

Reconciliation compares provider IDs plus par, tee names, yardage, rating and
slope. A similar name is never sufficient. A provisional layout remains
non-postable until a GHIN CourseId and score-posting TeeSetRatingId are both
explicitly confirmed.

## Score posting preparation

`lib/ghin/score-posting.ts` is a pure validation/idempotency layer for the GHIN
hole-by-hole contract at `/scores/hbh.json`. It requires the golfer, confirmed
course and tee IDs, exact side (`All18`, `F9` or `B9`), real date, gender, score
type, complete hole scores and a duplicate check against the live scoring
record. A SHA-256 payload fingerprint and service-only database claim prevent a
second POST.

There is intentionally no posting transport or public posting route in this
phase. The live GHIN client remains read-only. The QA database currently has no
completed, fully captured, unposted real round matching a confirmed Temporary
layout, so the controlled write test is `PENDING_REAL_SCORE_INPUT` and no POST
may be attempted.

## Flags

All capabilities are hard-locked to `VERCEL_ENV=preview`:

```text
NEXT_PUBLIC_BACKYARD_GHIN_INTEGRATION=true
GHIN_READ_ONLY_ENABLED=true
GHIN_GOLFER_LOOKUP_ENABLED=true
GHIN_COURSE_LOOKUP_ENABLED=true
GHIN_COURSE_SYNC_ENABLED=true
GHIN_SCORE_POSTING_ENABLED=false
```

Production stays off even if a stale granular variable is accidentally true.
The score-posting flag remains false until all of these are true at once:
confirmed GHIN Temporary mapping, real eligible score, live duplicate check and
explicit operator/user confirmation.

## GPA/vendor boundary

The normal golfer flow proves technical QA read access only. It does not prove
commercial entitlement for mass customer access or bulk course ingestion. The
separate GPA/vendor flow through `POST /users/login.json` remains
`BLOCKED_EXTERNAL` and must not be tested without authorized credentials and
entitlements.
