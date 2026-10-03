import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_PRIVACY_CHOICES, readOnboardingPrivacy, resolveOnboardingOptionalBundle, saveOnboardingPrivacy, type PrivacyChoices } from "../lib/onboarding-privacy";
import { OPTIONAL_AUTHORIZATION_BUNDLE_VERSION, OPTIONAL_AUTHORIZATION_POLICY_VERSIONS, OPTIONAL_AUTHORIZATION_SCOPES, type OptionalAuthorizationState } from "../lib/account-optional-authorizations";
import { legalEvidenceDefinition } from "../lib/legal-evidence";

const OWNER="11111111-1111-4111-8111-111111111111", AT="2026-10-03T12:00:00.000Z";
function fixture(allowBundle = false) {
  const state: OptionalAuthorizationState={bundleVersion:OPTIONAL_AUTHORIZATION_BUNDLE_VERSION,resolved:false,eligible:true,receipt:null,
    scopes:Object.fromEntries(OPTIONAL_AUTHORIZATION_SCOPES.map(scope=>[scope,{active:false,status:"missing",policyVersion:OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],source:null,decidedAt:null}])) as OptionalAuthorizationState["scopes"],
    legal:{financial_data:{active:false,status:"missing",policyVersion:legalEvidenceDefinition("financial_data","accepted")!.version,decidedAt:null},marketing:{active:false,status:"missing",policyVersion:legalEvidenceDefinition("marketing","accepted")!.version,decidedAt:null}},
    profileVisibility:"public",socialPrivacy:"PRIVATE",socialProfilePrivacy:"PUBLIC",sharing:{enabledForFriends:false,rounds:false,achievements:false,equipment:false,courses:false},notifications:{internal:false,master:false,push:false,email:false,rounds:false,reminders:false}};
  let social: Record<string,unknown>=Object.fromEntries(["shareRounds","shareAchievements","shareEquipment","shareCourses","notifyLike","notifyComment","notifyAttest","notifyFriendAchievement","notifyEquipment","notifyFriendRequest","enabledForFriends"].map(key=>[key,false]));
  const requests: Array<{path:string;method:string;body:Record<string,unknown>}> = [];
  let failSocial=false;
  const media: Record<"camera" | "photos", { version: 1; value: "enabled" | "disabled"; changedAt: string } | null> = { camera: null, photos: null };
  const mediaIds = new Set<string>();
  let failPhoto = false;
  const transport: typeof fetch=async(input,init)=>{
    const path=String(input),method=init?.method||"GET",body=init?.body?JSON.parse(String(init.body)):{};
    requests.push({path,method,body});
    assert.equal(new Headers(init?.headers).get("authorization"),"Bearer qa-session");
    const result=(value:unknown,status=200)=>Response.json(structuredClone(value),{status});
    if(path==="/api/account/device-permission-preferences?media=true") {
      if(method==="PATCH") {
        if (body.preference === "photos" && failPhoto) return result({error:"QA failure"},503);
        if (!mediaIds.has(body.idempotencyKey)) { mediaIds.add(body.idempotencyKey); media[body.preference as "camera" | "photos"]={version:1,value:body.enabled?"enabled":"disabled",changedAt:AT}; }
      }
      return result(media);
    }
    if(path==="/api/account/optional-authorizations") {
      if(method==="PATCH") {
        state.eligible=false; const scope=body.scope as keyof typeof state.scopes;
        state.scopes[scope]={active:body.enabled,status:body.enabled?"accepted":"declined",source:"settings",decidedAt:AT,policyVersion:OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope]};
        if(scope==="NOTIFICATION_INTERNAL")state.notifications.internal=state.notifications.master=body.enabled;
      }
      if(method === "POST") {
        assert.ok(allowBundle,"granular onboarding must not silently use authorize_all");
        if (!state.receipt) {
          const accepted = body.action === "authorize_all";
          state.resolved=true;state.eligible=false;state.receipt={action:body.action,idempotencyKey:body.idempotencyKey,decidedAt:AT};
          for(const scope of OPTIONAL_AUTHORIZATION_SCOPES)state.scopes[scope]={active:accepted,status:accepted?"accepted":"declined",policyVersion:OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],source:`onboarding_${body.action}`,decidedAt:AT};
          for(const subject of ["financial_data","marketing"] as const)state.legal![subject]={active:accepted,status:accepted?"accepted":"rejected",policyVersion:legalEvidenceDefinition(subject,"accepted")!.version,decidedAt:AT};
          Object.keys(state.notifications).forEach(key=>{state.notifications[key as keyof typeof state.notifications]=accepted;});
          Object.keys(state.sharing).forEach(key=>{state.sharing[key as keyof typeof state.sharing]=accepted;});
          state.socialPrivacy=accepted?"FRIENDS":"PRIVATE";social=Object.fromEntries(Object.keys(social).map(key=>[key,accepted]));
        }
      }
      return result(state);
    }
    if(path==="/api/backyard-ai/consent") {
      if (body.scope) {
        const accepted = method === "POST";
        state.scopes[body.scope as keyof typeof state.scopes] = { active:accepted,status:accepted?"accepted":"revoked",policyVersion:"2026-09-08-v2",source:"settings",decidedAt:AT };
        return result({scope:body.scope,active:accepted,policyVersion:"2026-09-08-v2",acceptedAt:AT,revokedAt:accepted?null:AT});
      }
      assert.equal(body.source,"onboarding");
      for(const decision of body.decisions){state.scopes[decision.scope as keyof typeof state.scopes]={active:decision.accepted,status:decision.accepted?"accepted":"declined",policyVersion:"2026-09-08-v2",source:"onboarding",decidedAt:AT};}
      return result({policyVersion:"2026-09-08-v2",resolved:true,decisions:body.decisions.map((decision:{scope:string;accepted:boolean})=>({scope:decision.scope,policyVersion:"2026-09-08-v2",active:decision.accepted,status:decision.accepted?"accepted":"declined",source:"onboarding",decidedAt:AT,acceptedAt:decision.accepted?AT:null,revokedAt:null,recordId:"1"}))});
    }
    if(path==="/api/legal/evidence") {
      for(const event of body.events){assert.equal(event.origin,"onboarding");const definition=legalEvidenceDefinition(event.subject,event.action)!;assert.equal(event.statementHash,definition.statementHash);assert.equal(event.statementText,definition.statement);state.legal![event.subject as "financial_data"|"marketing"]={active:event.action==="accepted",status:event.action,policyVersion:definition.version,decidedAt:AT};}
      return result({ok:true});
    }
    if(path==="/api/account/notification-preferences") {
      Object.assign(state.notifications,body);return result({initialized:true,preferences:body,delivery:{push:{configured:false,state:"not_configured"},email:{configured:false,state:"not_configured"}}});
    }
    if(path==="/api/social/preferences") {
      if(method==="PUT") {
        if(failSocial)return result({error:"QA failure"},503);
        social=body; state.socialPrivacy=body.enabledForFriends?"FRIENDS":"PRIVATE";
        state.sharing={enabledForFriends:body.enabledForFriends,rounds:body.shareRounds,achievements:body.shareAchievements,equipment:body.shareEquipment,courses:body.shareCourses};
      }
      return result({data:social});
    }
    throw new Error(`Unexpected request ${path}`);
  };
  return {state,media,transport,requests,failPhoto:(value:boolean)=>{failPhoto=value;},failSocial:(value:boolean)=>{failSocial=value;},authorizeAll:()=>{
    state.resolved=true; state.eligible=false; state.receipt={action:"authorize_all",idempotencyKey:"550e8400-e29b-41d4-a716-446655440000",decidedAt:AT};
    for(const scope of OPTIONAL_AUTHORIZATION_SCOPES) state.scopes[scope]={active:true,status:"accepted",policyVersion:OPTIONAL_AUTHORIZATION_POLICY_VERSIONS[scope],source:"onboarding_authorize_all",decidedAt:AT};
    for(const subject of ["financial_data","marketing"] as const)state.legal![subject]={active:true,status:"accepted",policyVersion:legalEvidenceDefinition(subject,"accepted")!.version,decidedAt:AT};
    Object.keys(state.notifications).forEach(key=>{state.notifications[key as keyof typeof state.notifications]=true;});
    Object.keys(state.sharing).forEach(key=>{state.sharing[key as keyof typeof state.sharing]=true;});
    social=Object.fromEntries(Object.keys(social).map(key=>[key,true]));
  }};
}
async function withFixture(run:(f:ReturnType<typeof fixture>)=>Promise<void>, allowBundle = false) {const f=fixture(allowBundle);const previous=globalThis.fetch;globalThis.fetch=f.transport;try{await run(f);}finally{globalThis.fetch=previous;}}

