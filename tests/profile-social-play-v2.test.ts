import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { profileCompletion, EMPTY_COMPLETION_CHOICES, validCompletionChoices } from "../lib/profile-completion";
import { connectionState, socialProfileLink, socialIdFromQr, QA_SOCIAL_ORIGIN } from "../lib/social-connections";
import { createTotalScoreRound, completeTotalScoreHoles, totalScoreOrder } from "../lib/total-score-round";
import { upsertRoundSnapshot } from "../lib/round-editing";
import { saveRoundHistoryLocalFirst } from "../lib/round-history-save";
import { STORAGE_KEYS } from "../lib/round-utils";
import { deriveRoundAchievements } from "../lib/round-achievements";
import { createBackyardIndexRoundSnapshot } from "../lib/backyard-index";
import { emailLoginRecovery } from "../lib/email-login-recovery";
import { normalizeRoundPresentation } from "../lib/round-presentation";
import { socialRequest } from "../lib/social-activity-client";
import { safeSocialRoundCard } from "../lib/social-round-card";
import { roundMaterialPayload } from "../lib/round-achievements";
import type { Course, Player } from "../lib/types";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const empty = { indexEnabled:false, equipment:null, choices:EMPTY_COMPLETION_CHOICES };

test("completion uses authenticated transport instead of a local-only percentage", async () => {
  const result = await socialRequest<{percent:number}>("/api/account/completion", "synthetic-token", { fetcher: async (path, init) => {
    assert.equal(path, "/api/account/completion");
    assert.equal((init?.headers as Record<string,string>).Authorization, "Bearer synthetic-token");
    return Response.json({percent:100});
  } });
  assert.equal(result.percent,100);
  await socialRequest("/api/groups/users?q=qa", "synthetic-token", { fetcher: async () => Response.json({users:[]}) });
  await assert.rejects(socialRequest("https://untrusted.invalid", "synthetic-token"));
});
test("completion is seven equally weighted sections; skipped is not complete", () => {
  assert.equal(profileCompletion(empty).percent,0);
  assert.equal(profileCompletion({...empty,username:"golfer"}).percent,14);
  assert.equal(profileCompletion({...empty,username:"golfer",displayName:"Player",givenName:"QA",familyName:"Golfer"}).percent,29);
});
for (const choice of ["UNKNOWN","MANUAL"] as const) test(`100% without GHIN, public privacy, consent or computed index: ${choice}`, () => {
  const choices={handicap_choice:choice, manual_hcp:choice==="MANUAL"?12:null, not_applicable:["golf","equipment","ball","fitting"]};
  assert.equal(validCompletionChoices(choices),true);
  assert.equal(profileCompletion({...empty,choices,displayName:"QA",givenName:"QA",familyName:"Golfer",username:"qa"}).percent,100);
});
test("index activation counts before first eligible round; manual blank is not zero", () => {
  assert.equal(profileCompletion({...empty,indexEnabled:true}).sections.find(s=>s.id==="handicap")?.complete,true);
  for(const manual_hcp of [null,"",NaN,55]) assert.equal(validCompletionChoices({handicap_choice:"MANUAL",manual_hcp,not_applicable:[]}),false);
  assert.equal(validCompletionChoices({handicap_choice:"UNKNOWN",manual_hcp:null,not_applicable:["personal"]}),false);
});
test("QR uses stable UUID and exact trusted origin, never username/email/token", () => {
  const link=socialProfileLink(owner,QA_SOCIAL_ORIGIN);assert.equal(socialIdFromQr(link,"https://example.test"),owner);
  for(const value of [`https://evil.test/?friend=${owner}`,`${link}&access_token=secret`,`${link}#token`,`${QA_SOCIAL_ORIGIN}/auth/callback?friend=${owner}`,`${QA_SOCIAL_ORIGIN}/?friend=qa-name`,"javascript:alert(1)"]) assert.equal(socialIdFromQr(value,QA_SOCIAL_ORIGIN),null);
  assert.equal(link.includes("@"),false);
});
test("shared QR PNG round-trips through the same local decoder used for gallery/camera", async () => {
  const QRCode = await import("qrcode");
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const jsQR = (await import("jsqr")).default;
  const link = socialProfileLink(owner,QA_SOCIAL_ORIGIN);
  const png = await QRCode.toBuffer(link,{width:420,margin:4,errorCorrectionLevel:"M"});
  const canvas = createCanvas(420,420), ctx=canvas.getContext("2d");
  ctx.drawImage(await loadImage(png),0,0);
  const pixels=ctx.getImageData(0,0,420,420);
  const decoded=jsQR(pixels.data,420,420);
  assert.equal(decoded?.data,link);
  assert.equal(socialIdFromQr(decoded!.data,QA_SOCIAL_ORIGIN),owner);
});
test("QR review models self, existing friend, reciprocal pending and blocked", () => {
  const graph={people:[],friends:[],blocked:[],requests:[]};assert.equal(connectionState(graph,owner,owner),"SELF");
  assert.equal(connectionState({...graph,friends:[other]},owner,other),"FRIEND");
  const request={id:"r",requester_id:other,addressee_id:owner,state:"PENDING",created_at:"today"};
  assert.equal(connectionState({...graph,requests:[request]},owner,other),"INCOMING");
  assert.equal(connectionState({...graph,requests:[request]},other,owner),"PENDING");
  assert.equal(connectionState({...graph,blocked:[other]},owner,other),"BLOCKED");
});
const course:Course={id:"synthetic-only",name:"QA synthetic course",teeName:"QA unverified",holes:Array.from({length:18},(_,i)=>({number:i+1,par:4,strokeIndex:i+1}))};
const player:Player={id:"p1",accountUserId:owner,name:"QA Player",handicap:null};
const input={id:"qa-total",course,player,date:"2026-09-17",holes:18 as const,start:1 as const,total:80,now:"2026-09-17T14:00:00Z"};
test("total-only snapshot freezes actual course and total, creates no hole facts/index/achievements", () => {
  const round=createTotalScoreRound(input);assert.deepEqual(round.scores,{});assert.deepEqual(round.putts,{});
  assert.equal(round.players?.[0].handicap,null);assert.equal(deriveRoundAchievements(round,[],owner),null);
  assert.equal(createBackyardIndexRoundSnapshot(round,player.id).eligible,false);
  assert.equal(round.totalScoreCapture?.grossTotal,80);assert.notEqual(round.courseSnapshot,course);
  const card=safeSocialRoundCard({id:"db-id",local_round_id:round.id,snapshot:round},owner,true);
  assert.equal(card?.ownerScore,80);assert.equal(card?.totalOnly,true);assert.equal(card?.scorecard,undefined);assert.equal(card?.coursePar,null);
  assert.notEqual(roundMaterialPayload(round,owner),roundMaterialPayload({...round,totalScoreCapture:{...round.totalScoreCapture!,grossTotal:81}},owner));
  assert.equal(safeSocialRoundCard({id:"db-id",local_round_id:round.id,snapshot:round},other,true),null);
});
test("9 holes remain nine; physical back nine is preserved", () => {
  const round=createTotalScoreRound({...input,holes:9,start:10,total:42});assert.equal(round.roundHoles,9);assert.deepEqual(round.order,[10,11,12,13,14,15,16,17,18]);
  assert.deepEqual(totalScoreOrder(18,10),[10,11,12,13,14,15,16,17,18,1,2,3,4,5,6,7,8,9]);
});
test("later hole completion requires all scores and exact total, preserves ID/no duplication", () => {
  const round=createTotalScoreRound({...input,total:72});assert.throws(()=>completeTotalScoreHoles(round,{1:4},input.now));
  const rows=Object.fromEntries(round.order!.map(h=>[h,4]));assert.throws(()=>completeTotalScoreHoles(round,{...rows,1:5},input.now),/suman 73/);
  const next=completeTotalScoreHoles(round,rows,input.now);assert.equal(next.id,round.id);assert.equal(round.scores?.[1],undefined);
  assert.equal(upsertRoundSnapshot([round],next).length,1);assert.equal(next.totalScoreCapture?.grossTotal,72);assert.deepEqual(next.putts,{});
});
test("total capture rejects empty/invalid/future scores or date", () => {
  for(const total of [0,NaN,1.5,1000])assert.throws(()=>createTotalScoreRound({...input,total}));
  for(const date of ["2026-02-30","2027-01-01",""])assert.throws(()=>createTotalScoreRound({...input,date}));
});
test("total history uses existing cloud outbox without erasing active draft", async () => {
  const store=new Map<string,string>();const storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}};
  storage.setItem(STORAGE_KEYS.draft,JSON.stringify({roundId:"active-other",players:[player],course,scores:{1:{p1:5}}}));
  const snapshot=createTotalScoreRound(input);
  const result=await saveRoundHistoryLocalFirst({storage,ownerId:owner,snapshot,deviceId:"qa",defaultHandicap:null,hasLocalPreferenceState:false,queueForCloud:true,preserveActiveDraft:true,persistOffline:async()=>"saved"});
  assert.equal((result.bundle.activeDraft as {roundId:string})?.roundId,"active-other");assert.equal(result.history[0].totalScoreCapture?.grossTotal,80);
});
test("score-only mode persists, legacy/full metadata unchanged", () => {
  assert.deepEqual(normalizeRoundPresentation(undefined),{version:1,groupNassauTerm:"polla"});assert.equal(normalizeRoundPresentation({playMode:"score_only"}).playMode,"score_only");
});
test("OTP errors cannot enumerate accounts or assert absence", () => {
  assert.match(emailLoginRecovery(),/No pudimos/);assert.match(emailLoginRecovery(true),/No tienes una cuenta/);
  const source=readFileSync("app/components/account-provider.tsx","utf8");assert.match(source,/emailLoginRecovery\(\)/);assert.equal(source.includes('emailLoginRecovery(error'),false);
});
