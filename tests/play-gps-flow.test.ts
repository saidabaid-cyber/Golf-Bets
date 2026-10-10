import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { hasRoundToPreserve } from '../lib/new-round-safety';
import { initialBets } from '../lib/new-round-bets';
import { collectRoundSetupPreflightIssues } from '../lib/round-setup-preflight';
import { collectHoleValidationErrors } from '../lib/hole-validation';
import { commitHoleCapture, applyPendingScoreEdits } from '../lib/score-capture';

// Execute the actual orchestration functions, not a second round implementation.
const page = ts.createSourceFile('page.tsx',readFileSync('app/page.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function actualFunction(name:string,scope:Record<string,unknown>) {
 let found:ts.FunctionDeclaration|undefined;
 function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;ts.forEachChild(node,visit);}
 visit(page);assert.ok(found,name);
 const source=ts.transpileModule(`export ${found!.getText(page)}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports:any={};runInNewContext(source,{exports,...scope});return exports[name];
}
const owner={id:'owner',accountUserId:'real-account',name:'Current user',handicap:null};
const fresh={players:[owner],scores:{},scoreEdits:{},bets:initialBets(['owner']),personalBets:[],supplementalBets:[],manualBets:[],courseSelected:false,currentIndex:0};
test('visiting Play or inserting the current account alone does not create a draft',()=>{
 assert.equal(hasRoundToPreserve(fresh,'real-account'),false);
 for(const change of [{courseIdentity:{catalogClubId:'club'}},{courseIdentity:{catalogCourseId:'temporary-par70'}},{scores:{1:{owner:4}}},{players:[owner,{id:'guest',name:'Guest'}]},{startedAt:'2026-10-09T12:00:00Z'}]) assert.equal(hasRoundToPreserve({...fresh,...change},'real-account'),true);
});
test('fresh round drops previous participants, bets, start hole and duration; it keeps no old template',()=>{
 const observed:Record<string,unknown>={};
 const globals:any={identity:{mode:'authenticated'},accountIndex:null,accountPrimaryRoundPlayer:()=>owner,initialBets,normalizeRoundPresentation:()=>({playMode:'normal'}),emptyCounterBetKeepers:()=>({}),emptyExpenses:{},playOrder:()=>Array.from({length:18},(_,i)=>i+1),segmentDefinitions:()=>[],laVista:{id:'default-not-selected'},makeId:()=> 'NEW-ID',localDateMexico:()=> '2026-10-09',undoStack:{current:[]}};
 const fn=page.getText().slice(page.getText().indexOf('  function resetRound('),page.getText().indexOf('  function applyNewRoundIntent('));
 globals.URL=URL; globals.window={location:{href:'https://qa.invalid/?sharedRound=old'},history:{replaceState:()=>{}}};
 for(const name of new Set(fn.match(/set[A-Z]\w+/g)||[]))globals[name]=(value:unknown)=>observed[name]=value;
 actualFunction('resetRound',globals)();
 assert.deepEqual(JSON.parse(JSON.stringify(observed.setPlayers)),[owner]);assert.equal(observed.setRoundId,'NEW-ID');assert.equal(observed.setStartHole,1);assert.equal(observed.setRoundHoles,18);
 for(const name of ['setPersonalBets','setSupplementalBets','setManualBets','setPlayerTeeAssignments'])assert.deepEqual(JSON.parse(JSON.stringify(observed[name])),[]);
 assert.deepEqual(JSON.parse(JSON.stringify(observed.setBets)),initialBets(['owner']));assert.equal(observed.setRoundTemplateOrigin,null);assert.equal(observed.setCourseSelected,false);
});
test('solo score start does not require GHIN, HCP or geometry; incomplete Par70 card remains blocked',()=>{
 for(const player of [owner,{...owner,handicap:7.9}]) assert.deepEqual(collectRoundSetupPreflightIssues({courseSelected:true,players:[player],betIssues:[]}),[]);
 const [issue]=collectRoundSetupPreflightIssues({courseSelected:false,pendingCourse:{name:'Par70',catalogCourseId:'par70',selectionIssue:'Hoyos 1–18: par, SI y yardas por tee pendientes.'},players:[owner],betIssues:[]});
 assert.equal(issue.label,'Tarjeta de la configuración');assert.match(issue.detail,/1–18/);
});
test('continue resumes the current hole without replacing it with the first pending edit',()=>{
 const navigated:string[]=[];
 const scope={order:[1,2,3],players:[owner],scoreEdits:{1:{owner:5}},activeRoundSummary:{status:'live'},courseSelected:true,
 activeRoundContinueTarget:()=> 'round',openActiveRound:()=>navigated.push('round'),setTab:(tab:string)=>navigated.push(tab)};
 // It's a const arrow, so execute the actual body from its AST initializer.
 let declaration:ts.VariableDeclaration|undefined;
 function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(page)==='continueActiveRound')declaration=node;ts.forEachChild(node,visit);}
 visit(page);assert.ok(declaration?.initializer);
 runInNewContext(`(${declaration!.initializer!.getText(page)})();`,scope);
 assert.deepEqual(navigated,['round']); // No setCurrentIndex exists in this scope.
});
test('GPS explicit save checkpoints the same hole and never advances or opens a summary',()=>{
 let persisted=0;const committed:any={};
 const scope:any={holeSummarySession:{current:null},hasActiveBettingConfiguration:()=>false,requiredRoundCaptureFactErrors:()=>[],players:[owner],bets:initialBets(['owner']),supplementalBets:[],putts:{},counterBetEvents:[],currentIndex:2,holeNumber:3,roundHandicapBasis:"relative",scores:{1:{owner:4}},scoreEdits:{3:{owner:5}},abandonedPressurePlayersWithMissingScores:()=>[],collectHoleValidationErrors,scoreCaptureComplete:true,counterBetKeepers:{},lobaHoles:{},segments:[],order:[1,2,3],ballFriendSetup:{},betConfigurationIssues:[],hole:{number:3,par:4,strokeIndex:3},commitHoleCapture,ensureRoundStarted:()=> '2026-10-09T12:00:00Z',freezeRoundHandicapBases:(bets:unknown)=>bets,persistCommittedHoleBeforeAdvance:(scores:unknown,_edits:unknown,_bets:unknown,index:number)=>{persisted++;assert.equal(index,2);committed.scores=scores;return true;},setHoleValidationErrors:()=>{},setFeedback:()=>{},checkpoint:()=>{},setBets:()=>{},setScores:()=>{},setScoreEdits:()=>{}};
 const save=actualFunction('saveAndAdvance',scope);
 assert.equal(save(false),true);assert.equal(persisted,1);assert.deepEqual(JSON.parse(JSON.stringify(committed.scores)),{1:{owner:4},3:{owner:5}});
 // No summary/camera/navigation functions are supplied: calling one would fail.
 scope.scoreEdits={};scope.scores={};scope.scoreCaptureComplete=false;
 scope.savePartialHole=actualFunction('savePartialHole',{...scope,applyPendingScoreEdits,setCurrentIndex:()=>{}});
 const missing=actualFunction('saveAndAdvance',scope);assert.equal(missing(false),false);assert.equal(persisted,1);
});

test('owner may save one explicit player without confirming suggested pars of others',()=>{
 let checkpoint:any; const scope={holeNumber:1,currentIndex:0,order:[1,2,3],players:[owner,{id:'other',name:'Other'}],scores:{},scoreEdits:{1:{owner:4}},bets:initialBets([]),applyPendingScoreEdits,
 persistCommittedHoleBeforeAdvance:(scores:unknown,edits:unknown,_bets:unknown,index:number)=>{checkpoint={scores,edits,index};return true;},setScores:()=>{},setScoreEdits:()=>{},setCurrentIndex:()=>{},setFeedback:()=>{}};
 assert.equal(actualFunction('savePartialHole',scope)(true),true);assert.deepEqual(JSON.parse(JSON.stringify(checkpoint.scores)),{1:{owner:4}});assert.equal(checkpoint.index,1);
});
