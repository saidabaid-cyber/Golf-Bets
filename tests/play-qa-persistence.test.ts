import test from 'node:test';
import assert from 'node:assert/strict';
import { playQaPersistence, playQaRoundPrefix } from '../lib/play-qa-persistence';
import type { RoundSnapshot } from '../lib/types';

const user='qa-persistence-owner';
const card=():RoundSnapshot=>({id:playQaRoundPrefix(user)+'test',lifecycleState:'live',date:'2026-10-09',
  courseName:'QA',teeName:'Gold',ownerId:'self',ownerName:'QA',players:[{id:'self',name:'QA',handicap:null,accountUserId:user}],
  scorekeeping:{version:1,mode:'owner',organizerAccountUserId:user},presentation:{playMode:'score_only'},scores:{1:{self:4}},
  betResult:0,expenseTotal:0,netResult:0,categoryResults:{},expenses:{caddie:0,food:0,drinks:0,greenFee:0,cartRental:0,other:0}});
function storage(){const values=new Map<string,string>();return {getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>{values.set(k,v);}};}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});

test('QA persistence rejects foreign, historical, completed and multi-player cards before any request',async()=>{
  let calls=0;const qa=playQaPersistence(user,'test',storage(),async()=>{calls++;return json({});});
  for(const next of [{...card(),id:'real-history'}, {...card(),lifecycleState:'completed' as const},
    {...card(),cloudReadOnly:true as const}, {...card(),players:[...card().players!,{id:'guest',name:'Guest',handicap:null}]},
    {...card(),players:[{...card().players![0],accountUserId:'other'}]}])
    await assert.rejects(qa.save(next),/prueba aislada/);
  await assert.rejects(qa.read('real-history'),/QA inválido/);assert.equal(calls,0);
});
test('a new device reload acknowledges only the full owned persisted card and restores scores',async()=>{
  const data=card();const s=storage();let calls=0;
  const qa=playQaPersistence(user,'test',s,async(url,init)=>{calls++;assert.match(String(url),/localRoundId=/);assert.equal(init?.method,undefined);return json({data:{id:'cloud-qa',version:4,snapshot:data}});});
  const restored=await qa.read(data.id);assert.equal(restored?.snapshot.scores?.[1].self,4);
  assert.equal(s.getItem(`backyard-owner-round-revision:${user}:${data.id}`),'4');assert.equal(calls,1);
  const malformed=playQaPersistence(user,'test',storage(),async()=>json({data:{id:'cloud',version:5,snapshot:{...data,id:'foreign'}}}));
  await assert.rejects(malformed.read(data.id),/prueba aislada/);
});
test('real transport saves once, repeated identical save is acknowledged, cancellation preserves scores',async()=>{
  let row:RoundSnapshot|null=null,version=0;const methods:string[]=[];
  const request:typeof fetch=async(url,init)=>{
    assert.match(String(url),/^\/api\/cloud\/rounds/);const method=init?.method||'GET';methods.push(method);
    if(method==='GET')return json({data:row?{id:'cloud-qa',version,snapshot:row}:null});
    const body=JSON.parse(String(init?.body));if(row)assert.equal(body.expectedVersion,version);
    row=body.round;version++;return json({roundId:'cloud-qa',version});
  };
  const qa=playQaPersistence(user,'test',storage(),request),original=card();
  await qa.save(original);await qa.save(original,original);assert.deepEqual(methods,['GET','POST']);
  await qa.cancel(original);assert.equal((row as unknown as RoundSnapshot).lifecycleState,'cancelled');
  const reloaded=await playQaPersistence(user,'test',storage(),request).read(original.id);
  assert.equal(reloaded?.snapshot.lifecycleState,'cancelled');assert.deepEqual(reloaded?.snapshot.scores,original.scores);
  assert.ok(methods.every(m=>['GET','POST','PUT'].includes(m)));
});
