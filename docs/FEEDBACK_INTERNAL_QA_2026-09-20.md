# Internal support / course follow-up — 20 September 2026

> **EVIDENCIA HISTÓRICA — NO EJECUTAR COMO RUNBOOK.** La rama, el deployment y los runners descritos aquí fueron superados por [activación canónica](./PREVIEW_CONTROLLED_ACTIVATION.md) y [matriz de producto](./CANONICAL_PRODUCT_STATUS_2026-09-24.md). La única owner QA vigente es `integration/backyard-current` en `https://dev.thebackyard.com.mx`.

## Scope and identity

- Branch: `phase2/course-catalog-feedback`.
- Initial local and fetched remote SHA: `2c2b544cf7295b16135415f728d4c8a483cedf2b`.
- QA only: `bymeopxkxapfizeeqeyb`. No shared/Production database, main, beta, custom domains, DNS, Auth configuration or real historical data changed.
- Implementation commits: `a4d3fed` (internal support), `2766475` (seven verified locations and course UI); this document accompanies the final hardening/QA commit. The handoff gives the immutable deployment of that final commit.
- Initial remote verification deployment: `https://historical-preview-url-retired.invalid`, exact SHA `276647513ee48163e0223aaf6db7d7b1d34ed83d`. Final runners are repeatable against the final immutable Preview; they reject non-QA Supabase configuration.

## Delivered contract

Help is in **Más → Soporte → Ayuda y feedback**, with contextual course/equipment/bet entry points. The top Home link was removed without changing the hero. The form uses category cards, relevant fields, a visible close button, Cancel, dirty-close confirmation, loading/duplicate-submit protection and an internal receipt. It does not open Mail as its normal action.

DB receipt is authoritative. Notification success is independent. JPEG/PNG/WEBP attachments are optional, previewed locally, capped at 2 MiB and checked by MIME and signature. They upload only on submit to a **private** bucket. A failed upload leaves the durable request and allows exact-ID retry. A failed network request preserves the form and preview. No email delivery is claimed.

Authenticated identity is derived server-side. Anonymous requests have null ownership and a daily HMAC rate key, not a stored raw IP or location. Service-only submission RPC enforces same-ID/same-content replay and 10 requests/day. Owner reads exclude admin notes and anti-abuse/notification internals. Foreign reads/updates and public attachment downloads are denied.

### Additive migrations applied only to QA

1. `20260921002925_feedback_internal_requests.sql`: additive workflow fields, owner-column grants/RLS, service-only RPC, private bucket and owner-read policy.
2. `20260921013129_feedback_attachment_lifecycle.sql`: includes server-uploaded `feedback-private` objects in the existing leased account-deletion storage manifest. No deletion occurs in the migration; the archive path, grants and lease requirements remain unchanged.

Legacy feedback fields remain compatible. New workflow states are `NEW`, `IN_REVIEW`, `RESOLVED`, `REJECTED`. Notification states separately distinguish unavailable, pending, provider acceptance and failure. **Provider acceptance is not delivery.**

## Evidence

| Area | Status | Executed evidence |
|---|---|---|
| Internal feedback | PASS | Four API categories and four browser submissions: Campo, Bug, Bastón, Apuesta. Eight `NEW` records read back in QA. |
| Persistence/idempotency | PASS | Simultaneous identical POSTs create one row; changed or foreign replay rejected. New authenticated client reads the same records. Browser double click produced one request. |
| RLS | PASS | Real authenticated A/B requests: B cannot read/update A's feedback, invoke service-only RPC, read admin notes or download A's attachment. Public download denied. |
| Attachments | PASS | Two private PNG objects stored/read back. Browser preview before sending, network failure retains image and text, retry succeeds. Spoofed signature rejected. |
| Cleanup manifest | PASS | Actual replacement SQL executed in isolated PostgreSQL: A's service-uploaded image is included, B's excluded; invalid lease and archive rejected. QA readback retains service-role-only execution. No QA accounts deleted for this change. |
| Secondary mail | BLOCKED_EXTERNAL | Runtime capability is false; all eight requests are valid with `notification_status=UNAVAILABLE`. Unit tests also exercise provider rejection/exception without undoing receipt. No test email sent. |
| Close/reopen | PASS | Browser dirty close offers Continue writing/Discard; Continue retains content. X and Cancel remain available; successful receipt closes cleanly. |
| Mobile layout | PASS | Automated Chrome 390/430 px, Home/More/form visually inspected. No horizontal overflow, form scroll reaches CTA, sticky close remains visible. |
| Safari/PWA hardware | PENDING_DEVICE_QA | No physical iPhone, native keyboard, camera/gallery, safe-area or installed-PWA claim. |
| Course lookup | PASS | Real authenticated catalog API; La Vista and Campestre de Puebla, normalized/accent-insensitive search, real course/tee readback. |
| Nearby | PASS | Local distance calculation against real QA catalog at ten simulated locations; browser denied-permission fallback and simulated success display three distinct clubs then load course/tees. Device coordinates are not sent or persisted. |
| Rounds/cloud | PASS | Nine new synthetic rounds: full, score-only, total × 9H front, 9H back, 18H. Different tees per player, no fabricated hole scores for total-only, duplicate prevention and new-session readback. |
| Historical snapshots | PASS | Nine preexisting synthetic round hashes unchanged; stored tee snapshots remain unchanged after in-memory catalog mutation. Final read-only rerun checks the newly created rounds too. |
| Complete catalog | PENDING_DATA | 153 clubs / 176 courses / 769 tees. 91 located, 62 pending. 758 complete cards, 11 pending. No unverified rating category promoted or 18H rating divided. |

