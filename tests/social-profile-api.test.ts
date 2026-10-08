import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const TARGET='22222222-2222-4222-8222-222222222222';
function profileAPI(available=true){
  const calls:string[]=[];const exports:any={};
  class ServiceError extends Error {constructor(public code:string,public status:number,message:string){super(message);}}
  const client={rpc:async(name:string,args:any)=>{calls.push(`${name}:${args.target}`);return{data:available?[{user_id:args.target,display_name:'Jugador permitido',username:'permitido'}]:[],error:null};},from:(table:string)=>{calls.push(table);const q={select:()=>q,or:()=>q,limit:async()=>({data:[],error:null})};return q;}};
  const admin={from:(table:string)=>{calls.push(`admin:${table}`);const q={select:()=>q,eq:(key:string,value:string)=>{calls.push(`${key}:${value}`);return q;},maybeSingle:async()=>({data:{club_name:'Club público'},error:null})};return q;}};
  const code=ts.transpileModule(readFileSync('app/api/social/profile/[id]/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{exports,Response,Set,Promise,Error,require:(id:string)=>id.endsWith('social-activity.server')?{SocialServiceError:ServiceError}:{socialId:(id:string)=>{if(!/^[0-9a-f-]{36}$/.test(id))throw new ServiceError('INVALID_REQUEST',400,'ID inválido');return id;},socialHttp:async(request:Request,fn:any)=>{if(!request.headers.get('authorization'))return Response.json({}, {status:401});try{return Response.json(await fn({userId:'viewer',client,admin}));}catch(e){return Response.json({}, {status:(e as ServiceError).status||503});}}}});
  return{calls,get:(id=TARGET,auth=true)=>exports.GET(new Request('https://dev.invalid/profile',{headers:auth?{authorization:'Bearer isolated'}:{}}),{params:Promise.resolve({id})})};
}
test('social profile API gates identity before privileged club read and retains authenticated friendship RLS',async()=>{
  const h=profileAPI();const response=await h.get();assert.equal(response.status,200);const body=await response.json();assert.equal(body.person.user_id,TARGET);assert.equal(body.connectionsScope,'VISIBLE');assert.ok(h.calls.includes('privacy:PUBLIC'));assert.ok(h.calls.includes('friendships'));assert.ok(!h.calls.some(c=>/ghin|handicap|rounds_cloud|email/.test(c)));
});
test('private, invalid or unauthenticated profiles never enumerate friends or query privileged data',async()=>{
  const blocked=profileAPI(false);assert.equal((await blocked.get()).status,404);assert.equal(blocked.calls.length,1);
  const h=profileAPI();assert.equal((await h.get('invalid')).status,400);assert.equal((await h.get(TARGET,false)).status,401);assert.equal(h.calls.length,0);
});
