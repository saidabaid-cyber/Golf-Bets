import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { QA_PLAYERS, fixtureMetadata, resolveExistingFixture, ensurePersistentQaAccounts, selectedQaVariants, availableQaVariants, qaGroup, qaRound, domain } from "./lib/qa-persistent-dev-fixtures.mjs";
import { persistentDevConfig, runPersistentDevUniverse } from "./qa-persistent-dev-universe.mjs";
import { verifyPersistentDevUniverse } from "./qa-persistent-dev-e2e.mjs";
import { controlledE2e } from "./qa-persistent-dev-controlled-e2e.mjs";

const d = domain();
const env = { PREVIEW_DB_REF: "bymeopxkxapfizeeqeyb", QA_CONFIRM_ISOLATED_PREVIEW: "bymeopxkxapfizeeqeyb", NEXT_PUBLIC_SUPABASE_URL: "https://bymeopxkxapfizeeqeyb.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit_test_only", SUPABASE_SECRET_KEY: "sb_secret_unit_test_not_real", VERCEL_ENV: "preview", PREVIEW_QA_URL: "https://dev.thebackyard.com.mx", PREVIEW_QA_EXPECTED_SHA: "a".repeat(40) };
const accounts = QA_PLAYERS.map(player => ({ ...player, id: randomUUID() }));
// This card is strictly unit-test data; the live provisioner gets cards from the
// authenticated catalog API and never persists this test card.
const course = { name: "Unit-only card", teeName: "Unit tee", catalogCourseId: "unit-course", catalogTeeId: "unit-tee",
  holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: [4,4,3,5,4,4,3,5,4][i % 9], strokeIndex: i + 1, yards: 350 })) };
const variants = ["individual_nassau", "polla_first", "polla_second", "polla_total", "skins"].map((engine, i) => ({ id: `unit-${engine}`, version: 1, engine, title: engine, description: "unit", active: true, order: i, minPlayers: 2, maxPlayers: 5, config: d.betVariantCapability(engine).defaults }));