test("granular onboarding starts OFF without issuing writes",()=>withFixture(async f=>{
  assert.ok(Object.values(EMPTY_PRIVACY_CHOICES).every(value=>value===false));
  const result=await readOnboardingPrivacy("qa-session");assert.deepEqual(result.choices,EMPTY_PRIVACY_CHOICES);
  assert.ok(f.requests.every(request=>request.method==="GET"));
}));
test("accepted purposes persist individually, read back in another client, without claiming push delivery",()=>withFixture(async f=>{
  const choices=Object.fromEntries(Object.keys(EMPTY_PRIVACY_CHOICES).map(key=>[key,true])) as PrivacyChoices;
  await saveOnboardingPrivacy("qa-session",OWNER,choices,new Map());
  assert.deepEqual((await readOnboardingPrivacy("qa-session")).choices,choices);
  assert.equal((f.requests.filter(request=>request.path==="/api/legal/evidence")[0].body.events as unknown[]).length,2);
  assert.equal(f.state.resolved,false,"no broad bundle receipt was fabricated");
  assert.equal(f.state.profileVisibility,"public","sharing acceptance does not broaden profile visibility");
}));
test("declined onboarding is explicit evidence and never activates AI or marketing",()=>withFixture(async f=>{
  await saveOnboardingPrivacy("qa-session",OWNER,{...EMPTY_PRIVACY_CHOICES},new Map());
  assert.deepEqual((await readOnboardingPrivacy("qa-session")).choices,EMPTY_PRIVACY_CHOICES);
  assert.ok(Object.values(f.state.scopes).every(value=>value.status==="declined"));
  assert.equal(f.state.legal!.marketing.status,"rejected");
}));
test("mixed decisions stay separate and narrower social choices are not broadened on resume",()=>withFixture(async()=>{
  const choices={...EMPTY_PRIVACY_CHOICES,sharing:true,shareRounds:true,notifyFriendRequest:true,images:true,memory:true};
  const keys=new Map<string,string>();await saveOnboardingPrivacy("qa-session",OWNER,choices,keys);
  const resumed=await readOnboardingPrivacy("qa-session");await saveOnboardingPrivacy("qa-session",OWNER,resumed.choices,keys);
  assert.deepEqual((await readOnboardingPrivacy("qa-session")).choices,choices);
}));
test("partial persistence does not report success; retry reads confirmed decisions and finishes without a broad acceptance",()=>withFixture(async f=>{
  const keys=new Map<string,string>();f.failSocial(true);
  await assert.rejects(saveOnboardingPrivacy("qa-session",OWNER,{...EMPTY_PRIVACY_CHOICES},keys));
  const legal=f.requests.filter(request=>request.path==="/api/legal/evidence");assert.equal(legal.length,1);
  f.failSocial(false);await saveOnboardingPrivacy("qa-session",OWNER,{...EMPTY_PRIVACY_CHOICES},keys);
  assert.equal(f.requests.filter(request=>request.path==="/api/legal/evidence").length,1,"confirmed legal decisions are not replayed unnecessarily");
}));
test("changing an existing AI decision uses accept/revoke instead of the missing-only onboarding RPC",()=>withFixture(async()=>{
  const keys = new Map<string,string>();
  await saveOnboardingPrivacy("qa-session",OWNER,{...EMPTY_PRIVACY_CHOICES,images:true},keys);
  await saveOnboardingPrivacy("qa-session",OWNER,{...EMPTY_PRIVACY_CHOICES,ai:true,images:false},keys);
  assert.deepEqual((await readOnboardingPrivacy("qa-session")).choices,{...EMPTY_PRIVACY_CHOICES,ai:true,images:false});
}));

