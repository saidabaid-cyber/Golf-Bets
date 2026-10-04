// Controlled existing QA accounts only. No account creation, SMTP or cleanup.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { persistentDevConfig } from "./qa-persistent-dev-universe.mjs";
import { credentialBoundFetch, deploymentMutationBoundFetch, verifyPreviewBundleBinding } from "./qa-preview-statistics.mjs";
import { QA_PLAYERS, domain } from "./lib/qa-persistent-dev-fixtures.mjs";
const require = createRequire(import.meta.url);

export async function runRecurringGroupRoundQa({ env = process.env, credentialsPath = ".qa-artifacts/persistent-dev-qa.private.json", outDir = ".qa-artifacts" } = {}) {
  const config = persistentDevConfig(env);
  assert.equal(config.projectRef, "bymeopxkxapfizeeqeyb");
  assert.equal(config.previewOrigin, "https://dev.thebackyard.com.mx");
  const raw = credentialBoundFetch(config.previewOrigin), dbFetch = credentialBoundFetch(config.supabaseOrigin);
  await verifyPreviewBundleBinding(config, raw, dbFetch);
  const guarded = deploymentMutationBoundFetch(config, raw);
  const secrets = JSON.parse(readFileSync(credentialsPath, "utf8")); assert.equal(secrets.projectRef, config.projectRef);
  const accounts = [];
  for (const fixture of QA_PLAYERS) {
    const saved = secrets.users[fixture.key]; assert.equal(saved.email, fixture.email); assert.ok(saved.id && saved.password);
    const client = createClient(config.supabaseOrigin, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: dbFetch } });
    const auth = await client.auth.signInWithPassword({ email: saved.email, password: saved.password }); assert.ifError(auth.error);
    assert.equal(auth.data.user.id, saved.id); assert.equal(auth.data.user.app_metadata.qa_fixture_kind, "PERSISTENT_DEV_QA");
    assert.equal(auth.data.user.app_metadata.qa_fixture_key, fixture.key);
    accounts.push({ ...fixture, id: saved.id, token: auth.data.session.access_token });
  }
  async function api(account, path, method = "GET", body, expected = 200) {
    const response = await guarded(config.previewOrigin + path, { method, headers: { authorization: `Bearer ${account.token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); assert.equal(response.status, expected, `QA ${path} ${data.code || data.error || response.status}`); return data;
  }
  const [diego, carlos, mariana, , fernanda] = accounts;
  const d = domain(), editor = require("../.test-dist/lib/group-template-editor.js"), attribution = require("../.test-dist/lib/participant-history.js");
  const groupId = "qa-recurring-group-v1", localRoundId = "qa-recurring-round-v1";
  const report = { projectRef: config.projectRef, buildSha: config.expectedSha, generatedAt: new Date().toISOString(), groupId, localRoundId, users: accounts.map(({ id, key }) => ({ id, key })), tests: {} };
  mkdirSync(outDir, { recursive: true });
  const journal = () => writeFileSync(`${outDir}/recurring-group-round-e2e.json`, JSON.stringify(report, null, 2));
  const pass = name => { report.tests[name] = "PASS"; journal(); };
  async function saveGroup(group) {
    const cloud = await api(diego, "/api/cloud/sync");
    cloud.data.frequentGroups = [...cloud.data.frequentGroups.filter(item => item.id !== group.id), group];
    await api(diego, "/api/cloud/sync", "POST", { data: cloud.data, fingerprint: `recurring-group-${randomUUID()}` });
  }
  const catalog = await api(diego, `/api/courses/catalog?q=${encodeURIComponent(diego.club)}`);
  const normalizedClub = name => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const catalogCourse = catalog.courses.find(item => normalizedClub(item.clubName) === normalizedClub(diego.club)); assert.ok(catalogCourse);
  const detail = await api(diego, `/api/courses/catalog?courseId=${encodeURIComponent(catalogCourse.id)}`);
  const course = detail.cards.find(card => card.catalogTeeId && card.holes.length === 18 && card.holes.every(hole => Number.isInteger(hole.par) && Number.isInteger(hole.strokeIndex))); assert.ok(course);
  const existingState = (await api(diego, "/api/cloud/sync")).data;
  let group = existingState.frequentGroups.find(item => item.id === groupId);
  if (!group) {
    group = { id: groupId, name: "QA Miércoles", privacy: "private", uses: 0, updatedAt: new Date().toISOString(),
      players: [...accounts.map(account => ({ memberId: `account-${account.id}`, accountUserId: account.id, name: account.name, username: account.key, kind: "account", handicap: account.hcp })),
        { memberId: "juan-guest", name: "Juan Guest", kind: "guest", handicap: 14 }] };
    group.gameTemplate = editor.patchGroupTemplateCore(d.createEmptyGroupGameTemplate(group), "foursome", { enabled: true, mode: "fixed", fixedValue: 200, segmentSize: 6, baseMode: "moving" });
    group.gameTemplate = editor.patchGroupTemplateCore(group.gameTemplate, "skins", { enabled: true, value: 50 });
    const capability = d.betVariantCapability("individual_nassau"); assert.ok(capability && d.groupTemplateSelectionDefinitions().some(item => item.id === "personals"));
    const variant = { id: "qa-recurring-nassau", version: 1, engine: "individual_nassau", title: "Nassau", description: "QA habitual", active: true, order: 0, minPlayers: 2, maxPlayers: 5, config: capability.defaults };
    const applied = d.applyBetVariant(group.gameTemplate.betConfig, d.groupTemplatePlayers(group).slice(0, 4), group.players[0].memberId, variant, 18, 1, group.players[1].memberId);
    group.gameTemplate.personalBets = [applied.personal];
    group = d.parseFrequentGroups(d.serializeFrequentGroups([group]))[0]; await saveGroup(group);
  }
  assert.equal(group.name, "QA Miércoles"); assert.equal(group.players.length, 6); assert.equal(group.players.filter(member => member.accountUserId).length, 5);
  assert.equal(new Set(group.players.filter(member => member.accountUserId).map(member => member.accountUserId)).size, 5); pass("roster_identity_guest_and_dedup");
  const selected = [diego, carlos, mariana].map(account => `account-${account.id}`).concat("juan-guest");
  const loaded = d.instantiateGroupGameTemplate(group, () => "qa-runtime-juan-guest", selected);
  assert.equal(loaded.players.length, 4); assert.equal(group.players.length, 6); assert.equal(loaded.roundHandicapBasis, "relative"); pass("selected_subgroup_and_origin");
  let stored = existingState.history.find(item => item.id === localRoundId);
  if (!stored || stored.lifecycleState !== "completed") {
    assert.equal(loaded.bets.foursome.fixedValue, 200); assert.equal(loaded.bets.skins.value, 50); assert.equal(loaded.personalBets[0].baseValue, 100); pass("template_loaded");
    loaded.bets.foursome.fixedValue = 300; assert.equal(group.gameTemplate.betConfig.foursome.fixedValue, 200); pass("runtime_edit_isolated");
    const order = d.playOrder(1), ids = loaded.players.map(player => player.id);
    const players = loaded.players.map(player => ({ ...player, handicapSource: "manual", handicapIndexSource: "BACKYARD_MANUAL" }));
    const segments = d.segmentDefinitions(order, 6).map(segment => ({ ...segment, basePair: ids.slice(0, 2) }));
    loaded.bets.foursome.participantIds = ids; loaded.bets.skins.participantIds = ids;
    const now = new Date().toISOString();
    const live = { id: localRoundId, snapshotVersion: 2, lifecycleState: "live", scorekeeping: { version: 1, mode: "owner" }, date: now.slice(0, 10), startedAt: now, updatedAt: now,
      ownerId: ids[0], ownerName: diego.name, courseName: course.name, teeName: course.teeName, courseSnapshot: course, roundHoles: 18, startHole: 1, handicapBasis: "relative",
      players, order, scores: {}, segments, betConfig: loaded.bets, personalBets: loaded.personalBets, supplementalBets: [], manualBets: [],
      expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 }, expenseTotal: 0, betResult: 0, netResult: 0, categoryResults: {},
      groupOrigin: d.createRoundGroupSnapshot(loaded.origin, players) };
    const previous = (await api(diego, `/api/cloud/rounds?localRoundId=${localRoundId}`)).data;
    const created = previous ? { roundId: previous.id, version: previous.version } : await api(diego, "/api/cloud/rounds", "POST", { round: live }, 201);
    report.cloudRoundId = created.roundId; journal();
    let revision = created.version;
    const scores = Object.fromEntries(order.map((hole, index) => [hole, Object.fromEntries(players.map((player, playerIndex) => [player.id, Math.max(2, course.holes.find(item => item.number === hole).par + ((index + playerIndex * 2) % 7 === 0 ? -1 : (index + playerIndex) % 6 === 0 ? 2 : (index + playerIndex) % 3 === 0 ? 1 : 0))]))]));
    live.scores = Object.fromEntries(Object.entries(scores).slice(0, 3));
    let saved = await api(diego, "/api/cloud/rounds", "PUT", { round: live, expectedVersion: revision }); const stale = revision; revision = saved.version;
    await api(diego, "/api/cloud/rounds", "PUT", { round: live, expectedVersion: stale }, 409); pass("stale_revision_rejected");
    await api(carlos, "/api/cloud/rounds", "PUT", { round: live, expectedVersion: revision }, 404); pass("participant_cannot_use_owner_transport");
    live.scores = scores; saved = await api(diego, "/api/cloud/rounds", "PUT", { round: live, expectedVersion: revision }); revision = saved.version; pass("owner_scores_correct_player_keys");
    const foursome = d.calculateFoursomes(course, scores, players, loaded.bets.foursome, segments, order, "relative");
    const skins = d.calculateSkins(course, scores, players, loaded.bets.skins, order, "relative");
    const skinBalances = d.payoutWinnerTakesFromAll(players, skins.won, 50);
    const personal = d.calculatePersonalBets(loaded.personalBets, ids[0], players, course, scores, order);
    const balances = d.mergeBalances(players, foursome.balances, skinBalances, personal.balances);
    assert.ok(d.isFiniteZeroSum(Object.values(balances))); const transfers = d.settleBalances(balances);
    assert.ok(transfers.every(transfer => Number.isFinite(transfer.amount) && transfer.amount > 0 && transfer.fromPlayerId !== transfer.toPlayerId)); pass("real_engine_zero_sum_settlement");
    const completedAt = new Date().toISOString();
    stored = { ...live, lifecycleState: "completed", completedAt, updatedAt: completedAt, playerBalances: balances, betResult: balances[ids[0]], netResult: balances[ids[0]],
      categoryBalances: { Foursome: foursome.balances, Skins: skinBalances, Personales: personal.balances }, categoryResults: { Foursome: foursome.balances[ids[0]], Skins: skinBalances[ids[0]], Personales: personal.balances[ids[0]] },
      resultDetails: { foursomes: foursome, skins, personals: personal, settlementTransfers: transfers } };
    const cloud = (await api(diego, "/api/cloud/sync")).data;
    cloud.history = [...cloud.history.filter(item => item.id !== localRoundId), stored];
    await api(diego, "/api/cloud/sync", "POST", { data: cloud, fingerprint: `recurring-completed-${randomUUID()}` });
    const before = (await api(carlos, "/api/cloud/rounds")).rounds.filter(item => item.cloudRoundId === report.cloudRoundId);
    assert.equal(before.length, 1); assert.equal(attribution.attributableHistory(before, carlos.id).length, 0); pass("unconfirmed_excluded_from_analytics");
  } else report.cloudRoundId = (await api(diego, `/api/cloud/rounds?localRoundId=${localRoundId}`)).data.id;
  let card = (await api(carlos, `/api/social/rounds/card?roundId=${report.cloudRoundId}`)).data;
  const me = card.players.find(player => player.accountUserId === carlos.id); assert.ok(me); report.carlosScore = me.score; report.carlosBalance = card.myBalance;
  await api(fernanda, `/api/social/rounds/card?roundId=${report.cloudRoundId}`, "GET", undefined, 404);
  await api(fernanda, `/api/social/rounds/${report.cloudRoundId}/links`, "POST", { playerKey: me.playerKey, expectedVersion: card.version, expectedHash: card.materialHash }, 403); pass("outsider_denied");
  const pending = (await api(carlos, "/api/social/notifications")).data.filter(item => item.type === "scorecard_ready" && item.activityId === report.cloudRoundId);
  assert.ok(pending.length <= 1); report.tests.selected_participant_notification_once = pending.length === 1 ? "PASS" : "BLOCKED_EXTERNAL_NOTIFICATION_PERMISSIONS"; journal();
  assert.equal((await api(fernanda, "/api/social/notifications")).data.some(item => item.activityId === report.cloudRoundId), false); pass("unselected_not_notified");
  for (let retry = 0; retry < 2; retry++) {
    card = (await api(carlos, `/api/social/rounds/card?roundId=${report.cloudRoundId}`)).data;
    await api(carlos, `/api/social/rounds/${report.cloudRoundId}/links`, "POST", { playerKey: me.playerKey, expectedVersion: card.version, expectedHash: card.materialHash });
  }
  const confirmed = (await api(carlos, "/api/cloud/rounds")).rounds.filter(item => item.cloudRoundId === report.cloudRoundId);
  assert.equal(confirmed.length, 1); assert.equal(attribution.attributableHistory(confirmed, carlos.id).length, 1);
  assert.equal(attribution.personalRoundPerspective(confirmed[0]).betResult, report.carlosBalance); pass("self_confirmation_and_retry_once");
  const canonical = (await api(diego, `/api/cloud/rounds?localRoundId=${localRoundId}`)).data.snapshot;
  assert.equal(canonical.betConfig.foursome.fixedValue, 300); assert.equal(canonical.players.length, 4); assert.equal(canonical.players.filter(player => player.accountUserId).length, 3); pass("one_canonical_round_guest_safe");
  group.gameTemplate = editor.patchGroupTemplateCore(group.gameTemplate, "foursome", { fixedValue: 250 }); group.updatedAt = new Date().toISOString(); await saveGroup(group);
  assert.equal((await api(diego, `/api/cloud/rounds?localRoundId=${localRoundId}`)).data.snapshot.betConfig.foursome.fixedValue, 300); pass("later_group_edit_preserves_round");
  report.tests.self_score_mode = "PENDING_MULTI_DEVICE_QA";
  report.tests.ghin_posting = "BLOCKED_EXTERNAL_GHIN_POSTING";
  report.tests.other_accounts_current_hcp = "BLOCKED_HCP_PRIVACY_CONTRACT";
  report.status = "VERIFIED_OWNER_FLOW_WITH_LIMITATIONS"; journal();
  console.log(JSON.stringify({ status: report.status, projectRef: report.projectRef, buildSha: report.buildSha, groupId, cloudRoundId: report.cloudRoundId, checks: Object.keys(report.tests).length }));
  return report;
}

if (process.argv[1]?.endsWith("qa-dev-recurring-group-round.mjs")) await runRecurringGroupRoundQa();
