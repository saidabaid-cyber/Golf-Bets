import assert from "node:assert/strict";
import { randomBytes,randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { profileCloudQaConfig } from "./qa-preview-profile-cloud.mjs";
import { credentialBoundFetch,verifyPreviewBundleBinding } from "./qa-preview-statistics.mjs";

const require=createRequire(import.meta.url);
const checked=(result,label)=>{if(result.error)throw new Error(`${label} failed (${String(result.error.code||result.error.status||"UNKNOWN").replace(/[^a-zA-Z0-9_]/g,"").slice(0,40)}).`);return result.data;};

/** Real Preview API + authorized QA DB only. Keeps all synthetic fixtures.
 * NEVER tests delivery to real/invented inboxes. API create/retry is exercised
 * only after this same immutable deployment confirms no delivery credential. */
export async function runPreviewGroupInvitationsQA(env=process.env,{fetcher=fetch,clientFactory=createClient,log=console.log}={}) {
  const config=profileCloudQaConfig(env);
  const appFetch=credentialBoundFetch(config.previewOrigin,fetcher),databaseFetch=credentialBoundFetch(config.supabaseOrigin,fetcher);
  await verifyPreviewBundleBinding(config,appFetch);
  const domain={...require("../.test-dist/lib/group-game-template.js"),...require("../.test-dist/lib/frequent-templates.js"),...require("../.test-dist/lib/engine.js")};
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:databaseFetch}};
  const admin=clientFactory(config.supabaseOrigin,config.secretKey,options),runId=randomUUID(),accounts=[],passed=[];
  let stage="CREATE_QA_FIXTURES",failure=null,diagnostic=null,emailDeliveryConfigured=null,groupId=null;
  async function app(path,actor,method="GET",body,expected=200) {
    const response=await appFetch(`${config.previewOrigin}${path}`,{method,cache:"no-store",headers:{"content-type":"application/json",...(actor?.token?{authorization:`Bearer ${actor.token}`} : {}),...(config.bypass?{"x-vercel-protection-bypass":config.bypass}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const raw=await response.text();assert.ok(raw.length<2_000_000,"bounded QA API result");let data;
    try{data=JSON.parse(raw);}catch{throw new Error("Preview returned non-JSON");}
    if(response.status!==expected){diagnostic={path:path.split("?",1)[0],status:response.status,expected,code:typeof data?.code==="string"&&/^[A-Z0-9_]{1,80}$/.test(data.code)?data.code:"UNEXPECTED_RESPONSE"};throw new Error("Preview API status mismatch");}
    return data;
  }
  async function login(account) {
    account.client=clientFactory(config.supabaseOrigin,config.publicKey,options);
    const data=checked(await account.client.auth.signInWithPassword({email:account.email,password:account.password}),"Synthetic QA login");
    assert.equal(data.user?.id,account.id);assert.ok(data.session?.access_token);account.token=data.session.access_token;
  }
  async function createAccount(label,email) {
    const account={id:randomUUID(),email:email||`qa-group-${label}-${runId}@example.invalid`,password:`Qa!${randomBytes(30).toString("base64url")}`,name:`Grupo QA ${label} ${runId.slice(0,8)}`,username:`gqa_${label}_${runId.replaceAll("-","").slice(0,16)}`};
    accounts.push(account);
    const created=checked(await admin.auth.admin.createUser({id:account.id,email:account.email,password:account.password,email_confirm:true,app_metadata:{qa_run_id:runId},user_metadata:{display_name:account.name}}),"Create run-owned QA identity");
    assert.equal(created.user.id,account.id);await login(account);
    checked(await account.client.from("profiles").update({display_name:account.name,onboarding_completed_at:new Date().toISOString()}).eq("id",account.id).select("id").single(),"Own profile setup");
    checked(await account.client.from("social_profiles").update({display_name:account.name,username:account.username}).eq("user_id",account.id).select("user_id").single(),"Own social identity");
    await app("/api/account/privacy",account,"PATCH",{visibility:label==="b"?"friends":"public"});return account;
  }
  async function rpc(actor,action,payload) {return checked(await actor.client.rpc("group_invitation_action_v1",{action,payload}),"Invitation user RPC");}
  async function directory(actor,query) {return (await app(`/api/groups/users?q=${encodeURIComponent(query)}`,actor)).users;}
  try {
    const a=await createAccount("a"),b=await createAccount("b"),c=await createAccount("c");
    passed.push("PREVIEW_BUNDLE_QA_REF_PROVED_BEFORE_FIXTURES","SYNTHETIC_VERIFIED_AUTH_ONLY");
    stage="VERIFIED_ACCOUNT_MAPPING";
    await app("/api/account/entry",null,"GET",undefined,401);
    await app(`/api/account/entry?email=${encodeURIComponent(b.email)}`,a,"GET",undefined,400);
    for(let i=0;i<2;i++){
      const entry=await app("/api/account/entry",a);assert.equal(entry.userId,a.id);assert.equal(entry.existingAccount,true);
    }
    assert.equal(checked(await a.client.from("profiles").select("id").eq("id",a.id),"Verified identity dedupe readback").length,1);
    passed.push("ACCOUNT_ENTRY_VERIFIED_IDENTITY_ONLY","ACCOUNT_ENTRY_REPEAT_NO_PROFILE_DUPLICATION");
    stage="DIRECTORY_VISIBILITY";
    for(const query of [c.name,c.username,c.email.toUpperCase()]) {
      const users=await directory(a,query);assert.ok(users.some(user=>user.user_id===c.id));
      assert.ok(users.every(user=>Object.keys(user).every(key=>["user_id","username","display_name","avatar_url","is_friend"].includes(key))));
      assert.equal(JSON.stringify(users).includes("@example.invalid"),false);
    }
    assert.equal((await directory(a,c.email.slice(0,-4))).some(user=>user.user_id===c.id),false);
    assert.equal((await directory(a,b.email)).some(user=>user.user_id===b.id),false);
    const friendship=checked(await a.client.from("friend_requests").insert({requester_id:a.id,addressee_id:b.id,operation_id:randomUUID(),state:"PENDING"}).select("id").single(),"Create QA friendship request");
    checked(await b.client.from("friend_requests").update({state:"ACCEPTED"}).eq("id",friendship.id).select("id").single(),"Accept QA friendship");
    assert.equal((await directory(a,b.email)).find(user=>user.user_id===b.id)?.is_friend,true);
    passed.push("SEARCH_NAME_USERNAME_EXACT_EMAIL","DIRECTORY_NO_PRIVATE_EMAIL","FRIENDS_VISIBILITY_USES_REAL_FRIENDSHIP");
    stage="GROUP_TEMPLATE_PERSISTENCE";
    const group={id:`qa-group-${runId}`,name:`QA Invitaciones ${runId.slice(0,8)}`,uses:0,updatedAt:new Date().toISOString(),players:[{memberId:`account-${a.id}`,kind:"account",name:a.name,accountUserId:a.id,handicap:null},...Array.from({length:7},(_,i)=>({memberId:`qa-invitado-${i}-${runId}`,kind:"guest",name:`Invitado QA ${i+1}`,handicap:7+i}))]};
    const template=domain.createEmptyGroupGameTemplate(group),ids=group.players.map(p=>p.memberId);
    template.roundDefaults.startHole=10;
    template.betConfig.rabbits={...template.betConfig.rabbits,enabled:true,mode:"three_hole_blocks",value:250,hcpPct:80};
    template.betConfig.skins={...template.betConfig.skins,enabled:true,mode:"carry",value:125};
    template.betConfig.foursome={...template.betConfig.foursome,enabled:true,mode:"match",segmentSize:18,fixedValue:500,participantIds:ids.slice(0,4),matchPresses:[{id:"qa-second",scope:"second",startHole:1,multiplier:5}]};
    template.foursomeSegments=domain.segmentDefinitions(domain.playOrder(10),18).map(s=>({...s,basePair:ids.slice(0,2)}));
    for(const animal of ["vipers","camels","fish"])template.betConfig[animal]={...template.betConfig[animal],enabled:true,value:100,secondNinePressed:true,secondNineMultiplier:3,determinationMode:"most_events",mostEventsTieRule:"latest_tied_event"};
    group.gameTemplate=template;
    const parsed=domain.parseFrequentGroups(JSON.stringify([group]))[0];assert.ok(parsed?.gameTemplate);
    checked(await a.client.from("frequent_groups_cloud").insert({owner_id:a.id,local_id:parsed.id,name:parsed.name,snapshot:parsed}).select("id").single(),"Save own habitual group");
    const ensured=await app("/api/groups/invitations",a,"POST",{action:"ensure",group:parsed});groupId=ensured.groupId;assert.ok(groupId);
    assert.equal((await app("/api/groups/invitations",a,"POST",{action:"ensure",group:parsed})).groupId,groupId);
    const stored=checked(await a.client.from("groups_v2").select("default_template").eq("id",groupId).single(),"Read actual group template").default_template;
    assert.deepEqual(stored.gameTemplate,parsed.gameTemplate);
    let sequence=0;const draft=domain.instantiateGroupGameTemplate(stored,()=>`qa-round-${++sequence}`,ids.slice(0,4));
    assert.equal(draft.startHole,10);assert.equal(draft.bets.foursome.fixedValue,500);assert.equal(draft.bets.foursome.matchPresses[0].startHole,1);assert.equal(draft.bets.foursome.matchPresses[0].multiplier,5);assert.equal(draft.bets.rabbits.hcpPct,80);
    draft.bets.foursome.fixedValue=650;assert.equal(stored.gameTemplate.betConfig.foursome.fixedValue,500);
    passed.push("GROUP_ENSURE_IDEMPOTENT","FULL_TEMPLATE_REAL_DB_READBACK","ROUND_PRELOAD_H10_PRESSURE_CONFIG","ROUND_ONLY_EDIT_KEEPS_TEMPLATE");
    stage="INVITATION_CREATE_NO_OUTBOUND_MAIL";
    const inbox=await app(`/api/groups/invitations?localGroupId=${encodeURIComponent(parsed.id)}`,a);
    assert.equal(typeof inbox.emailDeliveryConfigured,"boolean");emailDeliveryConfigured=inbox.emailDeliveryConfigured;
    await app("/api/groups/invitations",a,"POST",{action:"create",groupId,email:"not-an-email"},400);
    await app("/api/groups/invitations",c,"POST",{action:"create",groupId,email:b.email},403);
    // Internal account invitations never invoke delivery; synthetic email-only
    // failure is tested separately, only when the provider is not configured.
    const invite=await app("/api/groups/invitations",a,"POST",{action:"create",groupId,targetUserId:b.id});
    assert.ok(invite.invitationId);
    assert.equal(invite.channel,"BACKYARD");
    const repeated=await app("/api/groups/invitations",a,"POST",{action:"create",groupId,targetUserId:b.id});
    assert.equal(repeated.invitationId,invite.invitationId);
    assert.ok((await app("/api/groups/invitations",b)).invitations.some(item=>item.id===invite.invitationId));
    passed.push("INTERNAL_INVITE_200_WITHOUT_MAILER","INTERNAL_RETRY_NO_DUPLICATE");
    if(!emailDeliveryConfigured){
      const mail=await app("/api/groups/invitations",a,"POST",{action:"create",groupId,email:`qa-mail-only-${runId}@example.invalid`},503);
      assert.equal(mail.deliveryStatus,"FAILED");assert.equal(mail.code,"GROUP_EMAIL_NOT_CONFIGURED");
      const retry=await app("/api/groups/invitations",a,"POST",{action:"retry",invitationId:mail.invitationId},503);assert.equal(retry.invitationId,mail.invitationId);assert.equal(retry.deliveryStatus,"FAILED");
      passed.push("MISSING_PROVIDER_REAL_API_FAILED_NOT_SENT","RETRY_NO_DUPLICATE_INVITATION");
    }
    assert.equal((await rpc(a,"create",{groupId,email:b.email})).invitationId,invite.invitationId);
    await app("/api/groups/invitations",c,"POST",{action:"accept",invitationId:invite.invitationId},403);
    await app("/api/groups/invitations",b,"POST",{action:"accept",invitationId:invite.invitationId,token:"0".repeat(64)},403);
    const accepted=await app("/api/groups/invitations",b,"POST",{action:"accept",invitationId:invite.invitationId});assert.equal(accepted.accepted,true);
    assert.equal((await app("/api/groups/invitations",b,"POST",{action:"accept",invitationId:invite.invitationId})).accepted,true);
    assert.equal(checked(await b.client.from("group_memberships_v2").select("id").eq("group_id",groupId).eq("user_id",b.id),"Read accepted membership").length,1);
    passed.push("WRONG_RECIPIENT_DENIED","WRONG_TOKEN_DENIED","REAL_API_VERIFIED_ACCEPTANCE","ACCEPT_IDEMPOTENT_NO_MEMBER_DUPLICATION");
    stage="POST_REGISTRATION_ACCEPTANCE";
    const futureEmail=`qa-group-future-${runId}@example.invalid`,future=await rpc(a,"create",{groupId,email:futureEmail});
    const d=await createAccount("d",futureEmail);
    assert.equal((await app("/api/groups/invitations",d)).invitations.some(item=>item.id===future.invitationId),true);
    assert.equal((await app("/api/groups/invitations",d,"POST",{action:"accept",invitationId:future.invitationId})).accepted,true);
    assert.equal(checked(await d.client.from("profiles").select("id").eq("id",d.id),"One profile after accept").length,1);
    passed.push("INVITE_BEFORE_REGISTRATION_ACCEPTS_VERIFIED_NEW_IDENTITY");
    stage="CLOUD_FRESH_SESSION_READBACK";
    await login(a);await login(b);
    const readback=await app(`/api/groups/invitations?localGroupId=${encodeURIComponent(parsed.id)}`,a);
    assert.equal(readback.acceptedMembers.filter(member=>member.accountUserId===b.id).length,1);assert.equal(readback.acceptedMembers.filter(member=>member.accountUserId===d.id).length,1);
    assert.equal((await app(`/api/groups/invitations?localGroupId=${encodeURIComponent(parsed.id)}`,b)).acceptedMembers.length,0);
    const stale=await app("/api/groups/invitations",a,"POST",{action:"ensure",group:parsed});
    assert.equal(stale.groupSnapshot.players.filter(member=>member.accountUserId===b.id).length,1);assert.deepEqual(stale.groupSnapshot.gameTemplate,parsed.gameTemplate);
    const joined=checked(await b.client.from("frequent_groups_cloud").select("snapshot").eq("owner_id",b.id).eq("local_id",`joined-${groupId}`).single(),"Fresh-session joined group").snapshot;
    assert.equal(joined.sourceGroupId,groupId);assert.deepEqual(joined.gameTemplate,parsed.gameTemplate);
    checked(await b.client.auth.signOut({scope:"local"}),"Logout test account");await login(b);
    assert.equal((await app("/api/groups/invitations",b)).invitations.find(item=>item.id===invite.invitationId)?.state,"ACCEPTED");
    passed.push("ACCEPTED_MEMBERS_FRESH_SESSION_OWNER_ONLY","STALE_ENSURE_PRESERVES_ACCEPTED_MEMBERS_AND_BETS","JOINED_GROUP_CLOUD_TEMPLATE_READBACK","LOGOUT_LOGIN_ACCEPTANCE_PERSISTS");
    stage="BLOCK_PRIVACY";
    checked(await c.client.from("blocked_connections").insert({owner_id:c.id,blocked_user_id:a.id}),"QA reciprocal block");
    assert.equal((await directory(a,c.email)).some(user=>user.user_id===c.id),false);assert.equal((await directory(c,a.email)).some(user=>user.user_id===a.id),false);
    await app("/api/groups/invitations",a,"POST",{action:"create",groupId,targetUserId:c.id},403);
    passed.push("RECIPROCAL_BLOCK_SEARCH_AND_INVITE");
  } catch(error){failure=error;}
  const report={preview:config.previewOrigin,projectRef:config.projectRef,runId,groupId,passed,emailDeliveryConfigured,
    ...(failure?{failedAt:stage,diagnostic,failureType:failure.name==="AssertionError"?"ASSERTION":"REQUEST"}:{}),
    fixtures:"RETAINED_NO_DELETE_AUTHORIZED",retainedQaUserIds:accounts.map(a=>a.id),
    emailReceipt:emailDeliveryConfigured?"PENDING_INTERACTIVE_QA":"BLOCKED_EXTERNAL",notCovered:["REAL_EMAIL_DELIVERY_OR_RECEIPT","PHYSICAL_IPHONE","GOOGLE_OR_EXTERNAL_OTP"]};
  log(JSON.stringify(report));
  if(failure)throw new Error(`Group invitations QA failed at ${stage}. Run ${runId}. Synthetic fixtures retained; no secrets logged.`);
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
  try{
    const args=process.argv.slice(2);
    if(args.length===1&&args[0]==="--run")await runPreviewGroupInvitationsQA();
    else if(args.length===1&&args[0]==="--check-config"){const config=profileCloudQaConfig();console.log(JSON.stringify({configuration:"VALID",projectRef:config.projectRef,preview:config.previewOrigin,network:"NOT_RUN"}));}
    else if(!args.length||(args.length===1&&args[0]==="--help"))console.log("Group invitation QA: exact bymeopxkxapfizeeqeyb and immutable Preview only. Compile tsconfig.test.json, then --check-config / --run. Creates synthetic example.invalid accounts and RETAINS fixtures. No outbound email when configured; missing-provider behavior is tested only after API readiness=false. Never claims inbox delivery.");
    else throw new Error("Use --help, --check-config or --run. No requests made.");
  }catch(error){console.error(error instanceof Error?error.message:"Group QA failed");process.exitCode=1;}
}