test("previous authorize-all hydrates its real purposes but does not invent camera/photo consent",()=>withFixture(async f=>{
  f.authorizeAll(); const result=await readOnboardingPrivacy("qa-session");
  for(const [purpose,checked] of Object.entries(result.choices))assert.equal(checked,purpose!=="camera"&&purpose!=="photos",purpose);
  assert.ok(f.requests.every(request=>request.method==="GET"));
}));

test("camera/photos hydrate only explicit internal decisions and stay independent of AI",()=>withFixture(async f=>{
  f.media.camera={version:1,value:"enabled",changedAt:AT};f.media.photos={version:1,value:"enabled",changedAt:AT};
  const result=await readOnboardingPrivacy("qa-session");assert.equal(result.choices.camera,true);assert.equal(result.choices.photos,true);
  assert.equal(result.choices.images,false);assert.equal(result.choices.ai,false);
}));

test("latest revocations survive reload and another login despite an older authorize-all receipt",()=>withFixture(async f=>{
  f.authorizeAll(); const initial=(await readOnboardingPrivacy("qa-session")).choices;
  const choices={...initial,camera:true,photos:true};await saveOnboardingPrivacy("qa-session",OWNER,choices,new Map());
  const revoked={...choices,camera:false,photos:false,reminders:false,location:false,push:false,images:false,financial:false,marketing:false};
  await saveOnboardingPrivacy("qa-session",OWNER,revoked,new Map());
  assert.deepEqual((await readOnboardingPrivacy("qa-session")).choices,revoked,"fresh read after reload");
  assert.deepEqual((await readOnboardingPrivacy("qa-session")).choices,revoked,"fresh authenticated client reads owner decisions");
  assert.equal(f.state.receipt?.action,"authorize_all");
  assert.equal(f.state.legal!.financial_data.active,false);assert.equal(f.state.legal!.marketing.active,false);
}));

