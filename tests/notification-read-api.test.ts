import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { NOTIFICATION_EVENT_TYPES } from "../features/notifications/domain";

const id="11111111-1111-4111-8111-111111111111",otherId="22222222-2222-4222-8222-222222222222";
function harness(){
  const rows=[{id,recipient_id:"owner",event_type:"group_invite",read_at:null as string|null},
    {id:otherId,recipient_id:"other",event_type:"friend_request",read_at:null as string|null},
    {id:"critical",recipient_id:"owner",event_type:"security_alert",read_at:null as string|null}];
  const pages:Record<string,unknown>[]=[],tables:string[]=[];
  const client={from(table:string){tables.push(table);let update:Record<string,unknown>={};const checks:Array<(row:typeof rows[number])=>boolean>=[];
    const query={update:(patch:Record<string,unknown>)=>{update=patch;return query;},eq:(key:string,value:unknown)=>{checks.push(row=>row[key as keyof typeof row]===value);return query;},
      is:(key:string,value:unknown)=>{checks.push(row=>row[key as keyof typeof row]===value);return query;},in:(_key:string,values:string[])=>{checks.push(row=>values.includes(row.event_type));return query;},select:()=>query,abortSignal:()=>query,
      then:(resolve:(value:unknown)=>unknown)=>{const selected=rows.filter(row=>checks.every(check=>check(row)));selected.forEach(row=>Object.assign(row,update));return Promise.resolve({data:selected.map(row=>({id:row.id})),error:null}).then(resolve);}};return query;
  }};
  const exports:Record<string,(request:Request)=>Promise<Response>>={};
  const source=ts.transpileModule(readFileSync("app/api/social/notifications/route.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,Response,URL,Date,AbortSignal,Object,require:(path:string)=>{
    if(path.endsWith("/domain"))return {NOTIFICATION_EVENT_TYPES};
    if(path.endsWith("/social-activity.server"))return {listNotifications:async(_ctx:unknown,options:Record<string,unknown>={})=>{pages.push(options);return {data:[],nextCursor:null};}};
    if(path.endsWith("/social-http.server"))return {socialBody:(request:Request)=>request.json(),socialId:(value:string)=>{if(!/^[0-9a-f-]{36}$/i.test(value))throw Object.assign(new Error(),{status:400});return value;},socialHttp:async(request:Request,operation:(ctx:unknown)=>Promise<unknown>)=>{if(!request.headers.get("authorization"))return Response.json({error:"auth"},{status:401});try{return Response.json(await operation({userId:"owner",client}));}catch(error){return Response.json({error:"failed"},{status:(error as {status?:number}).status||503});}}};
    throw new Error(path);
  }});
  const request=(body?:unknown,search="",auth=true)=>new Request("https://dev.invalid/api/social/notifications"+search,{method:body?"PATCH":"GET",headers:{"content-type":"application/json",...(auth?{authorization:"Bearer QA"}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {exports,request,rows,pages,tables};
}
test("read, unread and mark-all affect only the authenticated recipient and center event types",async()=>{
  const f=harness();assert.equal((await f.exports.PATCH(f.request({id,read:true}))).status,200);assert.ok(f.rows[0].read_at);
  assert.equal((await f.exports.PATCH(f.request({id,read:false}))).status,200);assert.equal(f.rows[0].read_at,null);
  assert.equal((await f.exports.PATCH(f.request({all:true,read:true}))).status,200);assert.ok(f.rows[0].read_at);assert.equal(f.rows[1].read_at,null);assert.equal(f.rows[2].read_at,null);
  assert.ok(f.tables.every(table=>table==="notification_events_v2"),"read state cannot accept/reject group invitations");
});
test("forged owner, another recipient, invalid read and unauthenticated update cannot succeed",async()=>{
  const f=harness();assert.equal((await f.exports.PATCH(f.request({id:otherId,read:true}))).status,404);
  for(const body of [{id,read:true,user_id:"other"},{id,read:"true"},{all:true,read:false}])assert.equal((await f.exports.PATCH(f.request(body))).status,400);
  assert.equal((await f.exports.PATCH(f.request({id,read:true},"",false))).status,401);assert.equal(f.rows[1].read_at,null);
});
test("notification pagination preserves server scope and supports unread pages beyond fifty rows",async()=>{
  const f=harness();assert.equal((await f.exports.GET(f.request(undefined,"?cursor=50&unreadOnly=true"))).status,200);
  assert.deepEqual(JSON.parse(JSON.stringify(f.pages)),[{offset:50,unreadOnly:true}]);
  for(const cursor of ["bad","-1","100001"]){assert.equal((await f.exports.GET(f.request(undefined,"?cursor="+cursor))).status,400);}
});
