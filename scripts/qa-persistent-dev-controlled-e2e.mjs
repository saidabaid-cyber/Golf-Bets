// Separate synthetic account: never resets the five persistent fixtures.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { persistentDevConfig } from "./qa-persistent-dev-universe.mjs";
import { domain, qaRound } from "./lib/qa-persistent-dev-fixtures.mjs";
import { credentialBoundFetch, deploymentMutationBoundFetch, verifyPreviewBundleBinding, verifyPreviewDeploymentIdentity } from "./qa-preview-statistics.mjs";
const require = createRequire(import.meta.url);
export async function controlledE2e(env, outDir = ".qa-artifacts") {
  const config = persistentDevConfig(env), raw = credentialBoundFetch(config.previewOrigin), db = credentialBoundFetch(config.supabaseOrigin);
  await verifyPreviewBundleBinding(config, raw, db);
  const appFetch = deploymentMutationBoundFetch(config, raw), authorize = () => verifyPreviewDeploymentIdentity(config, raw);
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: db } };
  const admin = createClient(config.supabaseOrigin, config.secretKey, options);
  const file = resolve(outDir, "controlled-dev-qa.private.json"), reportFile = resolve(outDir, "controlled-dev-qa-e2e.json");
  const fixture = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { projectRef: config.projectRef, id: randomUUID(), email: "qa-first-experience-control@example.invalid", password: `Qa!${randomBytes(32).toString("base64url")}` };
  assert.equal(fixture.projectRef, config.projectRef);
  writeFileSync(file, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  const checked = (result, label) => { assert.ok(!result.error, label); return result.data; };
  let user = (await admin.auth.admin.getUserById(fixture.id)).data.user;
  if (!user) {
    await authorize();
    user = checked(await admin.auth.admin.createUser({ id: fixture.id, email: fixture.email, password: fixture.password, email_confirm: true,
      app_metadata: { qa_fixture_kind: "CONTROLLED_DEV_QA", qa_fixture_version: 1, qa_fixture_key: "qa_first_experience_control" }, user_metadata: { display_name: "QA First Experience Control", username: "qa_first_experience_control" } }), "CONTROL_CREATE_FAILED").user;
  }
  assert.equal(user.id, fixture.id); assert.equal(user.email, fixture.email); assert.equal(user.app_metadata.qa_fixture_kind, "CONTROLLED_DEV_QA");
  const client = createClient(config.supabaseOrigin, config.publicKey, options);
  let login = checked(await client.auth.signInWithPassword({ email: fixture.email, password: fixture.password }), "CONTROL_LOGIN_FAILED");
  let token = login.session.access_token;
  const app = async (path, method = "GET", body, expected = 200, useToken = token) => {
    const response = await appFetch(config.previewOrigin + path, { method, headers: { authorization: `Bearer ${useToken}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, expected, `CONTROL_API_${path}_HTTP_${response.status}`); return response.json();
  };
  if (existsSync(reportFile)) {
    const prior = JSON.parse(readFileSync(reportFile, "utf8"));
    if (prior.status === "complete") { assert.equal(prior.userId, fixture.id); const state = await app("/api/social/first-experience"); assert.equal(state.state.firstGroup, "created"); return { ...prior, buildSha: config.expectedSha, reread: true }; }
  }
  const { saveCloudProfile } = require("../.test-dist/lib/cloud-account.js");
  const { createBetaOnboardingProgress, completeBetaOnboarding } = require("../.test-dist/lib/beta-onboarding.js");
  const { cloudDataFingerprint } = require("../.test-dist/lib/cloud-sync.js");
  const d = domain(), now = new Date().toISOString();
  await authorize(); await saveCloudProfile(client, fixture.id, { displayName: "QA First Experience Control", username: "qa_first_experience_control", defaultHandicap: 15 }, now, { rebaseOnServerClock: true });
  await app("/api/account/onboarding", "PUT", completeBetaOnboarding(createBetaOnboardingProgress(fixture.id)));
  await app("/api/social/preferences", "PUT", { enabledForFriends: true, shareRounds: true, shareAchievements: true, shareEquipment: false, shareCourses: true, notifyLike: true, notifyComment: true, notifyAttest: true, notifyFriendAchievement: true, notifyEquipment: false, notifyFriendRequest: true });
  const report = { projectRef: config.projectRef, buildSha: config.expectedSha, generatedAt: now, userId: fixture.id, status: "in_progress", testResults: {}, qualification: "Real DEV API/domain flows; five-second Home rendering and exact visual return require separate browser evidence." };
  const save = () => writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n"); save();
  const state = await app("/api/social/first-experience"); assert.ok(state.eligible && !state.hasGroup);
  await app("/api/social/first-experience", "PUT", { field: "firstGroup", value: "created" }, 409);
  await app("/api/social/first-experience", "PUT", { field: "friendDiscovery", value: "opened" });
  const manifest = JSON.parse(readFileSync(resolve(outDir, "persistent-dev-qa-universe.json"), "utf8")), diego = manifest.users[0];
  for (const query of ["Diego", "qa_diego", "@qa_diego_green"]) assert.ok((await app(`/api/groups/users?q=${encodeURIComponent(query)}`)).users.some(person => person.user_id === diego.userId));
  const graph = await app("/api/social/connections");
  if (!graph.friends.includes(diego.userId)) {
    await Promise.all([0, 1].map(() => app("/api/social/connections", "POST", { action: "request", target: diego.userId, operationId: randomUUID() })));
    const requests = (await app("/api/social/connections")).requests.filter(request => request.state === "PENDING" && request.requester_id === fixture.id && request.addressee_id === diego.userId); assert.equal(requests.length, 1);
    const privateUsers = JSON.parse(readFileSync(resolve(outDir, "persistent-dev-qa.private.json"), "utf8")).users;
    const diegoClient = createClient(config.supabaseOrigin, config.publicKey, options), secret = privateUsers.qa_diego_green;
    const diegoToken = checked(await diegoClient.auth.signInWithPassword({ email: secret.email, password: secret.password }), "DIEGO_LOGIN_FAILED").session.access_token;
    assert.ok((await app("/api/social/notifications", "GET", undefined, 200, diegoToken)).data.some(notification => notification.activityId === requests[0].id));
    await app("/api/social/connections", "POST", { action: "ACCEPTED", id: requests[0].id }, 200, diegoToken);
    assert.ok((await app("/api/social/connections", "GET", undefined, 200, diegoToken)).friends.includes(fixture.id));
  }
  assert.ok((await app("/api/social/connections")).friends.includes(diego.userId));
  report.testResults.NEW_REQUEST_NOTIFICATION_ACCEPT_BIDIRECTIONAL = "PASS"; report.testResults.CONCURRENT_REQUEST_NO_DUPLICATES = "PASS"; save();
  await app("/api/social/first-experience", "PUT", { field: "firstGroup", value: "skipped" });
  const source = checked(await client.from("rounds_cloud").select("snapshot").eq("owner_id", fixture.id), "CONTROL_HISTORY_READ");
  const qaSource = await app("/api/courses/catalog?courseId=" + encodeURIComponent((await app("/api/courses/catalog?q=La%20Vista%20Country%20Club")).courses.find(course => course.clubName === "La Vista Country Club").id));
  const course = qaSource.cards.find(card => card.holes.length === 18 && card.catalogTeeId);
  const account = { id: fixture.id, name: "QA First Experience Control", hcp: 15 };
  const round = qaRound({ id: "controlled-dev-first-round-v1", accounts: [account], course, completedAt: now });
  const draft = { roundId: round.id, course, courseSelected: true, players: round.players, ownerId: round.ownerId, startHole: 1, roundHoles: 18, roundHandicapBasis: "relative", scoreOnly: true, bets: round.betConfig, personalBets: [], supplementalBets: [], manualBets: [], segments: [], scores: { 1: round.scores[1] }, putts: { 1: round.putts[1] }, startedAt: now, lifecycleState: "live" };
  const sync = async data => app("/api/cloud/sync", "POST", { data, fingerprint: cloudDataFingerprint(data) });
  let bundle = (await app("/api/cloud/sync")).data;
  if (!source.some(row => row.snapshot.id === round.id)) await sync({ ...bundle, activeDraft: draft, activeDraftUpdatedAt: now });
  bundle = (await app("/api/cloud/sync")).data;
  assert.deepEqual(bundle.activeDraft, draft, "CONTROL_DRAFT_SAVE_MISMATCH");
  await app("/api/social/first-experience", "PUT", { field: "firstRoundGroup", value: "skipped" });
  assert.deepEqual((await app("/api/cloud/sync")).data.activeDraft, draft, "SKIP_CHANGED_DRAFT");
  const group = { id: "controlled-dev-first-group-v1", name: "QA First Experience Group", privacy: "private", uses: 0, updatedAt: now, players: [account, { id: diego.userId, name: diego.name, hcp: diego.HCP }].map(item => ({ memberId: `account-${item.id}`, accountUserId: item.id, name: item.name, handicap: item.hcp, kind: "account" })) };
  group.gameTemplate = d.createEmptyGroupGameTemplate(group);
  const created = await app("/api/groups/invitations", "POST", { action: "ensure", group }); report.groupId = created.groupId;
  await app("/api/social/first-experience", "PUT", { field: "firstGroup", value: "created" });
  await app("/api/social/first-experience", "PUT", { field: "firstRoundGroup", value: "created" });
  assert.deepEqual((await app("/api/cloud/sync")).data.activeDraft, draft, "GROUP_CHANGED_DRAFT");
  const fresh = createClient(config.supabaseOrigin, config.publicKey, options);
  login = checked(await fresh.auth.signInWithPassword({ email: fixture.email, password: fixture.password }), "CONTROL_FRESH_LOGIN"); token = login.session.access_token;
  assert.deepEqual((await app("/api/cloud/sync")).data.activeDraft, draft, "NEW_SESSION_CHANGED_DRAFT");
  const resolved = await app("/api/social/first-experience"); assert.equal(resolved.state.firstGroup, "created"); assert.equal(resolved.state.firstRoundGroup, "created"); assert.equal(resolved.state.friendDiscovery, "opened");
  bundle = (await app("/api/cloud/sync")).data;
  await sync({ ...bundle, history: [...bundle.history.filter(item => item.id !== round.id), round], activeDraft: null, activeDraftUpdatedAt: new Date().toISOString() });
  assert.equal((await app("/api/cloud/sync")).data.activeDraft, null);
  assert.equal((await app("/api/cloud/rounds")).rounds.filter(item => item.id === round.id).length, 1);
  report.testResults.ACCOUNT_SYNCED_UX_RELOAD_NEW_SESSION = "PASS"; report.testResults.FIRST_GROUP_SKIP_CREATE_API = "PASS"; report.testResults.FIRST_ROUND_FALLBACK_DRAFT_PERSISTENCE_API = "PASS"; report.testResults.ACTIVE_ROUND_NEW_SESSION_CLOSE_API = "PASS";
  report.testResults.FIRST_EXPERIENCE_BROWSER = "BLOCKED_QA_BROWSER_LOGIN_REQUIRES_OTP_OR_OAUTH";
  report.status = "complete"; report.roundId = round.id; save(); return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert.ok(process.argv.includes("--run")); const file = process.argv.find(value => value.startsWith("--env-file="))?.slice(11); assert.ok(file); const report = await controlledE2e({ ...process.env, ...JSON.parse(readFileSync(file, "utf8")) }); console.log(JSON.stringify({ status: report.status, userId: report.userId, testResults: report.testResults })); }
  catch (error) { console.error("BLOCKED_CONTROLLED_QA: " + String(error.message).split("\n")[0].slice(0, 200)); process.exitCode = 1; }
}
