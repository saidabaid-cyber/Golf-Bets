import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const scriptUrl = pathToFileURL(resolve("scripts/qa-preview-account-lifecycle.mjs")).href;
const bootstrap = `
  import assert from 'node:assert/strict';
  import { createHash, randomUUID } from 'node:crypto';
  globalThis.fetch = async()=>{throw new Error('REAL_NETWORK_FORBIDDEN_IN_TEST');};
  const { previewAccountConfig, runPreviewAccountQA } = await import(${JSON.stringify(scriptUrl)});
  const ref='bymeopxkxapfizeeqeyb';
  const env={PREVIEW_DB_REF:ref,QA_CONFIRM_ISOLATED_PREVIEW:ref,NEXT_PUBLIC_SUPABASE_URL:'https://'+ref+'.supabase.co',
    PREVIEW_QA_URL:'https://dev.thebackyard.com.mx',PREVIEW_QA_EXPECTED_SHA:'a'.repeat(40),NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_qa_contract_test_only',
    SUPABASE_SECRET_KEY:'sb_secret_qa_contract_test_only',QA_ACCOUNT_ADMIN_DOCUMENT_FIXTURE:'true'};
  const health=()=>Response.json({status:'ok',environment:'preview',buildSha:env.PREVIEW_QA_EXPECTED_SHA});
  const bindingResponse=input=>{const url=new URL(String(input));
    if(url.pathname==='/api/health')return health();
    if(url.origin===env.NEXT_PUBLIC_SUPABASE_URL&&url.pathname==='/auth/v1/settings')return Response.json({external:{email:true}});
    if(url.origin===env.NEXT_PUBLIC_SUPABASE_URL&&url.pathname==='/auth/v1/admin/users')return Response.json({users:[]});
    if(url.origin===env.PREVIEW_QA_URL&&url.pathname==='/')return new Response('<script src="/_next/static/main.js"></script>',{headers:{'content-type':'text/html; charset=utf-8'}});
    if(url.origin===env.PREVIEW_QA_URL&&url.pathname.endsWith('.js'))return new Response(env.NEXT_PUBLIC_SUPABASE_URL+' '+env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    return null;};
`;
function isolated(body: string) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", bootstrap + body], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
}

test("account Preview runner reuses exact isolation checks and proves deployment binding before any account creation", () => {
  isolated(`
    assert.equal(previewAccountConfig(env).projectRef,ref);
    let touched=false;const dependencies={fetcher:async()=>{touched=true;return new Response('unverified');},clientFactory:()=>{touched=true;}};
    for(const value of [{...env,QA_CONFIRM_ISOLATED_PREVIEW:''},{...env,PREVIEW_QA_URL:'https://app.thebackyard.com.mx'},
      {...env,PREVIEW_QA_URL:'https://beta.thebackyard.com.mx'},{...env,PREVIEW_QA_URL:'https://synthetic-preview-test-only.vercel.app'},
      {...env,PREVIEW_DB_REF:'zhqmlpljloumldaczcfp',QA_CONFIRM_ISOLATED_PREVIEW:'zhqmlpljloumldaczcfp'},
      {...env,PREVIEW_DB_REF:'abcdefghijklmnopqrst',QA_CONFIRM_ISOLATED_PREVIEW:'abcdefghijklmnopqrst',NEXT_PUBLIC_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co'},
      {...env,VERCEL_ENV:'production'},{...env,NEXT_PUBLIC_SUPABASE_URL:env.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1'}]){
      await assert.rejects(runPreviewAccountQA(value,dependencies));assert.equal(touched,false);
    }
    let created=false;
    await assert.rejects(runPreviewAccountQA(env,{fetcher:async(input)=>new URL(String(input)).pathname==='/api/health'?health():new Response('unverified'),clientFactory:()=>{created=true;}}),/root did not return HTML/);
    assert.equal(created,false);
  `);
});

