import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as domain from "../features/notifications/domain";

const owner="11111111-1111-4111-8111-111111111111",peer="22222222-2222-4222-8222-222222222222",roundId="33333333-3333-4333-8333-333333333333",requestId="44444444-4444-4444-8444-444444444444",activityId="55555555-5555-4555-8555-555555555555";
function harness({enabled=true,inApp=true,notifyFriendRequest=true,linked=true,completed=true,profileError=false}={}){
  const events=[{id:"round",recipient_id:owner,event_type:"round_started",resource_id:roundId},
    {id:"card",recipient_id:owner,event_type:"scorecard_ready",resource_id:roundId},
    {id:"friend",recipient_id:owner,event_type:"friend_request",resource_id:requestId},
    {id:"accepted",recipient_id:peer,event_type:"friend_accepted",resource_id:requestId},
    {id:"like",recipient_id:owner,event_type:"like",resource_id:activityId},
    {id:"foreign",recipient_id:peer,event_type:"like",resource_id:activityId},
    {id:"missing",recipient_id:owner,event_type:"like",resource_id:"66666666-6666-4666-8666-666666666666"}].map(row=>({...row,resource_type:"ROUND",created_at:"2026-10-05T12:00:00Z",read_at:null as string|null}));
  const tables:Record<string,unknown[]>={
    notification_events_v2:events,notification_preferences_v2:[{user_id:owner,event_type:"round_started",in_app:inApp}],
    user_preferences:[{user_id:owner,notifications_enabled:enabled}],
    social_activity_preferences_v3:[{user_id:owner,notify_friend_request:notifyFriendRequest}],
    rounds_cloud:[{id:roundId,owner_id:peer,snapshot:{lifecycleState:completed?"completed":"live",players:linked?[{accountUserId:owner}]:[{accountUserId:peer}],courseSnapshot:{name:"QA persistida"},playerBalances:{secret:5000}}}],
    friend_requests:[{id:requestId,state:"PENDING",requester_id:peer,addressee_id:owner}],
    social_activities_v3:[{id:activityId,author_id:peer,material_hash:"a".repeat(64),active:true}],
  };
  const calls:Array<{table:string;filters:Array<[string,unknown]>}>=[],profiles:string[]=[];
  const client={from(table:string){const filters:Array<[string,unknown]>=[],call={table,filters};calls.push(call);let start=0,end=Infinity;
    const selected=()=>({data:(tables[table]||[]).filter(value=>filters.every(([key,expected])=>Array.isArray(expected)?expected.includes((value as Record<string,unknown>)[key]):(value as Record<string,unknown>)[key]===expected)).slice(start,end+1),error:null});
    const query={select:()=>query,eq:(key:string,value:unknown)=>{filters.push([key,value]);return query;},in:(key:string,values:unknown[])=>{filters.push([key,values]);return query;},is:(key:string,value:unknown)=>{filters.push([key,value]);return query;},order:()=>query,range:(a:number,b:number)=>{start=a;end=b;return query;},maybeSingle:async()=>({...selected(),data:selected().data[0]||null}),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(selected()).then(resolve)};return query;},
    rpc:async(name:string,payload:{target:string})=>{assert.equal(name,"social_profile_card_v1");profiles.push(payload.target);return {data:[{user_id:payload.target,display_name:"QA compañero",username:"qa_peer",avatar_url:null}],error:profileError?{code:"42501"}:null};},
  };
  const moduleExports:Record<string,(ctx:unknown,options?:unknown)=>Promise<{data:Array<Record<string,unknown>>;nextCursor:string|null}>>={};
  const compiled=ts.transpileModule(readFileSync("lib/social-activity.server.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(compiled,{exports:moduleExports,require:(id:string)=>id.endsWith("/notifications/domain")?domain:{}});
  return {list:(options?:unknown)=>moduleExports.listNotifications({client,admin:client,userId:owner},options),calls,profiles,events,tables};
}
test("notification service checks recipient, exact participant, source visibility and pending friendship",async()=>{
  const f=harness(),result=await f.list();assert.deepEqual(JSON.parse(JSON.stringify(result.data.map(item=>item.id))),["round","card","friend","like"]);
  assert.ok(f.calls.find(call=>call.table==="notification_events_v2")?.filters.some(([key,value])=>key==="recipient_id"&&value===owner));
  assert.equal(f.calls.filter(call=>call.table==="rounds_cloud").length,1);assert.equal(f.profiles.length,1,"profile resolved once per actor");
  assert.doesNotMatch(JSON.stringify(result),/playerBalances|5000|snapshot|recipient_id|foreign/);
});
test("round notices never open a source without an exact viewer match; ready requires completion",async()=>{
  const noMatch=await harness({linked:false}).list();assert.equal(noMatch.data.some(item=>item.id==="round"||item.id==="card"),false);
  const live=await harness({completed:false}).list();assert.equal(live.data.some(item=>item.id==="round"),true);assert.equal(live.data.some(item=>item.id==="card"),false);
});
test("master OFF mutes the notification query without changing individual choices",async()=>{
  const f=harness({enabled:false});const before=JSON.stringify(f.tables.notification_preferences_v2);const result=await f.list();assert.equal(result.data.length,0);
  assert.equal(f.calls.some(call=>call.table==="notification_events_v2"),false);assert.equal(JSON.stringify(f.tables.notification_preferences_v2),before);
});
test("event and social opt-outs independently suppress the corresponding notice",async()=>{
  const result=await harness({inApp:false,notifyFriendRequest:false}).list();assert.deepEqual(JSON.parse(JSON.stringify(result.data.map(item=>item.id))),["card","like"]);
});
test("profile lookup failure retains the valid resource with honest generic presentation",async()=>{
  const result=await harness({profileError:true}).list();assert.equal(result.data.length,4);assert.equal(result.data[0].person,null);
});
test("unread pagination crosses fifty rows without truncating the badge to the first page",async()=>{
  const f=harness();f.tables.notification_events_v2=Array.from({length:100},(_,i)=>({...f.events[0],id:String(i)}));
  const first=await f.list({unreadOnly:true});const second=await f.list({offset:50,unreadOnly:true});assert.equal(first.data.length,50);assert.equal(first.nextCursor,"50");assert.equal(second.data.length,50);
  assert.ok(f.calls.filter(call=>call.table==="notification_events_v2").every(call=>call.filters.some(([key,value])=>key==="read_at"&&value===null)));
});
