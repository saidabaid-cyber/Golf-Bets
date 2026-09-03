import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { calculateFoursomes, calculatePersonalBets, excelFoursomeNet, playOrder, segmentDefinitions } from "../lib/engine";
import { ensureHoleScoresAtPar, persistRoundHistory, readStoredJson, resolvePersonalHistoryDeletion, STORAGE_KEYS } from "../lib/round-utils";
import { canEditSnapshot, restoreRoundSnapshot, resultSummaryText, upsertRoundSnapshot } from "../lib/round-editing";
import { buildPersonalHistory, snapshotPersonalResult } from "../lib/personal-history";
import { realCases, realCourse, realOrder, realPersonal, realPlayers, realScores } from "./fixtures/personals-real";
import type { BetConfig, Course, Player, RoundSnapshot, HoleScore } from "../lib/types";

const players: Player[] = ["a","b","c","d","excluded"].map((id,i)=>({id,name:id,handicap:[10,14.6,12,30,0][i]}));
const course: Course = {id:"excel",name:"Referencia",teeName:"",holes:Array.from({length:18},(_,i)=>({number:i+1,par:4,strokeIndex:i+1}))};
const cfg: BetConfig["foursome"] = {enabled:true,handicapMethod:"excel",hcpPct:100,decimals:"partial",segmentSize:6,mode:"fixed_points",fixedValue:200,pointValue:100,participantIds:["a","b","c","d"]};
const seg=[{id:"seg",startIndex:0,endIndex:2,basePair:["a","b"]}];

