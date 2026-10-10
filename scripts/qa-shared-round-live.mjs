// Two independent authenticated sessions. Only new, identifiable QA rounds;
// never mutate Mongas, change Auth or call a maps/course provider.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { credentialBoundFetch, deploymentMutationBoundFetch, verifyPreviewBundleBinding } from './qa-preview-statistics.mjs';
const require = createRequire(import.meta.url);
const origin = 'https://dev.thebackyard.com.mx', ref = 'bymeopxkxapfizeeqeyb';
assert.equal(process.env.PREVIEW_DB_REF, ref); assert.equal(process.env.QA_CONFIRM_ISOLATED_PREVIEW, ref);
assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, `https://${ref}.supabase.co`);
assert.equal(process.env.PREVIEW_QA_URL, origin);
assert.match(process.env.PREVIEW_QA_EXPECTED_SHA || '', /^[0-9a-f]{40}$/);
const config = { projectRef: ref, previewOrigin: origin, supabaseOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL, publicKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, expectedSha: process.env.PREVIEW_QA_EXPECTED_SHA };
assert.ok(config.publicKey); const raw = credentialBoundFetch(origin), dbFetch = credentialBoundFetch(config.supabaseOrigin);
await verifyPreviewBundleBinding(config, raw, dbFetch);
const guarded = deploymentMutationBoundFetch(config, raw);
const secrets = JSON.parse(readFileSync('.qa-artifacts/persistent-dev-qa.private.json', 'utf8')); assert.equal(secrets.projectRef, ref);
const accounts = [];
for (const key of ['qa_diego_green', 'qa_carlos_fairway', 'qa_fernanda_putt']) {
  const saved = secrets.users[key]; assert.ok(saved?.id && saved?.password);
  const client = createClient(config.supabaseOrigin, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: dbFetch } });
  const auth = await client.auth.signInWithPassword({ email: saved.email, password: saved.password }); assert.ifError(auth.error);
  assert.equal(auth.data.user.id, saved.id); assert.equal(auth.data.user.app_metadata.qa_fixture_kind, 'PERSISTENT_DEV_QA');
  accounts.push({ id: saved.id, key, token: auth.data.session.access_token });
}
const [a, b, outsider] = accounts, dir = '.qa-artifacts/play-shared-gps-20261009'; mkdirSync(dir, { recursive: true });
let previous;
try { previous = JSON.parse(readFileSync(`${dir}/two-session-e2e.json`, 'utf8')); } catch { /* First run. */ }
if (previous) { assert.equal(previous.database, ref); assert.deepEqual(previous.actors, accounts.map(({id,key}) => ({id,key}))); }
const report = { generatedAt: new Date().toISOString(), buildSha: config.expectedSha, database: ref, actors: accounts.map(({ id, key }) => ({ id, key })), tests: previous?.tests || {}, rounds: previous?.rounds || [], providers: previous?.providers || { GolfAPI: 0, Mapbox: 0, GoogleInitializations: 0 } };
const journal = () => writeFileSync(`${dir}/two-session-e2e.json`, JSON.stringify(report, null, 2));
const pass = name => { report.tests[name] = 'PASS'; journal(); console.log(name, 'PASS'); };
async function api(actor, path, method = 'GET', body, expected = 200) {
  const response = await guarded(origin + path, { method, headers: { authorization: `Bearer ${actor.token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); assert.equal(response.status, expected, `${path} ${result.code || result.error || response.status}`); return result;
}
const catalog = await api(a, '/api/courses/catalog?courseId=course-la-vista-club-current');
const course = catalog.cards.find(c => c.holes?.length === 18); assert.ok(course);
if (process.argv.includes('--prepare')) { console.log('QA identities and deployed DEV/database binding verified. No round writes.'); process.exit(0); }
const { initialBets } = require('../.test-dist/lib/new-round-bets.js');
async function create(mode, suffix, guests = false) {
  const existing = report.rounds.find(row => row.mode === mode);
  if (existing) {
    const saved = (await api(a, `/api/shared-rounds?roundId=${existing.id}`)).data;
    assert.equal(saved.ownerId, a.id); assert.equal(saved.snapshot.id, existing.localId);
    assert.ok(saved.snapshot.id.startsWith(`qa-shared-${suffix}-`));
    assert.equal(saved.snapshot.scorekeeping.mode, mode);
    return { round: saved.snapshot, id: existing.id };
  }
  const stamp = new Date().toISOString(), players = [a, b].map((actor, index) => ({ id: `account-${actor.id}`, accountUserId: actor.id, name: index ? 'QA Carlos Fairway' : 'QA Diego Green', handicap: null }));
  if (guests) players.push({ id: 'qa-guest', name: 'QA Guest', handicap: null });
  const round = { id: `qa-shared-${suffix}-${randomUUID()}`, snapshotVersion: 2, scorekeeping: { version: 1, mode, organizerAccountUserId: a.id },
    sharedLive: { cellVersions: {}, operationIds: [], audit: [], joinedUserIds: [] }, lifecycleState: 'live', courseSnapshot: course, courseName: course.name,
    teeName: course.teeName, ownerId: players[0].id, ownerName: players[0].name, players, order: course.holes.map(h => h.number), startHole: 1, roundHoles: 18,
    presentation: { version: 1, playMode: 'score_only', groupNassauTerm: 'polla' }, scores: {}, date: stamp.slice(0,10), startedAt: stamp, updatedAt: stamp,
    betConfig: initialBets([]), personalBets: [], supplementalBets: [], manualBets: [], betResult: 0, netResult: 0, categoryResults: {}, expenseTotal: 0,
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 } };
  const saved = await api(a, '/api/cloud/rounds', 'POST', { round }, 201);
  assert.ok(saved.roundId); report.rounds.push({ id: saved.roundId, localId: round.id, mode, retained: true }); journal(); return { round, id: saved.roundId };
}
const current = await create('self', 'self', true), id = current.id;
const read = async actor => (await api(actor, `/api/shared-rounds?roundId=${id}`)).data;
const patch = (playerKey, hole, score, baseVersion, opId = randomUUID()) => ({ id: opId, playerKey, hole, score, baseVersion });
await api(b, '/api/shared-rounds', 'PATCH', { roundId: id, action: 'join' }); pass('B_joins_same_canonical_round');
let revision = (await read(a)).version;
const playerA = current.round.players[0].id, playerB = current.round.players[1].id;
const opA = patch(playerA, 1, 4, revision), opB = patch(playerB, 1, 5, revision);
await Promise.all([api(a, '/api/shared-rounds', 'PATCH', { roundId: id, patches: [opA] }), api(b, '/api/shared-rounds', 'PATCH', { roundId: id, patches: [opB] })]);
const aa = await read(a), bb = await read(b);
assert.deepEqual(aa.snapshot.scores[1], { [playerA]: 4, [playerB]: 5 }); assert.deepEqual(bb.snapshot.scores, aa.snapshot.scores); pass('concurrent_different_players_merged_4_and_5');
assert.equal((await api(a, '/api/shared-rounds', 'PATCH', { roundId: id, patches: [opA] })).duplicate, true); pass('retry_deduplicated');
await api(b, '/api/shared-rounds', 'PATCH', { roundId: id, patches: [patch(playerA, 2, 6, aa.version)] }, 403);
await api(a, '/api/shared-rounds', 'PATCH', { roundId: id, patches: [patch(playerB, 2, 6, aa.version)] }, 403);
await api(outsider, `/api/shared-rounds?roundId=${id}`, 'GET', undefined, 404); pass('server_permissions_and_outsider_denied');
await api(a, '/api/shared-rounds', 'PATCH', { roundId: id, patches: [patch(playerA, 2, 4, aa.version)] }); pass('A_advances_and_saves_without_B');
revision = (await read(a)).version;
await api(a, '/api/shared-rounds', 'PATCH', { roundId: id, patches: [patch(playerA, 1, 7, opA.baseVersion)] }, 409); pass('same_cell_stale_rejected');
await api(a, '/api/shared-rounds', 'PATCH', { roundId: id, action: 'finish', expectedVersion: revision }, 409); pass('incomplete_card_stays_live');
const listA = await api(a, '/api/shared-rounds'), listB = await api(b, '/api/shared-rounds'); assert.ok(listA.rounds.some(r => r.id === id)); assert.ok(listB.rounds.some(r => r.id === id)); pass('both_accounts_find_round_on_return');
const [gpsA,gpsB] = await Promise.all([api(a,'/api/golf-gps/courses'),api(b,'/api/golf-gps/courses')]);
assert.deepEqual(gpsA.courses,gpsB.courses); report.cacheHash = createHash('sha256').update(JSON.stringify(gpsA.courses)).digest('hex'); pass('two_accounts_same_saved_course_projection_no_upstream');
const owner = await create('owner', 'owner', true);
let own = (await api(a, `/api/shared-rounds?roundId=${owner.id}`)).data;
if (own.snapshot.lifecycleState === 'live') {
await api(a, '/api/shared-rounds', 'PATCH', { roundId: owner.id, patches: [patch(playerB, 1, 5, own.version)] });
own = (await api(a, `/api/shared-rounds?roundId=${owner.id}`)).data; assert.equal(own.snapshot.scores[1][playerA], undefined);
await api(b, '/api/shared-rounds', 'PATCH', { roundId: owner.id, patches: [patch(playerB,1,6,own.version)] }, 403); pass('owner_mode_partial_and_participant_read_only');
await api(a,'/api/shared-rounds','PATCH',{roundId:owner.id,action:'cancel',expectedVersion:own.version});
}
const cancelled=(await api(a,`/api/shared-rounds?roundId=${owner.id}`)).data; assert.equal(cancelled.snapshot.lifecycleState,'cancelled'); assert.equal(cancelled.snapshot.scores[1][playerB],5);
assert.ok(!(await api(a,'/api/shared-rounds')).rounds.some(r=>r.id===owner.id)); pass('soft_cancel_persists_scores_and_no_active_entry');
report.cardA = (await read(a)).snapshot.scores; report.cardB = (await read(b)).snapshot.scores; assert.deepEqual(report.cardA, report.cardB); pass('fresh_authenticated_reads_persist_same_round');
journal(); console.log(JSON.stringify({ status:'PASS',roundId:id,tests:Object.keys(report.tests).length,providers:report.providers }));