test("account Preview runner executes delete/shared RLS/stale sync/archive and proof checks with synthetic transport, not cloud proof", () => {
  isolated(`
    const users=new Map([['existing-user',{id:'existing-user',email:'untouched@example.invalid',app_metadata:{}}]]);
    const rounds=new Map(),participants=new Map(),jobs=new Map(),deletedIds=new Set(),logs=[],objects=new Map();
    const profiles=new Map(),socialProfiles=new Map(),preferences=new Map(),choices=new Map(),equipment=new Map();
    const consents=new Map(),acceptances=new Map(),relationalClubs=new Map(),relationalBalls=new Map();
    const friendRequests=new Map(),friendships=new Map(),groups=new Map(),groupMemberships=new Map();
    const cloudCourses=new Map(),courseVersions=new Map(),golfClubs=new Map(),golfCourses=new Map(),golfTees=new Map(),teeNineRatings=new Map();
    const adminMemberships=new Map(),adminDocuments=new Map();
    let creates=0,deleteCalls=0,archiveCalls=0,adminDeletes=0,storageUploads=0;
    const ok=data=>({data,error:null});const failure=(status,code)=>({data:null,error:{status,code}});
    function replaceToken(value,oldToken,newToken){
      if(Array.isArray(value))return value.map(item=>replaceToken(item,oldToken,newToken));
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,nested])=>
        [key.replaceAll(oldToken,newToken),replaceToken(nested,oldToken,newToken)]));
      return typeof value==='string'?value.replaceAll(oldToken,newToken):value;
    }
    function scrub(round){
      for(const id of deletedIds){
        for(const player of round.snapshot.players)if(player.accountUserId===id||player.id?.includes(id)){
          player.name='Jugador eliminado';player.accountUserId=null;player.avatarUrl=null;player.identityDeleted=true;
        }
        if(round.owner_id===id){round.owner_id=null;round.snapshot.ownerName='Jugador eliminado';round.snapshot.accountUserId=null;}
        const token='deleted-'+createHash('sha256').update('round:'+round.id+':'+id).digest('hex').slice(0,28);
        round.snapshot=replaceToken(round.snapshot,id,token);
      }
      return round;
    }
    const tableRows=table=>{
      if(table==='profiles')return [...profiles.values()];if(table==='social_profiles')return [...socialProfiles.values()];
      if(table==='user_preferences')return [...preferences.values()];if(table==='profile_completion_choices')return [...choices.values()];
      if(table==='player_equipment_profiles')return [...equipment.values()];if(table==='ai_processing_consents')return [...consents.values()].flat();
      if(table==='player_clubs')return [...relationalClubs.values()];if(table==='player_balls')return [...relationalBalls.values()];
      if(table==='legal_acceptances')return [...acceptances.values()].flat();if(table==='rounds_cloud')return [...rounds.values()];
      if(table==='friend_requests')return [...friendRequests.values()];if(table==='friendships')return [...friendships.values()];
      if(table==='groups_v2')return [...groups.values()];if(table==='group_memberships_v2')return [...groupMemberships.values()];
      if(table==='courses_cloud')return [...cloudCourses.values()];if(table==='course_versions')return [...courseVersions.values()];
      if(table==='golf_clubs')return [...golfClubs.values()];if(table==='golf_courses')return [...golfCourses.values()];
      if(table==='golf_course_tees')return [...golfTees.values()];if(table==='golf_tee_nine_ratings')return [...teeNineRatings.values()];
      if(table==='admin_memberships')return [...adminMemberships.values()];if(table==='admin_documents')return [...adminDocuments.values()];
      throw new Error('Unexpected mock table '+table);
    };
    const ownerColumn=table=>table==='profiles'?'id':table==='rounds_cloud'||table==='courses_cloud'||table==='groups_v2'?'owner_id'
      :table==='friend_requests'?'requester_id':table==='friendships'?'user_a_id'
      :table==='course_versions'||table==='golf_clubs'||table==='golf_courses'||table==='admin_documents'?'created_by'
      :table==='golf_course_tees'||table==='golf_tee_nine_ratings'?'course_id':'user_id';
    const storeRows=(table,values)=>{const stored=[];
      for(const source of values){const row=source.id?source:{...source,id:randomUUID()};const id=row[ownerColumn(table)];
        if(table==='profiles')profiles.set(id,row);else if(table==='social_profiles')socialProfiles.set(id,row);
        else if(table==='user_preferences')preferences.set(id,row);else if(table==='profile_completion_choices')choices.set(id,row);
        else if(table==='player_equipment_profiles')equipment.set(id,row);
        else if(table==='player_clubs')relationalClubs.set(row.id,row);else if(table==='player_balls')relationalBalls.set(row.id,row);
        else if(table==='ai_processing_consents')consents.set(id,[...(consents.get(id)||[]),row]);
        else if(table==='legal_acceptances')acceptances.set(id,[...(acceptances.get(id)||[]),row]);
        else if(table==='friend_requests')friendRequests.set(row.id,row);else if(table==='friendships')friendships.set(row.id,row);
        else if(table==='groups_v2')groups.set(row.id,row);else if(table==='group_memberships_v2')groupMemberships.set(row.id,row);
        else if(table==='courses_cloud')cloudCourses.set(row.id,row);else if(table==='course_versions')courseVersions.set(row.id,row);
        else if(table==='golf_clubs')golfClubs.set(row.id,row);else if(table==='golf_courses')golfCourses.set(row.id,row);
        else if(table==='golf_course_tees')golfTees.set(row.id,row);else if(table==='golf_tee_nine_ratings')teeNineRatings.set(row.id,row);
        else if(table==='admin_memberships')adminMemberships.set(row.id,row);else if(table==='admin_documents')adminDocuments.set(row.id,row);
        stored.push(row);}
      return stored;
    };
    const removePrivateData=id=>{
      profiles.delete(id);socialProfiles.delete(id);preferences.delete(id);choices.delete(id);equipment.delete(id);consents.delete(id);acceptances.delete(id);
      for(const [rowId,row] of [...relationalClubs])if(row.user_id===id)relationalClubs.delete(rowId);
      for(const [rowId,row] of [...relationalBalls])if(row.user_id===id)relationalBalls.delete(rowId);
      for(const [rowId,row] of [...friendRequests])if(row.requester_id===id||row.addressee_id===id)friendRequests.delete(rowId);
      for(const [rowId,row] of [...friendships])if(row.user_a_id===id||row.user_b_id===id)friendships.delete(rowId);
      for(const [rowId,row] of [...groupMemberships])if(row.user_id===id)groupMemberships.delete(rowId);
      for(const [groupId,row] of [...groups])if(row.owner_id===id){
        const shared=[...groupMemberships.values()].some(member=>member.group_id===groupId&&member.user_id!==id&&users.has(member.user_id));
        if(shared){row.owner_id=null;row.default_template={...row.default_template,accountUserId:null};}
        else {groups.delete(groupId);for(const [membershipId,member] of [...groupMemberships])if(member.group_id===groupId)groupMemberships.delete(membershipId);}
      }
      for(const [courseId,row] of [...cloudCourses])if(row.owner_id===id){cloudCourses.delete(courseId);
        for(const [versionId,version] of [...courseVersions])if(version.course_id===courseId)courseVersions.delete(versionId);}
      const ownedCourseIds=new Set([...golfCourses.values()].filter(row=>row.created_by===id).map(row=>row.id));
      for(const [ratingId,row] of [...teeNineRatings])if(ownedCourseIds.has(row.course_id))teeNineRatings.delete(ratingId);
      for(const [teeId,row] of [...golfTees])if(ownedCourseIds.has(row.course_id))golfTees.delete(teeId);
      for(const [courseId,row] of [...golfCourses])if(row.created_by===id)golfCourses.delete(courseId);
      for(const [clubId,row] of [...golfClubs])if(row.created_by===id)golfClubs.delete(clubId);
      for(const [membershipId,row] of [...adminMemberships])if(row.user_id===id)adminMemberships.delete(membershipId);
      for(const row of adminDocuments.values())if(row.created_by===id){
        const sourceKey='admin-documents-private:'+row.storage_path;
        const targetPath='account-lifecycle-shared/'+row.id+'.pdf',targetKey='admin-documents-private:'+targetPath;
        const source=objects.get(sourceKey);assert.equal(source?.ownerId,id);
        objects.set(targetKey,{bucket:'admin-documents-private',path:targetPath,data:source.data,ownerId:null});
        objects.delete(sourceKey);row.storage_path=targetPath;row.created_by=null;
      }
      for(const [key,object] of [...objects])if(object.ownerId===id)objects.delete(key);
      for(const [roundId,row] of [...rounds])if(row.owner_id===id){
        const participant=participants.get(roundId);
        if(participant&&users.has(participant)){scrub(row);row.owner_id=null;}else{rounds.delete(roundId);participants.delete(roundId);}
      }else scrub(row);
    };
    const clientFactory=(_url,key)=>{
      const admin=key===env.SUPABASE_SECRET_KEY;let signedIn=null;
      return {auth:{admin:{
        createUser:async(input)=>{assert.ok(admin);assert.equal([...users.values()].some(user=>user.email===input.email),false);
          creates++;users.set(input.id,{...input});
          const username='fresh_'+input.id.replaceAll('-','').slice(0,18);
          profiles.set(input.id,{id:input.id,display_name:'',username,avatar_url:null,default_handicap:null,home_club:null,preferred_tee:null,handedness:null,onboarding_completed_at:null});
          socialProfiles.set(input.id,{user_id:input.id,username,display_name:'Golfista',avatar_url:null});return ok({user:users.get(input.id)});},
        getUserById:async(id)=>{assert.ok(admin);return users.has(id)?ok({user:structuredClone(users.get(id))}):failure(404,'user_not_found');},
        deleteUser:async()=>{adminDeletes++;throw new Error('Runner must not bypass lifecycle for app-populated or archived accounts');}
      },signInWithPassword:async({email,password})=>{
        const identity=[...users.values()].find(u=>u.email===email&&u.password===password);
        if(identity?.banned_until)return failure(403,'user_banned');
        if(!identity)return failure(400,'invalid_credentials');signedIn=identity.id;return ok({user:identity,session:{access_token:'qa-token-'+identity.id}});
      }},storage:{from:bucket=>({
        upload:async(path,data)=>{assert.ok(['scorecard-photos','admin-documents-private'].includes(bucket));assert.ok(!admin&&path.startsWith(signedIn+'/'));
          storageUploads++;objects.set(bucket+':'+path,{bucket,path,data,ownerId:signedIn});return ok({path});},
        list:async(prefix)=>ok([...objects.values()].filter(object=>object.bucket===bucket&&object.path.startsWith(prefix+'/'))
          .map(object=>({name:object.path.slice(prefix.length+1)}))),
        remove:async(paths)=>{for(const path of paths)objects.delete(bucket+':'+path);return ok(paths.map(path=>({name:path})));}
      })},from:table=>{
        const filters={};let action='select',payload=null;
        const execute=()=>{
          if(!admin&&users.get(signedIn)?.banned_until)return failure(403,'42501');
          if(table==='round_participants_v2'&&action==='insert'){
            assert.equal(rounds.get(payload.round_id).owner_id,signedIn);participants.set(payload.round_id,payload.user_id);return ok(null);
          }
          if(table==='rounds_cloud'){
            let rows=tableRows(table).filter(row=>Object.entries(filters).every(([k,v])=>row[k]===v));
            if(!admin)rows=rows.filter(row=>row.owner_id===signedIn||participants.get(row.id)===signedIn);
            if(action==='update')for(const row of rows){assert.equal(row.owner_id,signedIn);row.snapshot=structuredClone(payload.snapshot);scrub(row);}
            return ok(structuredClone(rows));
          }
          let rows=tableRows(table).filter(row=>Object.entries(filters).every(([k,v])=>row[k]===v));
          if(!admin){
            if(table==='friend_requests')rows=rows.filter(row=>row.requester_id===signedIn||row.addressee_id===signedIn);
            else if(table==='friendships')rows=rows.filter(row=>row.user_a_id===signedIn||row.user_b_id===signedIn);
            else if(table==='groups_v2')rows=rows.filter(row=>row.owner_id===signedIn||[...groupMemberships.values()].some(member=>member.group_id===row.id&&member.user_id===signedIn));
            else if(table==='group_memberships_v2')rows=rows.filter(row=>groups.get(row.group_id)?.owner_id===signedIn||[...groupMemberships.values()].some(member=>member.group_id===row.group_id&&member.user_id===signedIn));
            else if(table==='course_versions')rows=rows.filter(row=>cloudCourses.get(row.course_id)?.owner_id===signedIn);
            else rows=rows.filter(row=>row[ownerColumn(table)]===signedIn);
          }
          if(action==='update'){for(const row of rows){Object.assign(row,structuredClone(payload));
            if(table==='friend_requests'&&row.state==='ACCEPTED'){
              const pair=[row.requester_id,row.addressee_id].sort();
              if(![...friendships.values()].some(friend=>friend.user_a_id===pair[0]&&friend.user_b_id===pair[1]))
                storeRows('friendships',[{user_a_id:pair[0],user_b_id:pair[1],request_id:row.id}]);
            }
          }}
          if(action==='insert'||action==='upsert'){const values=(Array.isArray(payload)?payload:[payload]).map(value=>structuredClone(value));
            if(!admin)for(const value of values){
              if(['social_profiles','user_preferences','profile_completion_choices','player_equipment_profiles','player_clubs','player_balls','ai_processing_consents','legal_acceptances'].includes(table))assert.equal(value.user_id,signedIn);
              if(table==='friend_requests')assert.equal(value.requester_id,signedIn);
              if(table==='groups_v2'||table==='courses_cloud')assert.equal(value.owner_id,signedIn);
              if(['course_versions','golf_clubs','golf_courses'].includes(table))assert.equal(value.created_by,signedIn);
              if(table==='golf_course_tees')assert.equal(golfCourses.get(value.course_id)?.created_by,signedIn);
              if(table==='admin_documents'){
                assert.equal(value.created_by,signedIn);
                assert.ok([...adminMemberships.values()].some(membership=>membership.user_id===signedIn&&membership.active));
              }
              if(table==='group_memberships_v2')assert.ok(groups.get(value.group_id)?.owner_id===signedIn
                ||[...groupMemberships.values()].some(member=>member.group_id===value.group_id&&member.user_id===signedIn&&member.role==='ADMIN'));
            }
            if(action==='upsert'){const saved=[];for(const value of values){const current=tableRows(table).find(row=>row[ownerColumn(table)]===value[ownerColumn(table)]);if(current){Object.assign(current,value);saved.push(current);}else saved.push(...storeRows(table,[value]));}rows=saved;}
            else rows=storeRows(table,values);}
          return ok(structuredClone(rows));
        };
        const q={select:()=>q,eq:(k,v)=>{filters[k]=v;return q;},order:()=>q,
          single:async()=>{const result=execute();return result.error?result:result.data.length?ok(result.data[0]):failure(404,'PGRST116');},
          maybeSingle:async()=>{const result=execute();return result.error?result:ok(result.data[0]||null);},
          insert:v=>{action='insert';payload=v;return q;},upsert:v=>{action='upsert';payload=v;return q;},update:v=>{action='update';payload=v;return q;},
          then:(resolve,reject)=>Promise.resolve().then(execute).then(resolve,reject)};return q;
      }};
    };
    const transport=async(input,init={})=>{
      assert.equal(init.redirect,'error');const url=new URL(String(input));
      const binding=bindingResponse(input);if(binding)return binding;
      const body=init.body?JSON.parse(init.body):null;const token=init.headers.authorization||'';
      const id=token.startsWith('Bearer qa-token-')?token.slice('Bearer qa-token-'.length):null;
      if(url.pathname==='/api/account/delete'){
        if(body.confirmation!=='ELIMINAR'||body.userId)return Response.json({code:'INVALID_ACCOUNT_DELETE_CHOICE',error:'Confirma escribiendo ELIMINAR y selecciona qué hacer con tus datos de golf.'},{status:400});
        const existing=jobs.get(body.requestId);
        if(existing){
          if(existing.proof!==body.recoveryToken)return Response.json({code:'AUTH_REQUIRED',error:'La sesión terminó. Vuelve a iniciar sesión.'},{status:401});
          return Response.json(existing.response);
        }
        assert.ok(id&&users.has(id));assert.equal(body.recoveryToken.length,64);
        const archived=body.dataPolicy==='retain_history';
        if(archived){archiveCalls++;users.get(id).banned_until='2099-01-01T00:00:00.000Z';}
        else{deleteCalls++;users.delete(id);deletedIds.add(id);removePrivateData(id);}
        const response={ok:true,deleted:!archived,archived,accountStatus:archived?'archived':'deleted'};
        jobs.set(body.requestId,{proof:body.recoveryToken,response});return Response.json(response);
      }
      if(!id||!users.has(id))return Response.json({error:'La sesión terminó. Vuelve a iniciar sesión para conectar la nube.',code:'AUTH_REQUIRED'},{status:401});
      if(url.pathname==='/api/equipment'){
        if(users.get(id)?.banned_until)return Response.json({error:'Esta cuenta está desactivada o tiene una operación de cierre pendiente. Contacta soporte para recuperarla.',code:'ACCOUNT_ACCESS_RESTRICTED'},{status:403});
        if(init.method==='PUT'){const row={user_id:id,snapshot:structuredClone(body.profile),version:1,last_mutation_id:body.mutationId,updated_at:new Date().toISOString()};equipment.set(id,row);return Response.json({data:{profile:row.snapshot,version:1}});}
        const row=equipment.get(id);return Response.json({data:row?{profile:structuredClone(row.snapshot),version:row.version}:null});
      }
      if(url.pathname==='/api/backyard-ai/consent'){
        const scopes=['AI_PROVIDER_PROCESSING_CONSENT','AI_IMAGE_PROCESSING_CONSENT','AI_LAUNCH_MONITOR_PROCESSING_CONSENT'];
        if(init.method==='POST'){const rows=body.decisions.map((decision,index)=>({user_id:id,id:index+1,scope:decision.scope,status:decision.accepted?'accepted':'declined',decision_status:decision.accepted?'accepted':'declined',active:decision.accepted}));consents.set(id,rows);
          return Response.json({resolved:true,decisions:rows});}
        const rows=consents.get(id)||[];return Response.json({resolved:rows.length===scopes.length,decisions:scopes.map(scope=>{const row=rows.find(item=>item.scope===scope);return row||{scope,status:'missing',active:false};})});
      }
      if(url.pathname==='/api/account/entry'){
        const profile=profiles.get(id),types=(acceptances.get(id)||[]).map(row=>row.type);
        return Response.json({userId:id,profileExists:Boolean(profile),existingAccount:Boolean(profile?.onboarding_completed_at||(types.includes('terms')&&types.includes('privacy'))),onboardingProgress:null});
      }
      if(url.pathname==='/api/admin/access')return Response.json({hasAccess:[...adminMemberships.values()]
        .some(membership=>membership.user_id===id&&membership.active)});
      assert.equal(url.pathname,'/api/cloud/rounds');
      if(init.method==='GET')return Response.json({rounds:[...rounds.values()]
        .filter(row=>row.owner_id===id||participants.get(row.id)===id)
        .map(row=>row.owner_id===id?row.snapshot:{...row.snapshot,id:'shared:'+row.id,cloudRoundId:row.id,cloudReadOnly:true})});
      assert.equal(init.method,'POST');
      const roundId=randomUUID();rounds.set(roundId,{id:roundId,owner_id:id,snapshot:body.round});return Response.json({roundId},{status:201});
    };
    const result=await runPreviewAccountQA(env,{fetcher:transport,clientFactory,log:value=>logs.push(JSON.parse(value))});
    assert.equal(creates,4);assert.equal(deleteCalls,3);assert.equal(archiveCalls,1);assert.equal(adminDeletes,0);assert.equal(storageUploads,2);
    assert.equal(result.passed.length,43);assert.deepEqual(result.retainedQaUserIds,[]);assert.equal(result.archivedQaFixtures.length,1);
    assert.equal(result.preservedSharedFixtures.length,1);
    assert.equal(result.databaseVerification.deletedUserId,result.freshStart.deletedUserId);
    assert.equal(result.databaseVerification.adminDocumentId,result.preservedSharedFixtures[0].documentId);
    assert.ok(result.freshStart);assert.notEqual(result.freshStart.deletedUserId,result.freshStart.recreatedUserId);
    assert.equal(result.freshStart.sameEmailRecreated,true);assert.equal(result.freshStart.statisticsScoredRounds,0);assert.equal(objects.size,1);
    assert.equal(users.size,2);assert.ok(users.has('existing-user'));
    assert.equal(relationalClubs.size,0);assert.equal(relationalBalls.size,0);assert.equal(friendRequests.size,0);assert.equal(friendships.size,0);
    assert.equal(cloudCourses.size,0);assert.equal(courseVersions.size,0);assert.equal(golfClubs.size,0);assert.equal(golfCourses.size,0);
    assert.equal(golfTees.size,0);assert.equal(teeNineRatings.size,0);assert.equal(adminMemberships.size,0);assert.equal(adminDocuments.size,1);
    const preservedDocument=[...adminDocuments.values()][0],preservedObject=[...objects.values()][0];
    assert.equal(preservedDocument.created_by,null);assert.equal(preservedDocument.storage_path,'account-lifecycle-shared/'+preservedDocument.id+'.pdf');
    assert.equal(preservedObject.path,preservedDocument.storage_path);assert.equal(preservedObject.ownerId,null);
    assert.equal(groups.size,1);assert.equal(groupMemberships.size,1);
    assert.equal(logs[0].cleanup,'ONLY_INTENTIONAL_SHARED_AND_ARCHIVE_FIXTURES_RETAINED');
    assert.equal(result.archivedQaFixtures[0].roundIds.length,2);assert.equal(result.archivedQaFixtures[0].groupIds.length,1);
    assert.doesNotMatch(JSON.stringify(logs),/qa-token-|sb_secret|sb_publishable|recoveryToken|@example|example\.invalid|Lifecycle QA|qa_deleted_/);
    assert.ok(logs[0].coverageExcludes.includes('Social activity likes/comments/attest'));assert.ok(!logs[0].coverageExcludes.includes('Group ownership'));
    assert.ok(!logs[0].coverageExcludes.includes('Storage uploads'));
  `);
});

