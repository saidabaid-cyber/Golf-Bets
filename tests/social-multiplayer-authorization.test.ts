import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as achievements from '../lib/round-achievements';
import {safeSocialRoundCard} from '../lib/social-round-card';
import {socialActivityAuthor} from '../lib/social-author-profile';
import type {RoundSnapshot} from '../lib/types';
import type {SocialActivityCard} from '../lib/social-activity-contract';

test('server multiplayer reader uses viewer RLS, self-confirmed identities, current hashes and independent sharing; Feed omits peer hole cards',async()=>{
  const accounts=['owner','peer','unconfirmed','stale','private'],order=Array.from({length:18},(_,i)=>i+1);
  const snapshot:RoundSnapshot={id:'isolated',date:'2026-10-08',lifecycleState:'completed',completedAt:'2026-10-08T12:00:00Z',ownerId:'p0',roundHoles:18,order,
    courseName:'Private QA course',teeName:'Blancas',ownerName:'Synthetic 0',betResult:0,expenseTotal:0,netResult:0,categoryResults:{},expenses:{caddie:0,food:0,drinks:0,greenFee:0,cartRental:0,other:0},
    courseSnapshot:{id:'course',name:'Private QA course',teeName:'Blancas',holes:order.map(number=>({number,par:4,strokeIndex:number}))},
    players:accounts.map((accountUserId,i)=>({id:`p${i}`,accountUserId,name:`Synthetic ${i}`,handicap:0})),
    scores:Object.fromEntries(order.map(h=>[h,Object.fromEntries(accounts.map((id,i)=>[`p${i}`,4+i]))])),
  };
  const source={id:'canonical',owner_id:'owner',local_round_id:'isolated',version:4,snapshot};
  const rows=await Promise.all(accounts.map(async(author_id,i)=>({id:`activity${i}`,author_id,event_kind:'ROUND_COMPLETED',source_round_id:'canonical',active:true,source_version:4,material_hash:i===3?'outdated':await achievements.roundMaterialFingerprint(snapshot,author_id)})));
  const tables:Record<string,any[]>={rounds_cloud:[source],social_round_account_links_v3:accounts.slice(1).filter(id=>id!=='unconfirmed').map(id=>({round_id:'canonical',user_id:id,player_key:`p${accounts.indexOf(id)}`,verified_by:'SELF_CONFIRMED'})),
    profiles:accounts.map(id=>({id,name:id})),social_profiles:[],social_activity_preferences_v3:accounts.map(user_id=>({user_id,share_rounds:user_id!=='private',share_courses:false})),social_likes_v3:[],social_comments_v3:[],social_round_attestations_v3:[]};
  const queries:string[]=[];
  function client(admin:boolean){return{from(table:string){
    queries.push(`${admin?'admin':'viewer'}:${table}`);assert.ok(!(admin&&table==='social_activities_v3'),'never use admin to widen activity visibility');
    let data=table==='social_activities_v3'?rows.filter(r=>r.author_id!=='private'):[...(tables[table]||[])];
    const q:any={select:()=>q,eq:(key:string,value:any)=>{data=data.filter(r=>r[key]===value);return q;},in:(key:string,values:any[])=>{data=data.filter(r=>values.includes(r[key]));return q;},limit:(n:number)=>{data=data.slice(0,n);return q;},maybeSingle:async()=>({data:data[0]??null,error:null}),then:(resolve:any)=>Promise.resolve({data,error:null}).then(resolve)};
    return q;
  }}};
  const compiled=ts.transpileModule(readFileSync('lib/social-activity.server.ts','utf8')+'\nexports.testRead=attachVisibleLeaderboards;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:any={};runInNewContext(compiled,{exports,require:(id:string)=>id==='./round-achievements'?achievements:id==='./social-round-card'?{safeSocialRoundCard}:id==='./social-author-profile'?{socialActivityAuthor}:{}});
  const ctx={userId:'owner',client:client(false),admin:client(true)};
  const card={roundId:'canonical',author:{userId:'owner'},round:safeSocialRoundCard(source,'owner',true)} as SocialActivityCard;
  await exports.testRead(ctx,[card],false);
  assert.equal(card.round!.playerCards,undefined,'Feed summaries never acquire the peers detail');
  assert.deepEqual(Array.from(card.round!.leaderboard!,x=>x.userId),['owner','peer']);
  await exports.testRead(ctx,[card],true);
  assert.deepEqual(Array.from(card.round!.playerCards!,x=>x.author.userId),['owner','peer']);
  assert.equal(card.round!.playerCards![1].round.courseName,'Campo privado','per-author course consent respected');
  assert.deepEqual(Array.from(card.round!.playerCards![1].round.scorecard!,x=>x.score),Array(18).fill(5));
  assert.ok(queries.includes('viewer:social_activities_v3'));
  assert.doesNotMatch(JSON.stringify(card.round!.playerCards),/unconfirmed|outdated|Synthetic|handicap|balance/);
});