Local artifacts (ignored, no tokens in reports): `feedback-live-report.json`, `catalog-applied-cloud-report.json`, `feedback-final-tests.log`, `feedback-final-lint.log`, `feedback-final-build.log` under `.qa-artifacts/`.

Reproducible QA: `scripts/test-feedback-db.mjs` (10 actual SQL checks), `scripts/qa-feedback-live.mjs` (real isolated Preview API/RLS, existing synthetic users), `scripts/qa-course-catalog-live.mjs --verify-created` (readback, immutable history, search, geography). The feedback live runner explicitly refuses to send if a mail provider becomes available without separate email-test authorization.

Final local regression gate: **2,096 / 2,096 tests, zero failures/skips; TypeScript noEmit, ESLint and production-mode build pass**. Final immutable Preview/runtime are recorded in the handoff after completion.

## Geographic additions and limits

84 → **91 / 153** clubs. Seven updates, second application zero updates. Sources, URLs, dates, point type and matching evidence are in `data/course-location-support-closeout.json`; the remaining 62 identities are in `data/course-locations-pending.json`. These are actual club/map points, never city centroids. Existing coordinates are conflict-checked, not overwritten.

Added: Vista Verde Tehuacán, Las Parotas, Cabo Real, El Molino, Acapulco, PGA Riviera Maya and Tula/El Agrario. Official club/tourism sources are used where available; identified golf cartography/OSM and recognized golf sources are explicitly labelled otherwise.

| Simulated area | First three distinct clubs (straight-line km) |
|---|---|
| Puebla | La Vista 1.4 · Campestre Puebla 1.8 · Las Fuentes 7.8 |
| CDMX | Campestre CDMX 9.1 · El Copal 11.3 · Chapultepec 11.7 |
| Monterrey | Campestre Monterrey 4.5 · Valle Alto 12.2 · Las Cruces 24.4 |
| Guadalajara | Guadalajara CC 4.3 · Las Cañadas 12.8 · El Cielo 15.8 |
| Querétaro | Campestre Querétaro 3.4 · Zibatá 11.9 · Juriquilla 15.0 |
| León | Campestre León 5.3 · El Molino 7.9 · Hacienda León 8.4 |
| Cancún | Puerto Cancún 2.1 · Pok Ta Pok 7.7 · Playa Mujeres 11.0 |
| Los Cabos | Cabo San Lucas CC 1.5 · Quivira 5.5 · Solmar 10.6 |
| Puerto Vallarta | Marina Vallarta 3.5 · Paradise Village 7.6 · Punta Mita 33.9 |
| Acapulco | Turtle Dunes 2.4 · Vidanta 4.7 · Acapulco 6.4 |

### Eleven cards remain PENDING_DATA

- Alquerías Azules/Blancas: mixed-tee hole mapping missing; independent 9H rating conflict.
- Playa Mujeres Silver: official PDF omits hole 6 yardage; no subtraction from total to invent it.
- Las Parotas Azules and Blancas: official current rating/slope conflicts with inventory version; no mixed-version card.
- Naval Azules, Blancas and Doradas: physical nine-hole course, no verified eighteen-position card.
- Real del Catorce Blancas: contradictory 9/18-hole descriptions, no unambiguous tee-specific complete card.
- Zirándaro Amarillas, Azules and Blancas: physical nine-hole par-3 course, no verified per-tee two-round stroke-index card.

Existing six verified card additions remain applied (758 total); none added without evidence in this task. Earlier research and source links remain in `COURSE_LOCATION_FOLLOWUP_2026-09-20.md`; its older pending-apply statements are historical, superseded by the authorized application and current DB readback.

## Minimal private administration preparation

No public admin endpoint or new CRM. Authorized server/admin access can query `request_status`, `topic_key`, `category`, timestamps, `resolved_at` and `admin_notes`. For example, group by `(category, topic_key)` and count distinct `user_id` separately from anonymous requests to identify repeated requests. A repeated guest request must not be represented as a verified distinct user. Only privileged administration can update status/notes; normal users cannot resolve their own records.

## Remaining external/legal/device work

- Optional internal email notification: configure verified `FEEDBACK_RESEND_API_KEY` and `FEEDBACK_FROM_EMAIL` **only** in Vercel Preview scoped to `phase2/course-catalog-feedback`; alternatively valid existing group-mailer variables are supported. No Auth SMTP reuse, secret changes or test emails in this task. DB support works without these variables.
- Verify physical Safari/iPhone/PWA and native keyboard on 390/430-class devices.
- Obtain evidence for 62 club locations and the eleven cards above. Ambiguous rating categories remain pending.
- LEGAL_REVIEW_REQUIRED: support/attachment retention, privacy wording and commercial catalog data reuse; no legal approval is implied by technical QA.
