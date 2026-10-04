// Persistent synthetic DEV only. No cleanup, SMTP, OTP, Auth configuration or secret rotation.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { credentialBoundFetch, deploymentMutationBoundFetch, previewStatisticsConfig, verifyPreviewBundleBinding, verifyPreviewDeploymentIdentity } from "./qa-preview-statistics.mjs";
import { QA_PLAYERS, ensurePersistentQaAccounts, selectedQaVariants, availableQaVariants, qaGroup, qaRound, domain } from "./lib/qa-persistent-dev-fixtures.mjs";
const require = createRequire(import.meta.url);
const PROJECT_REF = "bymeopxkxapfizeeqeyb";
const checked = (result, label) => { if (result.error) throw new Error(`QA_FAILED_${label}`); return result.data; };
export function persistentDevConfig(env) {
  try { return previewStatisticsConfig(env); }
  catch (error) {
    const adminMissing = error.message === "Preview secret/service-role key is required.";
    throw Object.assign(new Error(adminMissing ? "The configured DEV Auth Admin secret is unavailable to the QA script; no fixture writes were made." : error.message), { code: adminMissing ? "BLOCKED_AUTH_ADMIN_ACCESS" : "BLOCKED_QA_GUARD" });
  }
}

export async function runPersistentDevUniverse(env = process.env, { fetcher = fetch, clientFactory = createClient, outDir = ".qa-artifacts" } = {}) {
  // Fail closed before any client, network request, credential file or mutation.
  const config = persistentDevConfig(env);
  assert.equal(config.projectRef, PROJECT_REF);
  const appFetch = credentialBoundFetch(config.previewOrigin, fetcher), dbFetch = credentialBoundFetch(config.supabaseOrigin, fetcher);
  await verifyPreviewBundleBinding(config, appFetch, dbFetch);
  const mutationFetch = deploymentMutationBoundFetch(config, appFetch);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: dbFetch } };
  const admin = clientFactory(config.supabaseOrigin, config.secretKey, options);
  const authorize = () => verifyPreviewDeploymentIdentity(config, appFetch);
  mkdirSync(outDir, { recursive: true });
  const privateFile = resolve(outDir, "persistent-dev-qa.private.json");
  const secrets = existsSync(privateFile) ? JSON.parse(readFileSync(privateFile, "utf8")) : { projectRef: PROJECT_REF, users: {} };
  assert.equal(secrets.projectRef, PROJECT_REF);
  const persistPrivate = () => writeFileSync(privateFile, JSON.stringify(secrets, null, 2) + "\n", { mode: 0o600 });
  const accounts = await ensurePersistentQaAccounts({ admin, createUserClient: () => clientFactory(config.supabaseOrigin, config.publicKey, options), authorize, secrets, persistPrivate });
  const report = { fixtureVersion: 1, generatedAt: new Date().toISOString(), projectRef: PROJECT_REF, buildSha: config.expectedSha, status: "in_progress", stage: "PROFILES",
    users: accounts.map(a => ({ userId:a.id,fixtureKey:a.key,name:a.name,profileConfigured:false })), relationships: [], groups: [], roundIds: [], betScenarios: [], testResults: {}, emailsSent: 0, deletedRows: 0 };
  const manifestFile = resolve(outDir, "persistent-dev-qa-universe.json");
  const previous = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : null;
  if (previous?.users?.length) assert.equal(previous.projectRef, PROJECT_REF);
  const journal = () => writeFileSync(manifestFile, JSON.stringify(report, null, 2) + "\n");
  journal();
  const app = async (account, path, method = "GET", body, expected = 200) => {
    const r = await mutationFetch(config.previewOrigin + path, { method, headers: { authorization: `Bearer ${account.token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(r.status, expected, `QA_API_STATUS_${path}_HTTP_${r.status}_EXPECTED_${expected}`); return r.json();
  };
  const d = domain(), { saveCloudProfile } = require("../.test-dist/lib/cloud-account.js");
  const { createBetaOnboardingProgress, completeBetaOnboarding } = require("../.test-dist/lib/beta-onboarding.js");
  const clubs = new Map(), cards = new Map();
  for (const clubName of [...new Set(QA_PLAYERS.map(f => f.club))]) {
    const catalog = await app(accounts[0], `/api/courses/catalog?q=${encodeURIComponent(clubName)}`);
    const match = catalog.courses.find(c => c.clubName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === clubName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
    assert.ok(match, "QA_REAL_HOME_CLUB_NOT_FOUND");
    const detail = await app(accounts[0], `/api/courses/catalog?courseId=${encodeURIComponent(match.id)}`);
    const card = detail.cards.find(c => c.holes?.length === 18 && c.holes.every(h => Number.isInteger(h.par) && Number.isInteger(h.strokeIndex)));
    assert.ok(card?.catalogCourseId && card.catalogTeeId, "QA_REAL_COMPLETE_TEE_NOT_FOUND"); clubs.set(clubName, match); cards.set(clubName, card);
  }
  for (const account of accounts) {
    const club = clubs.get(account.club), card = cards.get(account.club), now = new Date().toISOString();
    // The operator explicitly authorized synthetic QA setup. Use the same
    // versioned legal API as the app; never fabricate a receipt in SQL and never
    // re-enable an existing revoked/rejected decision.
    const evidence = await app(account, "/api/legal/evidence");
    const events = [];
    for (const subject of ["privacy_notice", "terms", "age_declaration", "financial_data"]) {
      const action = subject === "privacy_notice" ? "presented" : "accepted", definition = d.legalEvidenceDefinition(subject, action);
      const existing = evidence.events.filter(event => event.statement_key.startsWith(`${subject}.`)).at(-1);
      if (existing) { assert.ok(["presented", "accepted"].includes(existing.action), "QA_EXISTING_LEGAL_REVOCATION_PRESERVED"); continue; }
      const key = `${account.key}:${subject}`;
      const decision = secrets.legalDecisions ||= {};
      decision[key] ||= { idempotencyKey: randomUUID(), clientOccurredAt: now }; persistPrivate();
      events.push({ subject, action, documentKey: definition.documentKey, documentVersion: definition.version, documentHash: definition.documentHash,
        statementKey: `${subject}.${action}.${definition.version}`, statementText: definition.statement, statementHash: definition.statementHash,
        locale: "es-MX", origin: "onboarding", ...decision[key] });
    }
    if (events.length) await app(account, "/api/legal/evidence", "POST", { events }, 201);
    await authorize();
    await saveCloudProfile(account.client, account.id, { displayName: account.name, username: account.key, defaultHandicap: account.hcp, avatarUrl: "",
      location: { countryCode: "MX", country: "México", stateCode: "MX-PUE", state: "Puebla" } }, now, { rebaseOnServerClock: true });
    await authorize();
    checked(await account.client.from("profiles").update({ city: "Puebla", country: "México", state: "Puebla", handedness: account.hand, home_club: account.club, preferred_tee: card.teeName }).eq("id", account.id), "OWN_QA_GEOGRAPHY");
    await authorize();
    checked(await account.client.auth.updateUser({ data: { backyard_golf_profile_v1: { handedness: account.hand, homeClub: account.club, homeClubId: club.clubId, homeCourse: club.name, homeCourseId: club.id, preferredTee: card.teeName } } }), "OWN_QA_GOLF_METADATA");
    await authorize();
    checked(await account.client.from("social_profiles").update({ username: account.key, display_name: account.name, avatar_url: null, handicap: account.hcp, club_name: account.club }).eq("user_id", account.id), "OWN_QA_SOCIAL_PROFILE");
    await app(account, "/api/account/privacy", "PATCH", { visibility: "public" });
    await app(account, "/api/account/completion", "PUT", { handicap_choice: "MANUAL", manual_hcp: account.hcp, not_applicable: [] });
    await app(account, "/api/account/onboarding", "PUT", completeBetaOnboarding(createBetaOnboardingProgress(account.id)));
    await app(account, "/api/social/preferences", "PUT", { enabledForFriends: true, shareRounds: true, shareAchievements: true, shareEquipment: false, shareCourses: true, notifyLike: true, notifyComment: true, notifyAttest: true, notifyFriendAchievement: true, notifyEquipment: false, notifyFriendRequest: true });
    const profileUrl = d.socialProfileLink(account.id, config.previewOrigin), png = resolve(outDir, `${account.key}.png`);
    await QRCode.toFile(png, profileUrl, { width: 420, margin: 4 });
    const image = await loadImage(png), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
    const decoded = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    assert.equal(d.socialIdFromQr(decoded?.data, config.previewOrigin), account.id);
    report.users[accounts.indexOf(account)] = { userId: account.id, name: account.name, username: account.key, HCP: account.hcp, homeClub: { id: club.clubId, name: account.club }, profileUrl, fixtureKey: account.key, qrFile: png, profileConfigured:true };
    journal();
  }
  report.stage = "RELATIONSHIPS"; journal();
  const [diego, carlos, mariana, arturo] = accounts;
  async function relationship(from, to, accepted) {
    let graph = await app(from, "/api/social/connections");
    if (!graph.friends.includes(to.id) && !graph.requests.some(r => r.state === "PENDING" && [r.requester_id, r.addressee_id].includes(to.id))) graph = await app(from, "/api/social/connections", "POST", { action: "request", target: to.id, operationId: randomUUID() });
    const pending = graph.requests.find(r => r.state === "PENDING" && r.requester_id === from.id && r.addressee_id === to.id);
    if (accepted && pending) await app(to, "/api/social/connections", "POST", { action: "ACCEPTED", id: pending.id });
    graph = await app(from, "/api/social/connections");
    assert.ok(accepted ? graph.friends.includes(to.id) : pending || graph.friends.includes(to.id), "QA_RELATIONSHIP_NOT_PERSISTED");
    assert.ok(!graph.blocked.includes(to.id));
    report.relationships.push({ from: from.id, to: to.id, state: graph.friends.includes(to.id) ? "ACCEPTED" : "PENDING", requestId: pending?.id || null });
  }
  await relationship(diego, carlos, true); await relationship(mariana, arturo, false);
  report.stage = "GROUPS"; journal();
  const publishedVariants = (await app(diego, "/api/catalog/bet-variants")).items;
  const variants = availableQaVariants(publishedVariants);
  report.betVariantSource = publishedVariants.length ? "PUBLISHED_VARIANTS" : "EXISTING_GROUP_BUILDER_REGISTRY";
  report.testResults.betCatalog = selectedQaVariants(variants, 4).length ? "PASS" : "BLOCKED_NO_ENABLED_SUPPORTED_BET_VARIANT";
  for (const count of [4, 5]) {
    const group = qaGroup(accounts, count, variants);
    const saved = await app(diego, "/api/groups/invitations", "POST", { action: "ensure", group });
    await authorize();
    checked(await diego.client.from("frequent_groups_cloud").upsert({ owner_id: diego.id, local_id: group.id, name: group.name, snapshot: group }, { onConflict: "owner_id,local_id" }), "OWN_QA_GROUP_TEMPLATE");
    for (const member of accounts.slice(1, count)) {
      const current = await app(diego, `/api/groups/invitations?localGroupId=${encodeURIComponent(group.id)}`);
      if (current.acceptedMembers?.some(m => m.accountUserId === member.id)) continue;
      const invite = await app(diego, "/api/groups/invitations", "POST", { action: "create", groupId: saved.groupId, targetUserId: member.id });
      if (invite.alreadyMember) continue;
      assert.equal(invite.channel, "BACKYARD", "NO_EMAIL_DELIVERY_PERMITTED");
      const id = invite.invitationId;
      assert.ok(id, "QA_INTERNAL_GROUP_INVITATION_ID_REQUIRED");
      await app(member, "/api/groups/invitations", "POST", { action: "accept", invitationId: id });
    }
    report.groups.push({ groupId: saved.groupId, localId: group.id, name: group.name, ownerId: diego.id, userIds: accounts.slice(0, count).map(a => a.id), template: group.gameTemplate });
    journal();
  }
  report.stage = "HISTORY"; journal();
  const histories = new Map();
  for (const a of accounts) histories.set(a.id, (await app(a, "/api/cloud/rounds")).rounds);
  const now = Date.now(), foursome = qaGroup(accounts, 4, variants, report.generatedAt);
  async function saveRound(owner, round) {
    const existing = histories.get(owner.id).find(r => r.id === round.id);
    const persisted = existing || round;
    let cloudId;
    if (existing) cloudId = checked(await owner.client.from("rounds_cloud").select("id").eq("owner_id", owner.id).eq("local_round_id", round.id).single(), "OWN_QA_ROUND_ID").id;
    else { cloudId = (await app(owner, "/api/cloud/rounds", "POST", { round }, 201)).roundId; histories.get(owner.id).push(round); }
    report.roundIds.push({ localId: round.id, cloudId, ownerId: owner.id });
    journal();
    if (round.players.length > 1) {
      for (const participant of accounts.slice(1, 4)) {
        let card;
        for (let attempt = 0; attempt < 5 && !card; attempt++) {
          card = (await app(owner, `/api/social/activity?localRoundId=${encodeURIComponent(round.id)}`)).data.find(item => item.roundId === cloudId && item.type === "ROUND_COMPLETED" && item.targetUserId === owner.id);
          if (!card && attempt < 4) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        assert.ok(card, "QA_COMPLETED_ROUND_PUBLICATION_REQUIRED");
        await app(participant, `/api/social/rounds/${cloudId}/links`, "POST", { playerKey: d.accountPrimaryPlayerId(participant.id), expectedVersion: card.sourceVersion, expectedHash: card.currentHash });
      }
      report.betScenarios.push({ roundId: cloudId, categoryBalances: persisted.categoryBalances, settlement: persisted.resultDetails.settlementTransfers });
    }
  }
  for (let index = 0; index < 3; index++) await saveRound(diego, qaRound({ id: `persistent-dev-qa-v1-shared-${index + 1}`, accounts: accounts.slice(0, 4), course: cards.get(diego.club), completedAt: new Date(now - (80 - index * 20) * 86400000).toISOString(), group: foursome, variation: index }));
  // Preserve any already-completed score cards from an earlier interrupted run.
  // Add explicit betting scenarios instead of rewriting their historical result.
  const needsBetScenarios = report.betScenarios.some(scenario => !Object.values(scenario.categoryBalances || {}).some(balances => Object.values(balances).some(value => value !== 0)));
  if (needsBetScenarios && selectedQaVariants(variants, 4).length) for (let index = 0; index < 3; index++) await saveRound(diego, qaRound({ id: `persistent-dev-qa-v1-shared-bets-${index + 1}`, accounts: accounts.slice(0, 4), course: cards.get(diego.club), completedAt: new Date(now - (70 - index * 20) * 86400000).toISOString(), group: foursome, variation: index + 3 }));
  for (const [playerIndex, account] of accounts.entries()) for (let index = 0; index < (playerIndex === 4 ? 6 : 3); index++) await saveRound(account, qaRound({ id: `persistent-dev-qa-v1-${account.key}-${index + 1}`, accounts: [account], course: cards.get(account.club), completedAt: new Date(now - (55 - index * 8) * 86400000).toISOString(), holes: index === 1 ? 9 : 18, variation: index + playerIndex }));
  for (const account of accounts) {
    const history = (await app(account, "/api/cloud/rounds")).rounds;
    assert.ok(history.length >= 6, "QA_SIX_ROUNDS_PER_PLAYER_REQUIRED");
    const fresh = clientFactory(config.supabaseOrigin, config.publicKey, options);
    const login = checked(await fresh.auth.signInWithPassword({ email: account.email, password: secrets.users[account.key].password }), "QA_FRESH_SESSION");
    assert.equal(login.user.id, account.id);
    const oldToken = account.token; account.token = login.session.access_token;
    assert.deepEqual((await app(account, "/api/cloud/rounds")).rounds.map(r => r.id).sort(), history.map(r => r.id).sort()); account.token = oldToken;
    report.testResults[account.key] = { persistent: true, historyCount: history.length, freshSession: true, career: d.buildGolfInsights(history) };
  }
  report.testResults.qrImage = "PASS"; report.testResults.physicalCamera = "PENDING_DEVICE_QA";
  if (previous?.status === "complete") {
    assert.deepEqual(report.users.map(u => [u.fixtureKey,u.userId]),previous.users.map(u => [u.fixtureKey,u.userId]),"QA_SECOND_RUN_UUIDS_CHANGED");
    assert.deepEqual(report.groups.map(g => [g.localId,g.groupId]),previous.groups.map(g => [g.localId,g.groupId]),"QA_SECOND_RUN_GROUP_IDS_CHANGED");
    for (const prior of previous.roundIds) assert.deepEqual(report.roundIds.find(round => round.localId === prior.localId && round.ownerId === prior.ownerId), prior, "QA_SECOND_RUN_ROUND_IDS_CHANGED");
    report.testResults.idempotentSecondRun = report.roundIds.length === previous.roundIds.length ? "PASS" : "PENDING_SECOND_RUN";
  } else report.testResults.idempotentSecondRun = "PENDING_SECOND_RUN";
  report.status = "complete"; report.stage = "VERIFIED"; journal();
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--help")) console.log("Compile current domain; node scripts/qa-persistent-dev-universe.mjs --run [--env-file=<private JSON>]. DEV project/SHA/bundle guard required. Keeps all five fixtures permanently; never sends email or performs cleanup.");
  else {
    const file = process.argv.find(arg => arg.startsWith("--env-file="))?.slice(11);
    const env = file ? { ...process.env, ...JSON.parse(readFileSync(file, "utf8")) } : process.env;
    try {
      if (process.argv.includes("--check-config")) { persistentDevConfig(env); console.log("PERSISTENT_DEV_QA_CONFIG_PASS"); }
      else if (process.argv.includes("--run")) { const result = await runPersistentDevUniverse(env); console.log(JSON.stringify({ users: result.users.length, groups: result.groups.length, rounds: result.roundIds.length, manifest: ".qa-artifacts/persistent-dev-qa-universe.json" })); }
      else throw new Error("QA_EXPLICIT_RUN_REQUIRED");
    } catch (error) {
      // Validation messages contain field names, never key values. Other failures
      // are represented by fixed assertion labels, not provider response bodies.
      const label = String(error.message).split("\n")[0].slice(0,200);
      console.error(`${String(error.code || "").startsWith("BLOCKED_") ? error.code : "BLOCKED_QA_EXECUTION"}: ${label} No cleanup was performed.`); process.exitCode = 1;
    }
  }
}
