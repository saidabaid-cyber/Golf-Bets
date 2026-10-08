import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {scorecardQaEnvironment,scorecardQaAccount} from '../lib/scorecard-qa-access';
import {completeScorecardQa as fixture} from '../lib/scorecard-qa-fixture';
import * as domain from '../lib/premium-scorecard';
import {socialUI,uiFind,uiText,settleUI} from './helpers/social-ui';

const env={VERCEL:'1',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'integration/backyard-current',PREVIEW_DB_REF:'bymeopxkxapfizeeqeyb',NEXT_PUBLIC_SUPABASE_URL:'https://bymeopxkxapfizeeqeyb.supabase.co'};
test('remote demo fails closed outside DEV, approved branch, exact DB and server-verified QA identity',()=>{
  assert.equal(scorecardQaEnvironment(env),true);
  assert.equal(scorecardQaEnvironment({NODE_ENV:'development'}),true);
  for(const key of Object.keys(env))assert.equal(scorecardQaEnvironment({...env,[key]:undefined}),false,key);
  for(const patch of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{VERCEL_GIT_COMMIT_REF:'beta'},{PREVIEW_DB_REF:'zhqmlpljloumldaczcfp'},{NEXT_PUBLIC_SUPABASE_URL:'https://zhqmlpljloumldaczcfp.supabase.co'}])assert.equal(scorecardQaEnvironment({...env,...patch}),false);
  assert.equal(scorecardQaAccount('b182e0a1-d3f5-4e32-a005-29c6d55b6cdf'),true);
  assert.equal(scorecardQaAccount('5640dd66-e772-4f5e-bbd8-8fab47fb6b40'),true);
  for(const id of ['','peer','59952f12-784c-4568-957a-f1e55bbac04d'])assert.equal(scorecardQaAccount(id),false);
});
test('QA API verifies real session/account before returning synthetic data; cannot write or publish',async()=>{
  let account:any={ok:false,status:401,error:'Inicia sesión'},authCalls=0;
  const exports:any={},runtimeEnv={...env};
  const source=ts.transpileModule(readFileSync('app/api/qa/scorecard/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(source,{exports,Response,process:{env:runtimeEnv},require(path:string){
    if(path.endsWith('/server-auth'))return{authenticatedRequest:async()=>{authCalls++;return account;}};
    if(path.endsWith('/scorecard-qa-access'))return{scorecardQaAccount,scorecardQaEnvironment};
    if(path.endsWith('/scorecard-qa-fixture'))return{completeScorecardQa:fixture};throw new Error(path);
  }});
  const request=new Request('https://dev.thebackyard.com.mx/api/qa/scorecard');
  assert.equal((await exports.GET(request)).status,401);
  account={ok:true,userId:'not-QA',userMetadata:{email:'el_mongas@yahoo.com.mx'}};assert.equal((await exports.GET(request)).status,403);
  account={ok:true,userId:'b182e0a1-d3f5-4e32-a005-29c6d55b6cdf'};const response=await exports.GET(request);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.match(response.headers.get('x-robots-tag')!,/noindex/);
  assert.equal((await response.json()).data.access.roundId,'qa-memory-round');
  runtimeEnv.VERCEL_ENV='production';assert.equal((await exports.GET(request)).status,404);assert.equal(authCalls,3);
  for(const method of ['POST','PATCH','PUT','DELETE'])assert.equal(exports[method],undefined);
});
test('complete eighteen-hole fixture has coherent gross totals and captured zero, N/A and diverse advanced statistics',()=>{
  const cells=domain.scorecardCells({...fixture,playerId:fixture.player.id}),summary=domain.summarizeScorecard(cells);
  assert.equal(cells.length,18);assert.equal(new Set(cells.map(c=>c.hole.strokeIndex)).size,18);
  assert.deepEqual([summary.par,summary.gross,summary.toPar],[72,78,6]);
  assert.deepEqual([domain.summarizeScorecard(cells.slice(0,9)).gross,domain.summarizeScorecard(cells.slice(9)).gross],[38,40]);
  assert.deepEqual(summary.putts,{value:32,captured:18,possible:18});assert.deepEqual(summary.gir,{value:11,captured:18,possible:18});
  assert.equal(summary.fir.captured,14);assert.equal(summary.penalties.value,1);
  assert.equal(cells[8].putts,0);assert.equal(cells[2].fir,null);assert.equal(cells[4].stat.teeDirection,'right');assert.equal(cells[7].stat.teeDirection,'left');
  assert.equal(cells[7].stat.outOfBoundsCount,1);assert.equal(cells[7].stat.bunkerCount,1);
  assert.deepEqual(new Set(cells.map(c=>c.result)),new Set(['bogey','par','birdie','double','eagle']));
});
test('demo uses the real editor/domain; successful, cancelled, rejected and reset captures remain in memory',async()=>{
  const original=JSON.stringify(fixture);
  const h=socialUI('app/qa/scorecard/scorecard-qa.tsx',{'scorecard-boundary':{ScorecardBoundary:'Boundary'},'premium-scorecard':domain});
  const render=()=>h.render('ScorecardQa',{fixture});let tree=render();
  assert.match(uiText(tree),/DEMO QA — DATOS DE PRUEBA/);
  let boundary=uiFind(tree,n=>n.type==='Boundary');assert.equal(boundary.props.access.readOnly,true);
  assert.throws(()=>boundary.props.onSaveHole(5,fixture.player.id,{score:4,putts:2,advanced:{}}),/solo lectura/);
  uiFind(tree,n=>n.type==='button'&&uiText(n)==='Probar editable').props.onClick();tree=render();boundary=uiFind(tree,n=>n.type==='Boundary');
  const draft={score:4,putts:1,advanced:{teeDirection:'center',fairwayHit:true,greenInRegulation:true,penaltyStrokes:0}};
  // Cancelling never invokes this save boundary.
  assert.equal(boundary.props.scores[5][fixture.player.id],5);
  await boundary.props.onSaveHole(5,fixture.player.id,draft);tree=render();boundary=uiFind(tree,n=>n.type==='Boundary');assert.equal(boundary.props.scores[5][fixture.player.id],4);assert.equal(boundary.props.putts[5][fixture.player.id],1);
  uiFind(tree,n=>n.type==='button'&&uiText(n)==='Simular fallo al guardar').props.onClick();boundary=uiFind(render(),n=>n.type==='Boundary');assert.throws(()=>boundary.props.onSaveHole(5,fixture.player.id,{...draft,score:3}),/Fallo controlado/);
  assert.equal(uiFind(render(),n=>n.type==='Boundary').props.scores[5][fixture.player.id],4);
  uiFind(render(),n=>n.type==='button'&&uiText(n)==='Restablecer fixture').props.onClick();assert.equal(uiFind(render(),n=>n.type==='Boundary').props.scores[5][fixture.player.id],5);assert.equal(JSON.stringify(fixture),original);
  assert.doesNotMatch(readFileSync('app/qa/scorecard/scorecard-qa.tsx','utf8'),/localStorage|socialRequest|publishRound|persistRound|fetch\(/);
});
test('remote access gate discards responses from a previous identity after account change',async()=>{
  let changed=()=>{},release:(value:any)=>void=()=>{},calls=0;const scheduled:Array<()=>void>=[];
  const client={auth:{getSession:async()=>({data:{session:{access_token:'QA'}}}),onAuthStateChange(fn:()=>void){changed=fn;return{data:{subscription:{unsubscribe(){}}}};}}};
  const h=socialUI('app/qa/scorecard/scorecard-qa-gate.tsx',{'supabase/client':{getSupabaseBrowser:()=>client},'scorecard-qa':{ScorecardQa:'Demo'}},{setTimeout:(fn:()=>void)=>{scheduled.push(fn);},fetch:async()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
  h.render('ScorecardQaGate',{});await settleUI();assert.equal(calls,1);
  changed();release({ok:true,json:async()=>({data:fixture})});await settleUI();assert.doesNotMatch(uiText(h.render('ScorecardQaGate',{})),/18 hoyos/);assert.equal(uiFind(h.render('ScorecardQaGate',{}),n=>n.type==='p').props.role,'status');
  scheduled.shift()!();await settleUI();release({ok:false,json:async()=>({error:'Cuenta sin permiso'})});await settleUI();assert.match(uiText(h.render('ScorecardQaGate',{})),/Cuenta sin permiso/);h.unmount();
});
