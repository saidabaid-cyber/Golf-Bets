import assert from "node:assert/strict";
import test from "node:test";
import { notifyFriendAccepted } from "../features/notifications/friend-accepted.server";

const recipient="11111111-1111-4111-8111-111111111111",actor="22222222-2222-4222-8222-222222222222",requestId="33333333-3333-4333-8333-333333333333";
function harness({state="ACCEPTED",inApp=true,recipientMismatch=false,preferenceError=false,insertError=false}={}) {
  const stored=new Map<string,Record<string,unknown>>(),filters:Array<[string,string,unknown]>=[];
  const make=(table:string)=>{
    const q:any={select:()=>q,eq:(key:string,value:unknown)=>{filters.push([table,key,value]);return q;},abortSignal:()=>q,
      maybeSingle:async()=>table==="friend_requests"?{data:{id:requestId,requester_id:recipient,addressee_id:recipientMismatch?recipient:actor,state},error:null}:{data:{user_id:recipient,event_type:"friend_accepted",in_app:inApp},error:preferenceError?{code:"42501"}:null},
      upsert:async(value:Record<string,unknown>,options:Record<string,unknown>)=>{
        assert.equal(table,"notification_events_v2");assert.deepEqual(options,{onConflict:"recipient_id,id",ignoreDuplicates:true});
        assert.deepEqual(Object.keys(value).sort(),["event_type","id","recipient_id","resource_id","resource_type"]);
        if(insertError)return{error:{code:"42501"}};
        if(!stored.has(String(value.id)))stored.set(String(value.id),{...value,read_at:"already read"});
        return{error:null};
      },
    };
    // Supabase's upsert is a thenable builder supporting timeout before await.
    const upsert=q.upsert;q.upsert=(value:Record<string,unknown>,options:Record<string,unknown>)=>({abortSignal:()=>upsert(value,options)});
    return q;
  };
  return{ctx:{userId:actor,client:{from:make},admin:{from:make}} as any,stored,filters};
}
test("friend acceptance emits a private reference only to the verified requester",async()=>{
  const h=harness();assert.equal(await notifyFriendAccepted(h.ctx,requestId),"PERSISTED");const event=[...h.stored.values()][0];
  assert.equal(event.recipient_id,recipient);assert.equal(event.resource_id,requestId);assert.equal(event.event_type,"friend_accepted");assert.equal(event.resource_type,"FRIEND");
  assert.ok(h.filters.some(([table,key,value])=>table==="friend_requests"&&key==="addressee_id"&&value===actor));
  assert.ok(h.filters.some(([table,key,value])=>table==="notification_preferences_v2"&&key==="user_id"&&value===recipient));
});
test("friend acceptance retry deduplicates and retains an existing read marker",async()=>{
  const h=harness();await notifyFriendAccepted(h.ctx,requestId);await notifyFriendAccepted(h.ctx,requestId);
  assert.equal(h.stored.size,1);assert.equal([...h.stored.values()][0].read_at,"already read");
});
test("friend acceptance follows its separate in-app event preference",async()=>{const h=harness({inApp:false});assert.equal(await notifyFriendAccepted(h.ctx,requestId),"MUTED");assert.equal(h.stored.size,0);});
test("pending requests cannot emit an accepted notice",async()=>{const h=harness({state:"PENDING"});assert.equal(await notifyFriendAccepted(h.ctx,requestId),"NOT_ELIGIBLE");assert.equal(h.stored.size,0);});
test("another account cannot emit an accepted notice for a request",async()=>{const h=harness({recipientMismatch:true});assert.equal(await notifyFriendAccepted(h.ctx,requestId),"NOT_ELIGIBLE");assert.equal(h.stored.size,0);});
test("unavailable delivery permissions remain unavailable without a fake success",async()=>{
  for(const options of [{preferenceError:true},{insertError:true}]){const h=harness(options);assert.equal(await notifyFriendAccepted(h.ctx,requestId),"DELIVERY_UNAVAILABLE");assert.equal(h.stored.size,0);}
});
test("invalid request identity cannot enqueue any notice",async()=>{const h=harness();assert.equal(await notifyFriendAccepted(h.ctx,"invalid"),"NOT_ELIGIBLE");assert.equal(h.filters.length,0);});