test("exactly five synthetic fixtures, manual handicaps and no GHIN identity", () => {
  assert.deepEqual(QA_PLAYERS.map(p => [p.name, p.key, p.hcp]), [
    ["QA Diego Green", "qa_diego_green", 4.8], ["QA Carlos Fairway", "qa_carlos_fairway", 8.2],
    ["QA Mariana Birdie", "qa_mariana_birdie", 12.4], ["QA Arturo Bunker", "qa_arturo_bunker", 18.1], ["QA Fernanda Putt", "qa_fernanda_putt", 24.6],
  ]);
  assert.equal(new Set(QA_PLAYERS.map(p => p.email)).size, 5);
  for (const player of QA_PLAYERS) { assert.match(player.email, /^qa-[a-z-]+@example\.invalid$/); assert.equal(fixtureMetadata(player).qa_fixture_kind, "PERSISTENT_DEV_QA"); assert.ok(!Object.keys(player).some(key => /ghin/i.test(key))); }
});
test("wrong project, Production origin, bad SHA and missing Admin secret fail before any client or network", async () => {
  let calls = 0;
  const outDir = resolve(".qa-artifacts", `never-created-${randomUUID()}`);
  for (const invalid of [{ PREVIEW_DB_REF: "zhqmlpljloumldaczcfp" }, { QA_CONFIRM_ISOLATED_PREVIEW: "wrong" }, { NEXT_PUBLIC_SUPABASE_URL: "https://zhqmlpljloumldaczcfp.supabase.co" }, { PREVIEW_QA_URL: "https://app.thebackyard.com.mx" }, { VERCEL_ENV: "production" }, { PREVIEW_QA_EXPECTED_SHA: "short" }, { SUPABASE_SECRET_KEY: "" }]) {
    await assert.rejects(runPersistentDevUniverse({ ...env, ...invalid }, { clientFactory: () => { calls++; }, fetcher: () => { calls++; }, outDir }), error => error.code === "BLOCKED_QA_GUARD" || error.code === "BLOCKED_AUTH_ADMIN_ACCESS");
  }
  assert.equal(calls, 0); assert.equal(existsSync(outDir), false);
  assert.throws(() => persistentDevConfig({ ...env, SUPABASE_SECRET_KEY: "" }), { code: "BLOCKED_AUTH_ADMIN_ACCESS" });
});
test("alias/key collisions, unmarked synthetic accounts and duplicates fail closed", () => {
  const fixture = QA_PLAYERS[0], user = { id: accounts[0].id, email: fixture.email, app_metadata: fixtureMetadata(fixture) };
  assert.equal(resolveExistingFixture([user], fixture).id, user.id);
  assert.throws(() => resolveExistingFixture([user, { ...user, id: randomUUID() }], fixture), /DUPLICATE/);
  assert.throws(() => resolveExistingFixture([{ ...user, app_metadata: {} }], fixture), /KIND/);
  assert.throws(() => resolveExistingFixture([{ ...user, email: "unrelated@example.invalid" }], fixture), /EMAIL/);
  assert.throws(() => resolveExistingFixture([{ ...user, email: "unrelated@example.invalid", app_metadata: {}, user_metadata: { username: fixture.key } }], fixture), /EMAIL/);
});
test("a moved DEV alias or non-Preview deployment stops provisioning and E2E before Auth clients or disk writes", async () => {
  let clientCalls=0, networkCalls=0;
  const outDir=resolve(".qa-artifacts",`never-created-${randomUUID()}`);
  for(const runner of [runPersistentDevUniverse,verifyPersistentDevUniverse]) {
    for(const health of [{status:"ok",environment:"preview",buildSha:"b".repeat(40)},{status:"ok",environment:"production",buildSha:env.PREVIEW_QA_EXPECTED_SHA}]) {
      await assert.rejects(runner(env,{outDir,clientFactory:()=>{clientCalls++;},fetcher:async url=>{
        networkCalls++;assert.equal(String(url),"https://dev.thebackyard.com.mx/api/health");return Response.json(health);
      }}),/health identity/);
    }
  }
  assert.equal(clientCalls,0);assert.equal(networkCalls,4);assert.equal(existsSync(outDir),false);
});
test("second provisioning run reuses the five UUIDs and passwords without create/reset/mail/delete", async () => {
  const users = [{ id: randomUUID(), email: "unrelated@example.invalid", app_metadata: {} }], secrets = { users: {} };
  let created = 0, authorized = 0, saved = 0;
  const admin = { auth: { admin: {
    listUsers: async () => ({ data: { users }, error: null }),
    createUser: async input => { assert.equal(input.email_confirm, true); assert.ok(saved > created); created++; const user = { ...input, email_confirmed_at: "2026-10-03T00:00:00Z" }; delete user.password; users.push(user); return { data: { user }, error: null }; },
    updateUserById: () => { throw Error("Unexpected reset/confirmation"); },
  } } };
  const client = () => ({ auth: { signInWithPassword: async input => {
    const user = users.find(u => u.email === input.email); const fixture = QA_PLAYERS.find(p => p.email === input.email);
    assert.equal(input.password, secrets.users[fixture.key].password);
    return { data: { user, session: { access_token: "unit-token" } }, error: null };
  } } });
  const options = { admin, createUserClient: client, authorize: async () => { authorized++; }, secrets, persistPrivate: async () => { saved++; } };
  const first = await ensurePersistentQaAccounts(options), second = await ensurePersistentQaAccounts(options);
  assert.deepEqual(second.map(a => a.id), first.map(a => a.id));
  assert.equal(created, 5); assert.equal(authorized, 5); assert.equal(saved, 5); assert.equal(users.length, 6);
});
test("existing fixture without private credentials is retained, never resets its password", async () => {
  const player = QA_PLAYERS[0]; let writes = 0;
  await assert.rejects(ensurePersistentQaAccounts({ admin: { auth: { admin: { listUsers: async () => ({ data: { users: [{ id: accounts[0].id, email: player.email, app_metadata: fixtureMetadata(player), email_confirmed_at: "yes" }] } }) } } },
    secrets: { users: {} }, persistPrivate: () => { writes++; }, authorize: () => { writes++; }, createUserClient: () => { writes++; } }), /NO_PASSWORD_RESET/);
  assert.equal(writes, 0);
});
test("only enabled registered variants, maximum three, Nassau preferred; four and five member templates load canonical IDs", () => {
  assert.ok(selectedQaVariants(variants, 4).some(v => v.engine === "individual_nassau"));
  assert.equal(selectedQaVariants(variants, 4).length, 3);
  assert.deepEqual(selectedQaVariants(variants.map(v => ({ ...v, active: false })), 4), []);
  assert.deepEqual(selectedQaVariants([{ ...variants[0], engine: "fake" }], 4), []);
  for (const count of [4,5]) {
    const group = qaGroup(accounts, count, variants), loaded = d.instantiateGroupGameTemplate(group, randomUUID);
    assert.equal(loaded.players.length, count); assert.deepEqual(loaded.players.map(p => p.accountUserId), accounts.slice(0, count).map(a => a.id));
    assert.deepEqual(loaded.players.map(p => p.id), accounts.slice(0,count).map(a => d.accountPrimaryPlayerId(a.id)));
    assert.deepEqual(loaded.players.map(p => p.handicap), QA_PLAYERS.slice(0,count).map(a => a.hcp));
    assert.equal(loaded.personalBets.length, 1);
  }
});
test("empty custom-preset catalog reuses selectable existing GroupBuilder games and canonical defaults", () => {
  const builtin = availableQaVariants([]);
  assert.deepEqual(builtin.map(item => item.engine), ["individual_nassau", "polla_total", "skins"]);
  assert.ok(builtin.every(item => item.source === "EXISTING_GROUP_BUILDER_REGISTRY" && d.betVariantCapability(item.engine)));
  assert.deepEqual(availableQaVariants(variants), variants);
  const group = qaGroup(accounts, 4, builtin);
  assert.equal(group.gameTemplate.personalBets.length, 1);
  assert.equal(group.gameTemplate.personalBets[0].id, qaGroup(accounts, 4, builtin).gameTemplate.personalBets[0].id);
});
test("controlled E2E rejects a Production project before creating its separate synthetic account", async () => {
  await assert.rejects(controlledE2e({ ...env, PREVIEW_DB_REF: "production" }), error => error.code === "BLOCKED_QA_GUARD");
});
test("per-hole 9H and 18H cards vary and produce valid existing recap/insights; score-only has no bets", () => {
  const rounds = Array.from({ length: 6 }, (_, index) => qaRound({ id: `unit-${index}`, accounts: [accounts[0]], course, completedAt: new Date(Date.UTC(2026,8,index+1)).toISOString(), holes: index === 1 ? 9 : 18, variation: index }));
  const insights = d.buildGolfInsights(rounds);
  assert.equal(insights.scoredRounds, 6); assert.equal(insights.scoredRounds9, 1); assert.ok(insights.averageScore > 0); assert.ok(insights.birdies > 0); assert.ok(insights.bogeys > 0); assert.ok(insights.doublesOrWorse > 0);
  for (const r of rounds) { assert.equal(Object.keys(r.scores).length, r.roundHoles); assert.equal(Object.keys(r.putts).length, r.roundHoles); assert.equal(r.presentation.playMode, "score_only"); assert.ok(Object.values(r.playerBalances).every(v => v === 0)); assert.deepEqual(d.buildHistoricalRoundRecap(r).issues, []); }
  assert.throws(() => qaRound({ id:"bad", accounts, course: { ...course, catalogTeeId: null }, completedAt: rounds[0].completedAt }), /REAL_CATALOG_TEE/);
  assert.throws(() => qaRound({ id:"bad", accounts: [accounts[0],accounts[0]], course, completedAt: rounds[0].completedAt }), /DUPLICATE/);
});
test("real engines settle every group round to finite zero-sum with no duplicate player or fake winner", () => {
  const group = qaGroup(accounts, 4, variants);
  for (let i=0;i<6;i++) {
    const r = qaRound({ id: `unit-bets-${i}`, accounts: accounts.slice(0,4), group, course, completedAt: "2026-09-01T00:00:00.000Z", variation: i });
    assert.equal(r.presentation.playMode, undefined); assert.ok(d.isFiniteZeroSum(Object.values(r.playerBalances)));
    assert.ok(Object.values(r.playerBalances).some(v => v !== 0)); assert.deepEqual(r.categoryBalances.Personales, d.calculatePersonalBets(r.personalBets,r.ownerId,r.players,course,r.scores,r.order).balances);
    const settled = { ...r.playerBalances };
    for (const t of r.resultDetails.settlementTransfers) { assert.notEqual(t.fromPlayerId,t.toPlayerId); settled[t.fromPlayerId]+=t.amount; settled[t.toPlayerId]-=t.amount; }
    assert.ok(Object.values(settled).every(v => Math.abs(v)<1e-9));
  }
});
test("five actual PNGs decode through the existing QR resolver, preserving DEV origin and UUID", async () => {
  for (const a of accounts) {
    const url=d.socialProfileLink(a.id,env.PREVIEW_QA_URL), png=await QRCode.toBuffer(url,{width:420,margin:4});
    const image=await loadImage(png), canvas=createCanvas(420,420), ctx=canvas.getContext("2d");ctx.drawImage(image,0,0);
    const decoded=jsQR(ctx.getImageData(0,0,420,420).data,420,420);
    assert.equal(d.socialIdFromQr(decoded.data,env.PREVIEW_QA_URL),a.id);
    assert.equal(d.socialIdFromQr(decoded.data,"https://app.thebackyard.com.mx"),null);
  }
});
