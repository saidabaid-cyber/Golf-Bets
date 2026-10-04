import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
export const FIXTURE_KIND = "PERSISTENT_DEV_QA";
export const FIXTURE_VERSION = 1;
export const QA_PLAYERS = Object.freeze([
  { key: "qa_diego_green", name: "QA Diego Green", hcp: 4.8, email: "qa-diego-green@example.invalid", club: "La Vista Country Club", hand: "right" },
  { key: "qa_carlos_fairway", name: "QA Carlos Fairway", hcp: 8.2, email: "qa-carlos-fairway@example.invalid", club: "La Vista Country Club", hand: "right" },
  { key: "qa_mariana_birdie", name: "QA Mariana Birdie", hcp: 12.4, email: "qa-mariana-birdie@example.invalid", club: "Club Campestre de Puebla", hand: "left" },
  { key: "qa_arturo_bunker", name: "QA Arturo Bunker", hcp: 18.1, email: "qa-arturo-bunker@example.invalid", club: "Club Campestre de Puebla", hand: "right" },
  { key: "qa_fernanda_putt", name: "QA Fernanda Putt", hcp: 24.6, email: "qa-fernanda-putt@example.invalid", club: "La Vista Country Club", hand: "right" },
]);
export function fixtureMetadata(fixture) {
  return { qa_fixture_kind: FIXTURE_KIND, qa_fixture_version: FIXTURE_VERSION, qa_fixture_key: fixture.key };
}
export function assertFixtureOwner(user, fixture) {
  assert.equal(user?.email, fixture.email, "QA_IDENTITY_EMAIL_MISMATCH");
  assert.equal(user?.app_metadata?.qa_fixture_kind, FIXTURE_KIND, "QA_IDENTITY_KIND_MISMATCH");
  assert.equal(user?.app_metadata?.qa_fixture_version, FIXTURE_VERSION, "QA_IDENTITY_VERSION_MISMATCH");
  assert.equal(user?.app_metadata?.qa_fixture_key, fixture.key, "QA_IDENTITY_KEY_MISMATCH");
  assert.match(user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "QA_IDENTITY_UUID_INVALID");
}
export function resolveExistingFixture(users, fixture) {
  const matches = users.filter(user => user.app_metadata?.qa_fixture_key === fixture.key || user.email === fixture.email || user.user_metadata?.username === fixture.key);
  assert.ok(matches.length <= 1, "QA_DUPLICATE_AUTH_IDENTITY");
  if (matches[0]) assertFixtureOwner(matches[0], fixture);
  return matches[0] || null;
}
export async function ensurePersistentQaAccounts({ admin, createUserClient, authorize, secrets, persistPrivate }) {
  const checked = (result, label) => { if (result.error) throw new Error(`QA_FAILED_${label}`); return result.data; };
  const inventory = [];
  for (let page = 1; page <= 100; page++) {
    const data = checked(await admin.auth.admin.listUsers({ page, perPage: 200 }), "AUTH_INVENTORY");
    inventory.push(...data.users.filter(user => QA_PLAYERS.some(f => user.app_metadata?.qa_fixture_key === f.key || user.email === f.email || user.user_metadata?.username === f.key)));
    if (data.users.length < 200) break;
    if (page === 100) throw new Error("QA_AUTH_INVENTORY_BOUND_EXCEEDED");
  }
  const accounts = [];
  for (const fixture of QA_PLAYERS) {
    let user = resolveExistingFixture(inventory, fixture);
    if (!user) {
      const plan = secrets.users[fixture.key] ||= { id: randomUUID(), email: fixture.email, password: `Qa!${randomBytes(32).toString("base64url")}` };
      assert.equal(plan.email, fixture.email);
      await persistPrivate();
      await authorize();
      user = checked(await admin.auth.admin.createUser({ id: plan.id, email: fixture.email, password: plan.password, email_confirm: true,
        app_metadata: fixtureMetadata(fixture), user_metadata: { display_name: fixture.name, username: fixture.key } }), "CREATE_SYNTHETIC_USER").user;
      assert.equal(user.id, plan.id);
      inventory.push(user);
    }
    assertFixtureOwner(user, fixture);
    if (!user.email_confirmed_at) { await authorize(); user = checked(await admin.auth.admin.updateUserById(user.id, { email_confirm: true }), "CONFIRM_SYNTHETIC_EMAIL").user; }
    const secret = secrets.users[fixture.key];
    assert.ok(secret?.password && secret.id === user.id && secret.email === fixture.email, "QA_PRIVATE_LOGIN_REQUIRED_NO_PASSWORD_RESET");
    const account = { ...fixture, id: user.id, client: createUserClient() };
    const login = checked(await account.client.auth.signInWithPassword({ email: fixture.email, password: secret.password }), "SYNTHETIC_LOGIN");
    assert.equal(login.user.id, user.id); account.token = login.session.access_token;
    accounts.push(account);
  }
  return accounts;
}
export function domain() {
  return { ...require("../../.test-dist/lib/engine.js"), ...require("../../.test-dist/lib/new-round-bets.js"),
    ...require("../../.test-dist/lib/group-game-template.js"), ...require("../../.test-dist/lib/frequent-templates.js"),
    ...require("../../.test-dist/lib/golf-insights.js"), ...require("../../.test-dist/lib/bets/registry.js"),
    ...require("../../.test-dist/lib/admin-bet-variants.js"), ...require("../../.test-dist/lib/settlement-integrity.js"),
    ...require("../../.test-dist/lib/social-connections.js"), ...require("../../.test-dist/lib/account-primary-player.js"),
    ...require("../../.test-dist/lib/historical-round-recap.js"), ...require("../../.test-dist/lib/legal-evidence.js") };
}
export function selectedQaVariants(variants, playerCount) {
  const d = domain();
  const eligible = variants.filter(item => item.active === true && playerCount >= item.minPlayers && playerCount <= item.maxPlayers && d.betVariantCapability(item.engine));
  const priority = eligible.some(item => item.engine === "individual_nassau")
    ? ["individual_nassau", "polla_total", "skins"] : ["polla_first", "polla_second", "polla_total", "skins"];
  return priority.flatMap(engine => eligible.find(item => item.engine === engine) ? [eligible.find(item => item.engine === engine)] : []).slice(0, 3);
}
export function availableQaVariants(published) {
  if (published.length) return published;
  const d = domain(), selectable = d.groupTemplateSelectionDefinitions();
  // Published variants are optional presets. The existing GroupBuilder still
  // offers built-in registered games when that catalog is empty. Use the same
  // capability defaults, not a new game or a newly published Admin variant.
  return ["individual_nassau", "polla_total", "skins"].flatMap(engine => {
    const visible = selectable.some(item => item.id === (engine === "individual_nassau" ? "personals" : engine));
    const capability = d.betVariantCapability(engine);
    return visible && capability ? [{ id: `qa-builtin-${engine}`, version: 1, engine, title: capability.label, description: capability.definition.description,
      active: true, order: 0, minPlayers: capability.minimum, maxPlayers: capability.maximum, config: capability.defaults, source: "EXISTING_GROUP_BUILDER_REGISTRY" }] : [];
  });
}
export function qaGroup(accounts, count, variants = [], now = new Date().toISOString()) {
  const d = domain();
  const selected = accounts.slice(0, count);
  assert.equal(selected.length, count);
  const group = { id: `persistent-dev-qa-v1-${count === 4 ? "foursome" : "five"}`, name: count === 4 ? "QA Foursome" : "QA Five", privacy: "private", uses: 0, updatedAt: now,
    players: selected.map(account => ({ memberId: `account-${account.id}`, accountUserId: account.id, kind: "account", name: account.name, username: account.key, handicap: account.hcp })) };
  group.gameTemplate = d.createEmptyGroupGameTemplate(group);
  const players = d.groupTemplatePlayers(group);
  // Only enabled catalog variants with real, registered adapters. No manual winnings.
  for (const variant of selectedQaVariants(variants, players.length)) {
    const applied = d.applyBetVariant(group.gameTemplate.betConfig, players, players[0].id, variant, 18, 1, players[1]?.id);
    group.gameTemplate.betConfig = applied.bets;
    if (applied.personal) group.gameTemplate.personalBets.push({ ...applied.personal, id: `${group.id}-personal-nassau` });
  }
  return d.parseFrequentGroups(d.serializeFrequentGroups([group]))[0];
}
export function qaRound({ id, accounts, course, completedAt, holes = 18, group = null, variation = 0 }) {
  const d = domain();
  assert.ok(course?.catalogCourseId && course.catalogTeeId, "REAL_CATALOG_TEE_REQUIRED");
  assert.equal(course.holes.length, 18, "REAL_18_HOLE_CARD_REQUIRED");
  assert.ok(holes === 9 || holes === 18, "QA_ROUND_GEOMETRY_REQUIRED");
  assert.equal(new Set(accounts.map(a => a.id)).size, accounts.length, "DUPLICATE_QA_PLAYER");
  const players = accounts.map(account => ({ id: d.accountPrimaryPlayerId(account.id), accountUserId: account.id, name: account.name, handicap: account.hcp, handicapIndex: account.hcp, handicapSource: "manual", handicapIndexSource: "BACKYARD_MANUAL" }));
  const order = d.playOrder(1).slice(0, holes);
  const scores = Object.fromEntries(order.map((number, holeIndex) => {
    const par = course.holes.find(hole => hole.number === number)?.par;
    assert.ok(Number.isInteger(par) && par >= 3 && par <= 6, "REAL_PAR_REQUIRED");
    return [number, Object.fromEntries(accounts.map((account, index) => {
      const phase = (holeIndex * 7 + index * 3 + variation * 5) % 18;
      const extra = phase === 0 ? -1 : phase < 9 - Math.floor(account.hcp / 6) ? 0 : phase < 16 ? 1 : 2;
      return [players[index].id, Math.max(2, par + extra)];
    }))];
  }));
  const putts = Object.fromEntries(order.map((number, index) => [number, Object.fromEntries(players.map((player, p) => [player.id, (index + p + variation) % 9 === 0 ? 1 : (index + p) % 11 === 0 ? 3 : 2]))]));
  const loaded = group ? d.instantiateGroupGameTemplate(group, randomUUID) : null;
  // Account IDs are stable when instantiating the existing template.
  if (loaded) assert.deepEqual(loaded.players.map(p => p.id), players.map(p => p.id), "GROUP_PLAYER_IDS_CHANGED");
  const bets = loaded?.bets || d.initialBets(players.map(player => player.id));
  const personalBets = loaded?.personalBets || [];
  const polla = d.calculatePolla(course, scores, players, bets.polla, order);
  const skins = d.calculateSkins(course, scores, players, bets.skins, order);
  const personals = d.calculatePersonalBets(personalBets, players[0].id, players, course, scores, order);
  const skinBalances = d.payoutWinnerTakesFromAll(players.filter(player => bets.skins.participantIds.includes(player.id)), skins.won, bets.skins.value);
  const balances = d.mergeBalances(players, polla.balances, skinBalances, personals.balances);
  assert.ok(d.isFiniteZeroSum(Object.values(balances)), "INVALID_QA_SETTLEMENT");
  const transfers = d.settleBalances(balances);
  assert.ok(transfers.every(t => t.fromPlayerId !== t.toPlayerId && Number.isFinite(t.amount) && t.amount > 0), "INVALID_QA_TRANSFER");
  const expenses = { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 };
  const owner = players[0], ownerResult = balances[owner.id] || 0;
  const round = { id, snapshotVersion: 2, lifecycleState: "completed", date: completedAt.slice(0, 10), startedAt: completedAt, completedAt, updatedAt: completedAt,
    courseName: course.name, teeName: course.teeName, ownerName: owner.name, ownerId: owner.id, accountUserId: accounts[0].id, roundHoles: holes, startHole: 1, handicapBasis: "relative",
    courseSnapshot: structuredClone(course), players, order, scores, putts, scoreCaptureMode: "quick", presentation: { version: 1, groupNassauTerm: "nassau", ...(!group ? { playMode: "score_only" } : {}) },
    betConfig: bets, personalBets, manualBets: [], supplementalBets: [], segments: loaded?.segments || [],
    betResult: ownerResult, netResult: ownerResult, expenseTotal: 0, expenses, playerBalances: balances,
    categoryBalances: { polla: polla.balances, skins: skinBalances, Personales: personals.balances }, categoryResults: { polla: polla.balances[owner.id] || 0, skins: skinBalances[owner.id] || 0, Personales: personals.balances[owner.id] || 0 },
    resultDetails: { polla, skins, personals, settlementTransfers: transfers },
    ...(loaded ? { groupOrigin: { groupId: group.id, groupName: group.name, basedOnUpdatedAt: group.updatedAt,
      selectedMembers: group.players.map(member => ({ memberId: member.memberId, name: member.name, roundPlayerId: d.accountPrimaryPlayerId(member.accountUserId) })) } } : {}) };
  assert.deepEqual(d.buildHistoricalRoundRecap(round).issues, [], "QA_ROUND_RECAP_INVALID");
  return round;
}
