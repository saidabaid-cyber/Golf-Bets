// Real DEV API verification of provisioned fixtures. Never consumes or alters
// the baseline pending request, resets UX decisions, or deletes QA data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import jsQR from "jsqr";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { persistentDevConfig } from "./qa-persistent-dev-universe.mjs";
import { QA_PLAYERS, assertFixtureOwner, domain } from "./lib/qa-persistent-dev-fixtures.mjs";
import { credentialBoundFetch, deploymentMutationBoundFetch, verifyPreviewBundleBinding } from "./qa-preview-statistics.mjs";
const require = createRequire(import.meta.url);
const checked = (result, label) => { if (result.error) throw new Error(label); return result.data; };

export async function verifyPersistentDevUniverse(env = process.env, { fetcher = fetch, clientFactory = createClient, outDir = ".qa-artifacts" } = {}) {
  const config = persistentDevConfig(env); // No I/O or client until guards pass.
  const raw = credentialBoundFetch(config.previewOrigin, fetcher), db = credentialBoundFetch(config.supabaseOrigin, fetcher);
  await verifyPreviewBundleBinding(config, raw, db);
  const appFetch = deploymentMutationBoundFetch(config, raw);
  const manifest = JSON.parse(readFileSync(resolve(outDir, "persistent-dev-qa-universe.json"), "utf8"));
  assert.equal(manifest.projectRef, config.projectRef); assert.equal(manifest.users.length, 5);
  const privateState = JSON.parse(readFileSync(resolve(outDir, "persistent-dev-qa.private.json"), "utf8"));
  assert.equal(privateState.projectRef, config.projectRef);
  const options = { auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }, global: { fetch:db } };
  const admin = clientFactory(config.supabaseOrigin, config.secretKey, options), accounts = [];
  for (const fixture of QA_PLAYERS) {
    const record = manifest.users.find(u => u.fixtureKey === fixture.key);
    assert.ok(record, "QA_FIXTURE_RECORD_REQUIRED");
    const user = checked(await admin.auth.admin.getUserById(record.userId), "QA_AUTH_READ_FAILED").user;
    assertFixtureOwner(user, fixture);
    const secret = privateState.users[fixture.key]; assert.equal(secret?.id, user.id); assert.equal(secret.email, fixture.email);
    const account = { ...fixture, id:user.id, record, client:clientFactory(config.supabaseOrigin,config.publicKey,options) };
    const login=checked(await account.client.auth.signInWithPassword({email:fixture.email,password:secret.password}),"QA_FRESH_LOGIN_FAILED");
    assert.equal(login.user.id,user.id); account.token=login.session.access_token; accounts.push(account);
  }
  const app = async (account,path,method="GET",body,expected=200) => {
    const response=await appFetch(config.previewOrigin+path,{method,cache:"no-store",headers:{authorization:`Bearer ${account.token}`,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal(response.status,expected,`QA_STATUS_${path}`); return response.json();
  };
  const d=domain(), {groupPlayerDuplicateReason}=require("../.test-dist/lib/group-generator.js");
  const report={projectRef:config.projectRef,buildSha:config.expectedSha,generatedAt:new Date().toISOString(),testResults:{},users:[],qualification:"Real authenticated DEV APIs and fresh Supabase sessions. Browser modal flows and physical camera require separate UI evidence."};
  const pass = label => { report.testResults[label]="PASS"; };
  for (const [index,account] of accounts.entries()) {
    const other=accounts[(index+1)%accounts.length];
    for (const query of [other.name.split(" ")[1],other.name,other.key,`@${other.key}`]) {
      const found=(await app(account,`/api/groups/users?q=${encodeURIComponent(query)}`)).users;
      assert.ok(found.some(u=>u.user_id===other.id),"QA_SEARCH_NOT_FOUND");
      assert.ok(found.every(u=>Object.keys(u).every(k=>["user_id","username","display_name","avatar_url","is_friend"].includes(k))),"DIRECTORY_PRIVATE_FIELDS");
      assert.ok(!JSON.stringify(found).includes("@example.invalid"));
    }
    const nearby=(await app(account,"/api/social/connections?discovery=nearby")).users;
    assert.ok(nearby.every(u=>u.user_id!==account.id && Object.keys(u).every(k=>["user_id","username","display_name","avatar_url","area_label"].includes(k))),"NEARBY_PRIVATE_FIELDS");
    for (const otherAccount of accounts.filter(a=>a.club===account.club && a.id!==account.id)) assert.ok(nearby.some(u=>u.user_id===otherAccount.id),"QA_NEARBY_NOT_FOUND");
    const image=await loadImage(account.record.qrFile), canvas=createCanvas(image.width,image.height),ctx=canvas.getContext("2d");ctx.drawImage(image,0,0);
    const code=jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
    assert.equal(d.socialIdFromQr(code?.data,config.previewOrigin),account.id);
    const profile=(await app(other,`/api/social/connections?target=${account.id}`)).person;
    assert.equal(profile.user_id,account.id);assert.ok(!JSON.stringify(profile).includes("@example.invalid"));
    await app(account,"/api/social/connections","POST",{action:"request",target:account.id,operationId:randomUUID()},403);
    const history=(await app(account,"/api/cloud/rounds")).rounds;
    assert.ok(history.length>=6); assert.equal(new Set(history.map(r=>r.id)).size,history.length);
    const insights=d.buildGolfInsights(history);assert.ok(insights.scoredRounds>=6 && insights.averageScore>0 && insights.birdies>0 && insights.coursesPlayed>0);
    assert.deepEqual((await app(account,"/api/cloud/rounds")).rounds.map(r=>r.id).sort(),history.map(r=>r.id).sort());
    const ownRounds=history.filter(r=>r.accountUserId===account.id && !r.cloudParticipant);
    for (const round of ownRounds) {
      assert.deepEqual(d.buildHistoricalRoundRecap(round).issues,[]);
      assert.ok(d.isFiniteZeroSum(Object.values(round.playerBalances)));
      if (round.presentation?.playMode === "score_only") { assert.ok(Object.values(round.playerBalances).every(v=>v===0)); continue; }
      const course=round.courseSnapshot,polla=d.calculatePolla(course,round.scores,round.players,round.betConfig.polla,round.order),skins=d.calculateSkins(course,round.scores,round.players,round.betConfig.skins,round.order);
      const skinBalances=d.payoutWinnerTakesFromAll(round.players.filter(p=>round.betConfig.skins.participantIds.includes(p.id)),skins.won,round.betConfig.skins.value);
      const personals=d.calculatePersonalBets(round.personalBets,round.ownerId,round.players,course,round.scores,round.order);
      assert.deepEqual(d.mergeBalances(round.players,polla.balances,skinBalances,personals.balances),round.playerBalances,"QA_ENGINE_SETTLEMENT_MISMATCH");
    }
    report.users.push({userId:account.id,historyCount:history.length,career:insights});
  }
  for (const label of ["SEARCH_NAME","SEARCH_USERNAME","DIRECTORY_PRIVACY","NEARBY_PRIVACY_SAFE","QR_IMAGE","SELF_REQUEST_REJECTED","ROUND_HISTORY","ROUND_RELOAD","FRESH_SESSION","CAREER_DATA_READINESS"]) pass(label);
  const [diego,carlos,mariana,arturo,fernanda]=accounts;
  const dg=await app(diego,"/api/social/connections"),cg=await app(carlos,"/api/social/connections");
  assert.ok(dg.friends.includes(carlos.id) && cg.friends.includes(diego.id));
  await Promise.all([0,1].map(()=>app(diego,"/api/social/connections","POST",{action:"request",target:carlos.id,operationId:randomUUID()})));
  assert.ok(!(await app(diego,"/api/social/connections")).requests.some(r=>r.state==="PENDING" && [r.requester_id,r.addressee_id].includes(carlos.id)));
  const pending=(await app(mariana,"/api/social/connections")).requests.filter(r=>r.requester_id===mariana.id && r.addressee_id===arturo.id && r.state==="PENDING");
  assert.equal(pending.length,1);
  assert.ok((await app(arturo,"/api/social/notifications")).data.some(n=>n.activityId===pending[0].id));
  const fg=await app(fernanda,"/api/social/connections"); assert.equal(fg.friends.length,0); assert.equal(fg.blocked.length,0); assert.ok(!fg.requests.some(r=>r.state==="PENDING"));
  pass("SOCIAL_BASELINE");pass("EXISTING_FRIEND_CONCURRENT_REQUEST_NO_DUPLICATE");pass("BASELINE_REQUEST_NOTIFICATION");
  const cloudGroups=checked(await diego.client.from("frequent_groups_cloud").select("snapshot").eq("owner_id",diego.id),"QA_GROUP_READ_FAILED");
  for (const record of manifest.groups) {
    const groups=cloudGroups.filter(g=>g.snapshot.id===record.localId);assert.equal(groups.length,1);
    const group=d.parseFrequentGroups(JSON.stringify([groups[0].snapshot]))[0],loaded=d.instantiateGroupGameTemplate(group,randomUUID);
    assert.deepEqual(loaded.players.map(p=>p.accountUserId),record.userIds);
    assert.deepEqual(loaded.players.map(p=>p.handicap),accounts.slice(0,record.userIds.length).map(a=>a.hcp));
    const duplicate={...loaded.players[0],id:randomUUID(),name:"Different QA label"};
    assert.ok(groupPlayerDuplicateReason(loaded.players,duplicate));
  }
  pass("GROUP_SEARCH");pass("GROUP_LOAD_FROM_CANONICAL_TEMPLATE");pass("GROUP_ACCOUNT_ID_DEDUPLICATION");
  if(manifest.testResults.betCatalog==="PASS") pass("BET_SETTLEMENT_FROM_REAL_ENGINES");
  else report.testResults.BET_SETTLEMENT_FROM_REAL_ENGINES="BLOCKED_NO_ENABLED_SUPPORTED_BET_VARIANT";
  const feed=(await app(carlos,"/api/social/activity?friendsOnly=true")).data;
  for(const round of manifest.roundIds.filter(r=>r.ownerId===diego.id && r.localId.startsWith("persistent-dev-qa-v1-shared-")))assert.equal(feed.filter(c=>c.roundId===round.cloudId && c.type==="ROUND_COMPLETED" && c.targetUserId===diego.id).length,1);
  pass("SOCIAL_FEED_NO_DUPLICATE");
  for(const label of ["NEW_FRIEND_REQUEST_ACCEPT_E2E","ACTIVE_ROUND_UI_RESUME","FIRST_EXPERIENCE_UI_E2E","FIRST_ROUND_FALLBACK_UI_E2E"])report.testResults[label]="PENDING_CONTROLLED_UI_QA";
  report.testResults.QR_PHYSICAL_CAMERA="PENDING_DEVICE_QA";
  writeFileSync(resolve(outDir,"persistent-dev-qa-e2e.json"),JSON.stringify(report,null,2)+"\n");return report;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.includes("--help"))console.log("node scripts/qa-persistent-dev-e2e.mjs --run --env-file=<private JSON>. Verifies real provisioned DEV fixtures; no cleanup or baseline request acceptance. UI-only checks remain pending until browser evidence exists.");
  else {
    const path=process.argv.find(arg=>arg.startsWith("--env-file="))?.slice(11);
    const env=path?{...process.env,...JSON.parse(readFileSync(path,"utf8"))}:process.env;
    try { assert.ok(process.argv.includes("--run"),"QA_EXPLICIT_RUN_REQUIRED"); const report=await verifyPersistentDevUniverse(env);console.log(JSON.stringify({testResults:report.testResults,manifest:".qa-artifacts/persistent-dev-qa-e2e.json"})); }
    catch(error){console.error(`${String(error.code||"").startsWith("BLOCKED_")?error.code:"BLOCKED_QA_E2E"}: ${String(error.code||"").startsWith("BLOCKED_")?error.message:"A guarded verification failed; no QA data was deleted."}`);process.exitCode=1;}
  }
}
