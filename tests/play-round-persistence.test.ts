import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { linkedRoundPlayers } from '../lib/shared-round-participants';
import { mergeLocalAndCloud, type CloudDataBundle } from '../lib/cloud-sync';
import { preserveUnfinishedRound, unfinishedRoundDraft } from '../lib/unfinished-round';
import { initialBets } from '../lib/new-round-bets';
import { cancellationMaterial } from '../lib/owner-round-cancel';
import type { RoundSnapshot } from '../lib/types';

// Isolated PostgreSQL, no user account, remote requests or notification delivery.
const owner='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
function card():RoundSnapshot {
  return {id:'isolated-round',date:'2026-10-09',ownerId:'main',ownerName:'Isolated QA',
    lifecycleState:'live',startedAt:'2026-10-09T12:00:00Z',scorekeeping:{version:1,mode:'owner',organizerAccountUserId:owner},
    courseName:'Isolated card',teeName:'Tee',roundHoles:18,startHole:1,
    courseSnapshot:{id:'isolated-course',name:'Isolated card',teeName:'Tee',holes:Array.from({length:18},(_,i)=>({number:i+1,par:4,strokeIndex:i+1}))},
    players:[{id:'main',accountUserId:owner,name:'Isolated QA',handicap:null}],
    playerTeeAssignments:[],betConfig:initialBets([]),presentation:{version:1,playMode:'score_only',groupNassauTerm:'polla'},
    scores:{1:{main:4},2:{main:5}},order:Array.from({length:18},(_,i)=>i+1),betResult:0,expenseTotal:0,netResult:0,categoryResults:{},
    expenses:{caddie:0,food:0,drinks:0,greenFee:0,cartRental:0,other:0}};
}
function bundle(history:RoundSnapshot[],activeDraft:unknown):CloudDataBundle {
  return {version:1,history,activeDraft,frequentPlayers:[],frequentGroups:[],courses:[],rivals:[],tombstones:[],preferences:{language:'es-MX',highContrast:false,notificationsEnabled:false,defaultHandicap:null}};
}
const routeJs=ts.transpileModule(readFileSync('app/api/cloud/rounds/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function database() {
  const db=new PGlite();await db.exec(`create table rounds_cloud(id text primary key,owner_id text,local_id text,version integer,snapshot jsonb,updated_at timestamptz);
    create table user_cloud_state(user_id text primary key,active_draft jsonb,updated_at timestamptz);
    create function bump() returns trigger language plpgsql as $$begin new.version:=old.version+1;return new;end$$;
    create trigger bump before update on rounds_cloud for each row execute function bump();`);
  const snapshot=card(),draft=unfinishedRoundDraft(snapshot);
  await db.query('insert into rounds_cloud values($1,$2,$3,4,$4,now())',['canonical-round',owner,snapshot.id,JSON.stringify(snapshot)]);
  await db.query('insert into user_cloud_state values($1,$2,now())',[owner,JSON.stringify(draft)]);
  return db;
}
function adapter(db:PGlite,userId=owner) {
  const writes:string[]=[];
  const client={auth:{getUser:async()=>({data:{user:{id:userId}},error:null})},from(table:string){
    assert.ok(['rounds_cloud','user_cloud_state'].includes(table));
    const filters:Array<[string,unknown]>=[];let values:Record<string,unknown>|null=null;
    const execute=async()=>{
      const args:unknown[]=[];
      const where=filters.map(([key,value])=>{
        assert.ok(['id','owner_id','local_id','version','user_id','active_draft->>roundId'].includes(key));
        args.push(value);return `${key==='active_draft->>roundId'?"active_draft->>'roundId'":key}=$${args.length}`;
      }).join(' and ');
      if(values){
        const set=Object.entries(values).map(([key,value])=>{assert.ok(['snapshot','active_draft','updated_at'].includes(key));args.push(typeof value==='object'&&value!==null?JSON.stringify(value):value);return `${key}=$${args.length}`;});
        writes.push(table);
        const result=await db.query(`update ${table} set ${set.join(',')} where ${where} returning *`,args);
        return {data:result.rows[0]??null,error:null};
      }
      const result=await db.query(`select * from ${table} where ${where}`,args);
      return {data:result.rows[0]??null,error:null};
    };
    const q={select(){return q;},eq(key:string,value:unknown){filters.push([key,value]);return q;},update(value:Record<string,unknown>){values=value;return q;},maybeSingle:execute,then:(yes:(value:unknown)=>unknown,no:(error:unknown)=>unknown)=>execute().then(value=>yes(value),error=>no(error))};
    return q;
  }};
  const exports:any={};
  runInNewContext(routeJs,{exports,Date,Number,JSON,require(name:string){
    if(name==='next/server')return {NextResponse:{json:(body:unknown,config:any={})=>({body,status:config.status||200})}};
    if(name.endsWith('supabase/server'))return {getSupabaseForUser:()=>client};
    if(name.endsWith('auth-errors'))return {authUserFailure:()=>null};
    if(name.endsWith('shared-round-participants'))return {linkedRoundPlayers};
    if(name.endsWith('owner-round-cancel'))return {cancellationMaterial};
    if(name.endsWith('shared-round-participants.server'))return {syncSharedRoundParticipants:async()=>({delivered:0})};
    if(name.endsWith('social-publication-policy'))return {hasCompletedRoundPublicationCandidate:()=>false};
    if(name.endsWith('social-publication.server'))return {scheduleSocialPublication:()=>assert.fail('No test notifications')};
    return {};
  }});
  return {put:(round:RoundSnapshot,version=4)=>exports.PUT({headers:new Headers({authorization:'Bearer isolated-token'}),json:async()=>({round,expectedVersion:version})}),writes};
}

test('actual cancellation route persists a partial card, clears matching active slot and survives reload',async()=>{
  const db=await database();try{
    const live=card(),closed=preserveUnfinishedRound(live,2,'cancelled'),route=adapter(db);
    const result=await route.put(closed);assert.equal(result.status,200);
    const saved=(await db.query<{snapshot:RoundSnapshot;version:number}>('select snapshot,version from rounds_cloud')).rows[0];
    assert.equal(saved.version,5);assert.equal(saved.snapshot.lifecycleState,'cancelled');assert.deepEqual(saved.snapshot.scores,live.scores);
    assert.equal(saved.snapshot.completedAt,undefined);assert.equal(unfinishedRoundDraft(saved.snapshot),null);
    assert.equal((await db.query<{active_draft:unknown}>('select active_draft from user_cloud_state')).rows[0].active_draft,null);
    const reloaded=mergeLocalAndCloud(bundle([live],unfinishedRoundDraft(live)),bundle([saved.snapshot],null));
    assert.equal(reloaded.activeDraft,null);assert.equal(reloaded.history.length,1);assert.deepEqual(reloaded.history[0].scores,live.scores);
    assert.deepEqual(route.writes,['rounds_cloud','user_cloud_state']);
    assert.equal((await route.put(live,5)).status,409); // stale live device cannot reopen
  }finally{await db.close();}
});
test('cancellation does not clear a different active round, and owner/CAS failures perform no writes',async()=>{
  const db=await database();try{
    const closed=preserveUnfinishedRound(card(),2,'cancelled');
    const stale=adapter(db);assert.equal((await stale.put(closed,3)).status,409);assert.equal(stale.writes.length,0);
    const outsider=adapter(db,other);assert.equal((await outsider.put(closed)).status,404);assert.equal(outsider.writes.length,0);
    await db.query('update user_cloud_state set active_draft=$1',[JSON.stringify({roundId:'new-round',scores:{}})]);
    assert.equal((await adapter(db).put(closed)).status,200);
    assert.equal((await db.query<{active_draft:{roundId:string}}>('select active_draft from user_cloud_state')).rows[0].active_draft.roundId,'new-round');
  }finally{await db.close();}
});
test('save/exit and starting another round preserve the same card; scoreless setup remains a draft',()=>{
  const live=card(),parked=preserveUnfinishedRound(live,2,'live'),reloaded=unfinishedRoundDraft(JSON.parse(JSON.stringify(parked)))!;
  assert.equal(reloaded.roundId,live.id);assert.equal(reloaded.currentIndex,2);assert.deepEqual(reloaded.scores,live.scores);assert.deepEqual(reloaded.players,live.players);
  const draft=preserveUnfinishedRound({...live,startedAt:undefined,scores:{}},0,'live');assert.equal(draft.lifecycleState,'draft');
  assert.equal(unfinishedRoundDraft(draft)!.lifecycleState,'draft');
  assert.equal(parked.completedAt,undefined);assert.equal(parked.netResult,0);
});

test('uncertain cancel acknowledgement can retry matching draft cleanup without revising or replacing the closed card',async()=>{
  const db=await database();try{
    const closed=preserveUnfinishedRound(card(),2,'cancelled');
    const first=await adapter(db).put(closed);assert.equal(first.status,200);
    await db.query('update user_cloud_state set active_draft=$1',[JSON.stringify(unfinishedRoundDraft(card()))]);
    const retry=adapter(db);const response=await retry.put(closed,5);
    assert.equal(response.status,200);assert.equal(response.body.alreadyCancelled,true);
    assert.deepEqual(retry.writes,['user_cloud_state']);
    const saved=(await db.query<{snapshot:RoundSnapshot;version:number}>('select snapshot,version from rounds_cloud')).rows[0];
    assert.equal(saved.version,5);assert.deepEqual(saved.snapshot.scores,card().scores);
    assert.equal((await db.query<{active_draft:unknown}>('select active_draft from user_cloud_state')).rows[0].active_draft,null);
    assert.equal((await adapter(db).put({...closed,scores:{1:{main:9}}},5)).status,409);
  }finally{await db.close();}
});