test("Foursome sin scores y con captura parcial no genera puntos ni dinero",()=>{
  for(const scores of [{},{1:{a:4}},{1:{a:4,b:4,c:4,d:null}}] as Record<number,HoleScore>[]) {
    const result=calculateFoursomes(course,scores,players,cfg,seg,[1,2,3]);
    assert.equal(result.matches[0].completedHoles,0); assert.deepEqual(result.matches[0].holePoints,[]);
    assert.equal(result.matches[0].provisionalTotalMoney,0); assert.equal(result.matches[0].complete,false);
  }
});
test("Par solo se materializa tras confirmar; siguiente hoyo pendiente no cambia acumulado",()=>{
  const suggested={};
  assert.equal(calculateFoursomes(course,suggested,players,cfg,seg,[1,2,3]).matches[0].completedHoles,0);
  const scores=ensureHoleScoresAtPar(suggested,course.holes[0],players);
  const result=calculateFoursomes(course,scores,players,cfg,seg,[1,2,3]);
  assert.equal(result.matches[0].completedHoles,1); assert.equal(result.matches[0].pointDiff,-2);
  assert.deepEqual(result.matches[0].holePoints[0].netA,[4,3]); assert.deepEqual(result.matches[0].holePoints[0].netB,[3,2]);
  const partial=calculateFoursomes(course,{...scores,2:{a:3,b:4}},players,cfg,seg,[1,2,3]);
  assert.equal(partial.matches[0].pointDiff,-2); assert.equal(partial.matches[0].holePoints.find(item=>item.hole===2),undefined);
  assert.equal(result.provisionalBalances.a,-result.provisionalBalances.c);
});
test("Excel AB194/AB211/AC195:AC196: cuatro HCP, una décima, dos umbrales, no fracción ni porcentaje",()=>{
  const match=players.slice(0,4);
  for(const si of [1,2,4,5,18]) for(const player of match) {
    const h=Math.round(((player.handicap || 0)-10)*10)/10;
    const expected=6-(h>=si?1:0)-(h>=si+18?1:0);
    assert.equal(excelFoursomeNet(6,player.id,si,match),expected);
  }
  assert.equal(excelFoursomeNet(6,"b",5,match),6); // 4.6 does NOT round to5.
  const scores={1:{a:4,b:5,c:4,d:6}};
  const lowPct=calculateFoursomes(course,scores,players,{...cfg,hcpPct:5,decimals:"round"},seg,[1,2,3]);
  const raw=calculateFoursomes(course,scores,players,cfg,seg,[1,2,3]);
  assert.deepEqual(lowPct,raw);
});
test("Foursome D194:D197 / matrices: cada modalidad, segmento y salida conserva Low/High y suma cero",()=>{
  const p=players.slice(0,4).map(player=>({...player,handicap:0}));
  const scores=Object.fromEntries(playOrder().map(h=>[h,{a:3,b:5,c:4,d:5}])); // +1 per hole.
  for(const start of [1,10] as const) for(const length of [9,18]) for(const size of [3,6,9,18] as const) for(const mode of ["fixed","points","fixed_points"] as const) {
    const order=playOrder(start).slice(0,length), segments=segmentDefinitions(order,size).map(s=>({...s,basePair:["a","b"]}));
    const result=calculateFoursomes(course,scores,p,{...cfg,mode,segmentSize:size},segments,order);
    for(const match of result.matches) {
      const count=match.completedHoles;
      assert.equal(match.pointDiff,count); assert.ok(match.holePoints.every(h=>h.points===1));
      assert.equal(match.totalMoney,(mode!=="points"?200:0)+(mode!=="fixed"?count*100:0));
    }
    assert.equal(Object.values(result.balances).reduce((sum,n)=>sum+n,0),0);
    assert.equal(result.balances.a,-result.balances.c);
  }
});
test("Fantasma conserva tres scores reales, duplica neto y paga suma cero (extensión no atribuida al Excel)",()=>{
  const result=calculateFoursomes(course,{1:{a:4,b:5,c:5}},players,{...cfg,participantIds:["a","b","c"]},[{...seg[0],endIndex:0}],[1]);
  assert.equal(result.matches[0].holePoints[0].netB?.[0],result.matches[0].holePoints[0].netB?.[1]);
  assert.equal(Object.values(result.balances).reduce((sum,n)=>sum+n,0),0);
});
test("Los cuatro Personales reales siguen EXACTOS al integrar snapshots",()=>{
  const bets=realCases.map(realPersonal), result=calculatePersonalBets(bets,"said",realPlayers,realCourse,realScores,realOrder);
  assert.deepEqual(result.results.map(item=>item.totalMoney),[-600,-200,800,-800]);
  assert.equal(result.balances.said,-800); assert.equal(Object.values(result.balances).reduce((sum,n)=>sum+n,0),0);
  result.results.forEach((item,i)=>assert.deepEqual([snapshotPersonalResult(bets[i],item,realPlayers).grossOwner,item.grossRival],realCases[i].gross));
});
function snapshot():RoundSnapshot {
  return {id:"same",date:"2026-09-02",ownerId:"said",ownerName:"Said",courseName:realCourse.name,teeName:"",roundHoles:18,startHole:1,
    betResult:-800,expenseTotal:100,netResult:-900,expenses:{caddie:100,food:0,drinks:0,greenFee:0,cartRental:0,other:0},categoryResults:{Personales:-800},
    players:structuredClone(realPlayers),scores:structuredClone(realScores),courseSnapshot:structuredClone(realCourse),order:realOrder,
    betConfig:{foursome:cfg} as BetConfig,segments:seg,personalBets:realCases.map(realPersonal),unitEvents:[],manualBets:[],ballFriendSetup:{},
    completedAt:"2026-09-02T18:00:00Z",updatedAt:"2026-09-02T18:00:00Z",photoId:"photo",playerBalances:{said:-800,carlos:600,juan:200,flavio:-800,javier:800}};
}
test("Terminar → serializar → recargar → abrir conserva configuración completa y foto",()=>{
  let raw="";const storage={setItem:(_k:string,value:string)=>{raw=value;},getItem:()=>raw};
  const original=snapshot();const history=upsertRoundSnapshot([],original);
  persistRoundHistory(storage,history);const restored=restoreRoundSnapshot(readStoredJson<RoundSnapshot[]>(storage,STORAGE_KEYS.history,[])[0]);
  assert.deepEqual(restored,original);
  restored!.players![0].handicap=1;restored!.scores![1].said=9;restored!.segments![0].basePair[0]="other";
  assert.equal(history[0].players![0].handicap,36);assert.equal(history[0].scores![1].said,5);assert.equal(history[0].segments![0].basePair[0],"a");
});
test("Corregir reutiliza ID, conserva foto/fecha original y actualiza sin duplicar",()=>{
  const old=snapshot(), updated={...snapshot(),photoId:undefined,updatedAt:"2026-09-03T12:00:00Z",completedAt:"2026-09-03T12:00:00Z"};
  const saved=upsertRoundSnapshot([old],updated);assert.equal(saved.length,1);assert.equal(saved[0].photoId,"photo");assert.equal(saved[0].completedAt,old.completedAt);assert.equal(saved[0].updatedAt,updated.updatedAt);
  assert.equal(canEditSnapshot({...old,segments:undefined}),false);
});
test("Una ronda repetida cuenta una vez y balance/ganadas son del principal",()=>{
  const old={...snapshot(),personalResults:[{rivalKey:"carlos",rivalName:"Carlos",totalMoney:-600,componentMoney:{match2:-300,match18:-100,medal1:100,medal2:-200,medal18:-100}}]};
  const stats=buildPersonalHistory([old,structuredClone(old)],"2026-09-02")[0];
  assert.equal(stats.rounds,1);assert.equal(stats.total,-600);assert.equal(stats.losses,1);assert.equal(stats.wins,0);
});
test("Corregir una ronda no resucita Personales borradas ni sus balances cacheados",()=>{
  const source=snapshot(), results=calculatePersonalBets(source.personalBets!,"said",realPlayers,realCourse,realScores,realOrder);
  source.personalResults=results.results.map((item,i)=>snapshotPersonalResult(source.personalBets![i],item,realPlayers));
  source.categoryBalances={Personales:results.balances};source.resultDetails={personals:results};
  const deleted=resolvePersonalHistoryDeletion([source],source.id,0,"delete")[0];
  assert.equal(deleted.personalBets!.length,3);assert.equal(source.personalBets!.length,4);
  assert.equal(deleted.playerBalances!.said,-200);assert.equal(deleted.playerBalances!.carlos,0);
  assert.equal(deleted.categoryBalances!.Personales.said,-200);
  const edited=restoreRoundSnapshot(deleted)!;
  assert.equal(calculatePersonalBets(edited.personalBets!,"said",realPlayers,realCourse,realScores,realOrder).balances.said,-200);
});
test("Copiar resumen genera WhatsApp limpio con apuestas/gastos/neto y ceros legítimos",()=>{
  const text=resultSummaryText("La Vista","2026-09-02",[{id:"said",name:"Said"},{id:"flavio",name:"Flavio"}],{said:800,flavio:-800},"said",100);
  assert.match(text,/THE BACKYARD\nLa Vista/);assert.match(text,/Said \+\$800\nFlavio -\$800/);assert.match(text,/Gastos -\$100 · Neto \+\$700/);
});
test("Histórico no mezcla balances de dos jugadores principales contra el mismo rival",()=>{
  const first={...snapshot(),personalResults:[{rivalKey:"flavio",rivalName:"Flavio",totalMoney:800,componentMoney:{}}]};
  const second={...first,id:"another",ownerName:"Carlos",personalResults:[{...first.personalResults[0],totalMoney:-100}]};
  const stats=buildPersonalHistory([first,second],"2026-09-02");
  assert.equal(stats.length,2);
  assert.equal(stats.find(item=>item.records[0].ownerName==="Said")?.total,800);
  assert.equal(stats.find(item=>item.records[0].ownerName==="Carlos")?.total,-100);
});
test("Editar activa y navegar no borra scores; Guardar confirma la captura",()=>{
  const app=fs.readFileSync("app/page.tsx","utf8"),nav=fs.readFileSync("app/components/use-screen-navigation.ts","utf8");
  assert.match(app,/function editActiveRound\(\) \{ setRoundClosed\(false\); setEditingRound\(true\); setTab\("setup"\); \}/);
  assert.doesNotMatch(app,/if \(tab !== "round"[\s\S]{0,100}ensureHoleScoresAtPar/);
  assert.match(app,/commitHoleCapture\(scores, scoreEdits, hole, players\)/);assert.doesNotMatch(app,/Confirmar Par/);assert.match(nav,/window.history.back\(\)/);assert.match(nav,/previous.scroll/);
});