test("camera retry IDs do not restore stale acceptance after partial saves and subsequent changes",()=>withFixture(async f=>{
  const keys=new Map<string,string>();f.failSocial(true);
  await assert.rejects(saveOnboardingPrivacy("qa-session",OWNER,{...EMPTY_PRIVACY_CHOICES,camera:true},keys));
  await assert.rejects(saveOnboardingPrivacy("qa-session",OWNER,{...EMPTY_PRIVACY_CHOICES,camera:false},keys));
  f.failSocial(false);await saveOnboardingPrivacy("qa-session",OWNER,{...EMPTY_PRIVACY_CHOICES,camera:true},keys);
  const attempts=f.requests.filter(request=>request.path.includes("?media=true")&&request.method==="PATCH"&&request.body.preference==="camera");
  assert.notEqual(attempts[0].body.idempotencyKey,attempts[2].body.idempotencyKey);
  assert.equal((await readOnboardingPrivacy("qa-session")).choices.camera,true);
}));

for (const action of ["authorize_all", "decline_all"] as const) test(`new explicit ${action} includes both media decisions and canonical hydration`,()=>withFixture(async f=>{
  const keys=new Map<string,string>();
  await resolveOnboardingOptionalBundle("qa-session",action,crypto.randomUUID(),keys);
  const choices=(await readOnboardingPrivacy("qa-session")).choices;
  assert.ok(Object.values(choices).every(value=>value === (action === "authorize_all")));
  const writes=f.requests.filter(r=>r.path.includes("?media=true")&&r.method==="PATCH");
  assert.deepEqual(writes.map(r=>[r.body.preference,r.body.enabled]),[["camera",action==="authorize_all"],["photos",action==="authorize_all"]]);
}, true));

test("a media write failure does not complete authorize-all; retries keep the same IDs",()=>withFixture(async f=>{
  const keys=new Map<string,string>(),id=crypto.randomUUID();f.failPhoto(true);
  await assert.rejects(resolveOnboardingOptionalBundle("qa-session","authorize_all",id,keys));
  f.failPhoto(false);await resolveOnboardingOptionalBundle("qa-session","authorize_all",id,keys);
  assert.equal((await readOnboardingPrivacy("qa-session")).choices.photos,true);
  const writes=f.requests.filter(r=>r.method==="PATCH"&&r.path.includes("?media=true"));
  assert.equal(writes[0].body.idempotencyKey,writes[2].body.idempotencyKey);
  assert.equal(writes[1].body.idempotencyKey,writes[3].body.idempotencyKey);
},true));

test("retrying an old authorize-all does not restore a newer camera revocation",()=>withFixture(async()=>{
  const keys=new Map<string,string>(),id=crypto.randomUUID();
  await resolveOnboardingOptionalBundle("qa-session","authorize_all",id,keys);
  const choices=(await readOnboardingPrivacy("qa-session")).choices;
  await saveOnboardingPrivacy("qa-session",OWNER,{...choices,camera:false},new Map());
  await assert.rejects(resolveOnboardingOptionalBundle("qa-session","authorize_all",id,keys));
  assert.equal((await readOnboardingPrivacy("qa-session")).choices.camera,false);
},true));

test("an older receipt is never backfilled by replaying the new bundle helper",()=>withFixture(async f=>{
  f.authorizeAll();await assert.rejects(resolveOnboardingOptionalBundle("qa-session","authorize_all",crypto.randomUUID(),new Map()));
  assert.deepEqual(f.media,{camera:null,photos:null});
},true));