test("account Preview runner never deletes an existing/unproven identity during failed setup cleanup", () => {
  isolated(`
    let attempted,deleted=0;const logs=[];
    const clientFactory=()=>({auth:{admin:{
      createUser:async(input)=>{attempted=input;return {data:{user:input},error:null};},
      getUserById:async()=>({data:{user:{...attempted,app_metadata:{qa_run_id:'different-run'}}},error:null}),
      deleteUser:async()=>{deleted++;return {data:{},error:null};}
    },signInWithPassword:async()=>({data:{},error:{status:400}})}});
    const bundle=async(input)=>bindingResponse(input)||new Response('unexpected',{status:500});
    await assert.rejects(runPreviewAccountQA(env,{fetcher:bundle,clientFactory,log:value=>logs.push(JSON.parse(value))}),/Remote account QA failed/);
    assert.equal(deleted,0);assert.equal(logs[0].cleanup,'QA_CLEANUP_PENDING');
    assert.deepEqual(logs[0].retainedQaUserIds,[attempted.id]);assert.ok(!JSON.stringify(logs).includes(attempted.password));
  `);
});

test("account cleanup never calls a changed alias and directly removes only the exact run-marked Auth identity", () => {
  isolated(`
    let attempted,deleted=false,adminDeletes=0,appDeletes=0,healthCalls=0;const logs=[];
    const clientFactory=()=>({auth:{admin:{
      createUser:async(input)=>{attempted=input;return {data:{user:input},error:null};},
      getUserById:async(id)=>deleted?{data:{user:null},error:{status:404,code:'user_not_found'}}:{data:{user:attempted},error:null},
      deleteUser:async(id)=>{assert.equal(id,attempted.id);adminDeletes++;deleted=true;return {data:{},error:null};}
    },signInWithPassword:async()=>({data:{},error:{status:400,code:'invalid_credentials'}})}});
    const transport=async(input)=>{const url=new URL(String(input));
      if(url.pathname==='/api/health'){healthCalls++;return healthCalls<=2?health():Response.json({status:'ok',environment:'preview',buildSha:'b'.repeat(40)});}
      if(url.pathname==='/api/account/delete')appDeletes++;
      return bindingResponse(input)||new Response('unexpected',{status:500});
    };
    await assert.rejects(runPreviewAccountQA(env,{fetcher:transport,clientFactory,log:value=>logs.push(JSON.parse(value))}),/Remote account QA failed/);
    assert.equal(adminDeletes,1);assert.equal(appDeletes,0);assert.equal(deleted,true);
    assert.equal(logs[0].cleanup,'COMPLETE');
    assert.equal(logs[0].cleanupModes[0].mode,'ADMIN_DIRECT_AFTER_ALIAS_REVALIDATION_FAILURE');
  `);
});

test("account Preview runner default/help/check-config never execute remote writes", () => {
  for (const args of [[], ["--help"], ["--check-config"]]) {
    const ref = "bymeopxkxapfizeeqeyb";
    const result = spawnSync(process.execPath, ["scripts/qa-preview-account-lifecycle.mjs", ...args], { encoding: "utf8", timeout: 15_000,
      env: { ...process.env, VERCEL: "", VERCEL_ENV: "", PREVIEW_DB_REF: ref, QA_CONFIRM_ISOLATED_PREVIEW: ref,
        NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`, PREVIEW_QA_URL: "https://dev.thebackyard.com.mx", PREVIEW_QA_EXPECTED_SHA: "a".repeat(40),
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_qa_contract_test_only", SUPABASE_SECRET_KEY: "sb_secret_qa_contract_test_only" } });
    assert.equal(result.status, 0, result.stderr);
    if (args[0] === "--check-config") assert.equal(JSON.parse(result.stdout).network, "NOT_RUN");
    else assert.match(result.stdout, /Explicit execution/);
    assert.doesNotMatch(result.stdout, /sb_secret_|sb_publishable_|Bearer/);
  }
});
