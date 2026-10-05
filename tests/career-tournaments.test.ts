import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as tournaments from "../lib/career-tournaments";
import { renderCareer } from "./helpers/render-career";
const event:tournaments.TournamentSource={id:"t",public_id:"public",short_code:"QA",created_by:"organizer",name:"Torneo QA sintético",tournament_date:"2026-10-10",course_name:"Sede QA",holes:18,start_hole:1,format:"gross",status:"finished",course_snapshot:Array.from({length:18},(_,i)=>({number:i+1,par:4,strokeIndex:i+1})),hcp_pct:100,handicap_mode:"half_up",public_leaderboard:true};
const players:tournaments.TournamentPlayerSource[]=[{id:"p",tournament_id:"t",profile_id:"owner",name:"QA Owner",handicap:0},{id:"r",tournament_id:"t",profile_id:"rival",name:"QA Rival",handicap:0}];
const scores:tournaments.TournamentScoreSource[]=players.flatMap(p=>event.course_snapshot.map(h=>({tournament_id:"t",player_id:p.id,hole:h.number,score:p.id==="p"?4:5})));
test("tournament projection links account exactly, reuses sports engine and ranks completed results",()=>{
  const e=tournaments.projectCareerTournament(event,players,scores,"owner")!;
  assert.equal(e.gross,72);assert.equal(e.position,1);assert.equal(e.relativeToPar,0);assert.equal(e.resultStatus,"final");
  assert.equal(tournaments.projectCareerTournament({...event,handicap_mode:"partial"},players,scores,"owner")!.position,1);
  assert.equal(tournaments.projectCareerTournament(event,players,scores,"organizer"),null);
  assert.equal(tournaments.projectCareerTournament(event,[...players,{...players[0],id:"duplicate"}],scores,"owner"),null);
  assert.doesNotMatch(JSON.stringify(e),/QA Rival|profile_id|pin_hash/);
});
test("partial cards, incomplete opponent and missing course geometry never fabricate positions",()=>{
  assert.equal(tournaments.projectCareerTournament(event,players,scores.slice(1),"owner")!.gross,null);
  assert.equal(tournaments.projectCareerTournament(event,players,scores.slice(0,-1),"owner")!.position,null);
  const noGeometry=tournaments.projectCareerTournament({...event,course_snapshot:[]},players,scores,"owner")!;
  assert.equal(noGeometry.gross,72);assert.equal(noGeometry.relativeToPar,null);assert.equal(noGeometry.position,null);
});
test("summary and upcoming dates calculate real counts and days; no point ranking is invented",()=>{
  const e=tournaments.projectCareerTournament(event,players,scores,"owner")!;
  assert.deepEqual(tournaments.careerTournamentSummary([e]),{played:1,victories:1,podiums:1,top10:1,bestPosition:1,ranked:1,points:undefined});
  const next={...e,status:"upcoming" as const};
  assert.equal(tournaments.nextCareerTournament([e,next],"2026-10-05")!.days,5);assert.equal(tournaments.nextCareerTournament([next],"2026-10-11"),null);
});
test("tournament states render loading, error, empty, real hero/history and ranking only with evidence",()=>{
  const p={events:[],loading:false,error:false,authenticated:true,nextOffset:null,reload(){},loadMore(){},today:"2026-10-05"};
  const render=(props:object)=>renderCareer("app/components/career-tournaments.tsx","CareerTournamentsContent",{...p,...props});
  assert.match(render({}),/Todavía no tienes torneos registrados/);assert.match(render({loading:true}),/Cargando Carrera/);assert.match(render({error:true}),/Esta información no está disponible/);
  const e=tournaments.projectCareerTournament(event,players,scores,"owner")!;
  assert.match(render({events:[e,{...e,id:"next",status:"upcoming"}]}),/5 días/);assert.match(render({events:[e]}),/Historial competitivo/);
  const emptyRanking=renderCareer("app/components/career-tournaments.tsx","TournamentRanking",{});assert.doesNotMatch(emptyRanking,/Posición|Puntos/);
  assert.match(renderCareer("app/components/career-tournaments.tsx","TournamentRanking",{ranking:{position:2,players:50,points:150}}),/2º/);
});
test("private tournament reader scopes account before any sports reads and denies revoked access",async()=>{
  const source=ts.transpileModule(readFileSync("lib/career-tournaments.server.ts","utf8"),{fileName:"server.ts",compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const calls:Array<{table:string;filters:Array<[string,unknown]>}>=[];
  const admin={from(table:string){const call={table,filters:[] as Array<[string,unknown]>};calls.push(call);const q:any={select(){return q;},eq(k:string,v:unknown){call.filters.push([k,v]);return q;},in(){return q;},is(){return q;},order(){return q;},range(){return q;},then(fn:any){return Promise.resolve(fn({error:null,data:table==="tournament_players"?[players[0]]:table==="tournaments"?[{...event,public_leaderboard:false}]:[]}));}};return q;}};
  const exports:any={};runInNewContext(source,{exports,Set,Date,Promise,require:(id:string)=>id==="server-only"?{}:tournaments});
  const result=await exports.readCareerTournaments(admin,"owner",0);
  assert.equal(result.events.length,0);assert.deepEqual(calls[0].filters,[["profile_id","owner"]]);assert.equal(calls.some(c=>c.table==="tournament_scores"),false);
});
test("API denies expired auth before service access, is private and cannot use a requested user id",async()=>{
  const source=ts.transpileModule(readFileSync("app/api/career/tournaments/route.ts","utf8"),{fileName:"route.ts",compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let serviceCalls=0;const exports:any={};runInNewContext(source,{exports,require:()=>({NextResponse:{json:(body:any,options:any)=>({body,...options})},authenticatedRequest:async()=>({ok:false,status:401,error:"Expired",code:"AUTH_REQUIRED"}),getSupabaseAdmin(){serviceCalls++;}})});
  const result=await exports.GET({nextUrl:new URL("https://dev.thebackyard.com.mx/api/career/tournaments?userId=other")});
  assert.equal(result.status,401);assert.equal(serviceCalls,0);assert.equal(result.headers["cache-control"],"private, no-store");
});
test("tournament reader rejects a truncated participant page before ranking",async()=>{
  const source=ts.transpileModule(readFileSync("lib/career-tournaments.server.ts","utf8"),{fileName:"server.ts",compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let playerReads=0,scoresRead=false;
  const admin={from(table:string){if(table==="tournament_players")playerReads++;if(table==="tournament_scores")scoresRead=true;const q:any={select(){return q;},eq(){return q;},in(){return q;},is(){return q;},order(){return q;},range(){return q;},then(fn:any){return Promise.resolve(fn({error:null,count:1001,data:table==="tournament_players"?[players[0]]:table==="tournaments"?[event]:[]}));}};return q;}};
  const exports:any={};runInNewContext(source,{exports,Set,Date,Promise,require:(id:string)=>id==="server-only"?{}:tournaments});
  await assert.rejects(()=>exports.readCareerTournaments(admin,"owner",0),/CAREER_TOURNAMENTS_LIMIT/);
  assert.equal(playerReads,2);assert.equal(scoresRead,false);
});
