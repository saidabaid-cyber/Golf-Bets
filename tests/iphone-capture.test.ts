import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { commitHoleCapture, editCapturedScore, holeCapture, isHoleCaptureComplete, type ScoreRows } from "../lib/score-capture";
import { foursomeHoleConfigurationError, foursomePressure, setFoursomePressure } from "../lib/foursome-config";
import { calculateFoursomes, calculatePersonalBets, opponentPairs, playOrder } from "../lib/engine";
import { pdfPixelRatio, withPdfDeadline } from "../lib/pdf-viewer-utils";
import { createDictationSession, DICTATION_FALLBACK, type SpeechRecognitionLike } from "../lib/speech-dictation";
import { fullRoundBets, fullRoundCourse as course, fullRoundPlayers as players, fullRoundSegments as segments, fullRoundPersonal } from "./fixtures/full-round";
import { realCases, realCourse, realOrder, realPersonal, realPlayers, realScores } from "./fixtures/personals-real";

const app = readFileSync("app/page.tsx", "utf8");
const rules = readFileSync("app/components/rules-panel.tsx", "utf8");
const css = readFileSync("app/functional-ux.css", "utf8");
const cfg = { ...fullRoundBets.foursome, handicapMethod: "excel" as const };
const engine = (scores: ScoreRows) => ({ foursome: calculateFoursomes(course, scores, players, cfg, segments, playOrder()), personal: calculatePersonalBets([fullRoundPersonal], "said", players, course, scores, playOrder()) });

test("nuevo hoyo propone Par como valor sin crear scores oficiales", () => {
  const scores = {};
  assert.deepEqual(holeCapture(scores, {}, course.holes[0], players), { said:4, cuau:4, armando:4, jesus:4 });
  assert.deepEqual(scores, {});
  assert.equal(engine(scores).foursome.matches[0].completedHoles, 0);
  assert.equal(isHoleCaptureComplete(scores, {}, 1, players), false);
});

test("más, menos, PAR y borrar solo modifican captura; guardar con vacío se rechaza", () => {
  let edits = editCapturedScore({}, 1, "said", 5);
  assert.equal(holeCapture({}, edits, course.holes[0], players).said, 5);
  edits = editCapturedScore(edits, 1, "said", 3);
  assert.equal(holeCapture({}, edits, course.holes[0], players).said, 3);
  edits = editCapturedScore(edits, 1, "said", course.holes[0].par);
  assert.equal(holeCapture({}, edits, course.holes[0], players).said, 4);
  edits = editCapturedScore(edits, 1, "said", null);
  assert.equal(holeCapture({}, edits, course.holes[0], players).said, null);
  assert.equal(commitHoleCapture({}, edits, course.holes[0], players), null);
});

test("todos Par requieren confirmación explícita; Foursome y Personal solo cambian después de Guardar", () => {
  const before = engine({});
  let edits: ScoreRows = {};
  for (const player of players) edits = editCapturedScore(edits, 1, player.id, course.holes[0].par);
  assert.equal(isHoleCaptureComplete({}, edits, 1, players), true);
  const committed = commitHoleCapture({}, edits, course.holes[0], players)!;
  assert.equal(Object.keys(committed.scores[1]).length, 4);
  assert.equal(engine(committed.scores).foursome.matches[0].completedHoles, 1);
  assert.equal(before.personal.results[0].liveComponents[0].playedHoles, 0);
  assert.equal(engine(committed.scores).personal.results[0].liveComponents[0].playedHoles, 1);
  assert.deepEqual(committed.edits, {});
});

test("editar hoyo guardado conserva los resultados hasta Guardar, y nunca modifica el histórico fuente", () => {
  const original = commitHoleCapture({}, {}, course.holes[0], players)!.scores;
  const expected = structuredClone(original), before = engine(original);
  let edits = editCapturedScore({}, 1, "said", 1);
  edits = editCapturedScore(edits, 2, "cuau", 7);
  assert.deepEqual(engine(original), before);
  const committed = commitHoleCapture(original, edits, course.holes[0], players)!;
  assert.notDeepEqual(engine(committed.scores), before);
  assert.deepEqual(original, expected);
  assert.equal(committed.edits[2].cuau, 7);
  assert.equal(holeCapture(committed.scores, committed.edits, course.holes[0], players).said, 1);
  assert.deepEqual(JSON.parse(JSON.stringify({ scores: committed.scores, scoreEdits: committed.edits })), { scores: committed.scores, scoreEdits: committed.edits });
});

for (const start of [1, 10] as const) for (const count of [9, 18]) test(`captura completa ${count} hoyos salida H${start}: no adelanta scores`, () => {
  let official: ScoreRows = {};
  for (const number of playOrder(start).slice(0,count)) {
    const hole = course.holes.find(item => item.number === number)!;
    assert.equal(official[number], undefined);
    assert.equal(holeCapture(official, {}, hole, players).said, hole.par);
    let edits: ScoreRows = {};
    for (const player of players) edits = editCapturedScore(edits, number, player.id, hole.par);
    assert.equal(isHoleCaptureComplete(official, edits, number, players), true);
    official = commitHoleCapture(official, edits, hole, players)!.scores;
  }
  assert.equal(Object.keys(official).length, count);
});

test("nuevas rondas usan controles acordados sin selector interno; snapshots mantienen método", () => {
  assert.match(readFileSync("lib/new-round-bets.ts", "utf8"), /handicapMethod: "configured"/);
  assert.doesNotMatch(app, /HCP de Foursome|Excel original · rebasing|Porcentaje \/ redondeo acordado/);
  assert.match(app, /handicapMethod: draft.bets.foursome\?\.handicapMethod \|\| "configured"/);
  const scores = { 1: { said:4, cuau:4, armando:4, jesus:4 } };
  const legacy = { ...cfg, handicapMethod:"configured" as const, hcpPct:0 };
  const saved = JSON.parse(JSON.stringify({ scores, config: legacy }));
  const first = calculateFoursomes(course,scores,players,legacy,segments,playOrder());
  assert.deepEqual(calculateFoursomes(course,saved.scores,players,saved.config,segments,playOrder()), first);
  assert.notDeepEqual(first, calculateFoursomes(course,scores,players,cfg,segments,playOrder()));
});

test("presión x2/x3 visible; Sin presión limpia vuelta y flag antiguo, neutraliza dinero", () => {
  for (const multiplier of [2,3] as const) {
    const pressed = setFoursomePressure({ ...cfg, pressureNine:"holes_1_9" },multiplier);
    assert.ok(foursomePressure(pressed)>1);
    const cleared = setFoursomePressure({ ...pressed, pressSecond9:true },1);
    assert.equal(foursomePressure(cleared),1); assert.equal(cleared.pressSecond9,false); assert.equal(cleared.pressureNine,undefined);
    const scores = { 1:{said:3,cuau:3,armando:6,jesus:6} };
    assert.deepEqual(calculateFoursomes(course,scores,players,cleared,segments,playOrder()).provisionalBalances,
      calculateFoursomes(course,scores,players,{...cfg,pressureMultiplier:1},segments,playOrder()).provisionalBalances);
  }
  assert.match(app,/foursomePressure\(bets.foursome\) > 1 && <div><label>Vuelta presionada/);
});

test("dos seleccionados forman el único rival con cuatro; más jugadores no despliega todas las combinaciones", () => {
  assert.deepEqual(opponentPairs(["said","daniel","juan","flavio"],["said","daniel"]), [["juan","flavio"]]);
  assert.doesNotMatch(app,/opps\.map/);
  assert.match(app,/opps.length === 1/);
});

test("Foursome activo bloquea Guardar si el tramo actual no tiene pareja válida", () => {
  const enabled = { ...cfg, enabled: true, participantIds: ["said", "cuau", "armando", "jesus"] };
  const disabled = { ...enabled, enabled: false };
  const order = playOrder();
  const configured = segments.map((segment) => ({ ...segment }));
  const missingCurrent = configured.map((segment, index) => index === 1 ? { ...segment, basePair: [] } : segment);
  assert.equal(foursomeHoleConfigurationError(disabled, [], order, 1), "");
  assert.match(foursomeHoleConfigurationError(enabled, [], order, 1), /Completa Foursome/);
  assert.equal(foursomeHoleConfigurationError(enabled, configured, order, 1), "");
  assert.match(foursomeHoleConfigurationError(enabled, missingCurrent, order, 7), /Completa Foursome/);
  assert.match(app, /const foursomeError = foursomeHoleConfigurationError/);
  assert.match(app, /if \(foursomeError\) \{ setFeedback\(foursomeError\); return; \}/);
});

test("Live compacto conserva ambas perspectivas exactamente una vez y detalle plegado", () => {
  const foursome = readFileSync("app/components/foursome-live.tsx","utf8");
  assert.equal((foursome.match(/className="foursomeTeam"/g)||[]).length,2);
  assert.match(foursome,/signed\(-match.pointDiff\)/);
  assert.match(foursome,/<details className="foursomeLiveDetails"><summary>Detalle/);
  const personal = readFileSync("app/components/personal-compact.tsx","utf8");
  assert.match(personal,/onClick=\{\(\) => onOpen\(result.betId\)\}/);
  assert.match(personal,/personalLiveCompact/);
});

test("captura conecta controles, PAR y Guardar, no Confirmar Par global; resumen separa jugadores", () => {
  assert.doesNotMatch(app,/Confirmar Par|confirmSuggestedScores/);
  assert.match(app,/onClick=\{\(\) => setScore\(p.id, hole.par\)\}/);
  assert.match(app,/setScoreEdits\(prev => editCapturedScore/);
  assert.match(app,/setScores\(committed.scores\)/);
  assert.match(app,/setFeedback\(""\);\s*checkpoint\(\)/);
  assert.match(app,/finishRound.current\(\)/);
  assert.match(css,/holeSummaryScores span:not\(:last-child\)::after\{content:" · "/);
  assert.match(css,/\.holeSummaryBets p\{white-space:pre-line/);
});

test("18 hoyos de casos reales a través de Guardar conservan las cuatro regresiones y suma cero", () => {
  let official: ScoreRows = {};
  for (const h of realOrder) {
    const before = structuredClone(official);
    let edits: ScoreRows = {};
    for (const p of realPlayers) edits = editCapturedScore(edits,h,p.id,realScores[h][p.id]);
    assert.deepEqual(official,before);
    official = commitHoleCapture(official,edits,realCourse.holes[h-1],realPlayers)!.scores;
  }
  const result = calculatePersonalBets(realCases.map(realPersonal),"said",realPlayers,realCourse,official,realOrder);
  assert.deepEqual(result.results.map(item => item.totalMoney),[-600,-200,800,-800]);
  assert.equal(result.balances.said,-800);
  assert.equal(Object.values(result.balances).reduce((a,b)=>a+b,0),0);
});

test("Reglas dejan IA/directorio plegables, recursos como accesos directos y videos abiertos al final", () => {
  assert.match(rules,/useState<Record<string, boolean>>\(\{\}\)/);
  assert.match(rules,/\[key\]: !current\[key\]/);
  assert.match(rules,/aria-expanded=\{open\}/);
  assert.match(rules,/open \? "▲" : "▼"/);
  const ids = [...rules.matchAll(/<RulesDisclosure id="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(ids,["preguntar-ia","reglamento-navegable","reglas-locales","codigo-caballeros","documentos-oficiales"]);
  assert.match(rules, /className="card rulesResourceShortcut" id="procedimientos-comite"/);
  assert.match(rules, /className="card rulesResourceShortcut" id="aclaraciones"/);
  assert.match(rules, /className="card videosCard" id="videos-reglas"/);
  assert.doesNotMatch(rules, /<RulesDisclosure id="videos-reglas"/);
  assert.match(rules,/NAVIGABLE_GOLF_RULES.map/);
  assert.match(rules,/\/api\/rules\/search\?q=/);
});

test("PDF falla de forma recuperable, enlaza fuente real, canvas limitado para iPhone", async () => {
  const viewer=readFileSync("app/components/internal-pdf-viewer.tsx","utf8");
  assert.match(viewer,/Ver fuente oficial ↗/); assert.match(viewer,/href=\{document.officialUrl\}/);
  assert.match(viewer,/← Regresar a Reglas/); assert.match(viewer,/Array\.from\(\{ length: pdf\.numPages \}/);
  assert.ok(2000*3000*pdfPixelRatio(2000,3000,3)**2<=4_000_001);
  assert.equal(await withPdfDeadline(Promise.resolve(7),20),7);
  await assert.rejects(withPdfDeadline(new Promise(()=>undefined),5),/PDF timeout/);
});

test("tarjeta admite paisaje, escalas y zoom nativo sin bloquear viewport", () => {
  const layout=readFileSync("app/layout.tsx","utf8");
  const scorecard=readFileSync("app/components/full-scorecard.tsx","utf8");
  assert.doesNotMatch(layout,/userScalable:\s*false|maximumScale:\s*1/);
  assert.match(css,/orientation:landscape/); assert.match(css,/touch-action:pan-x pan-y pinch-zoom/);
  assert.match(scorecard,/\[75,\s*90,\s*100\]/); assert.match(css,/scorecardTable\{max-width:100%;overflow-x:auto/);
});

test("dictado entrega parcial y final sin borrar al terminar; si no transcribe ofrece teclado", () => {
  class Speech implements SpeechRecognitionLike {
    static last:Speech; lang=""; continuous=false; interimResults=false;
    onstart:SpeechRecognitionLike["onstart"]=null;onresult:SpeechRecognitionLike["onresult"]=null;onend:SpeechRecognitionLike["onend"]=null;onerror:SpeechRecognitionLike["onerror"]=null;
    constructor(){Speech.last=this;} start(){this.onstart?.();} stop(){}
  }
  let text="",message="",focused=false;
  const session=createDictationSession(Speech,{transcript:value=>text=value,status:value=>message=value,listening:()=>undefined,fallback:()=>focused=true});
  session.start();assert.equal(Speech.last.interimResults,true);assert.equal(Speech.last.continuous,false);assert.equal(Speech.last.lang,"es-MX");
  Speech.last.onresult?.({results:[[{transcript:"bola"}]]});assert.equal(text,"bola");
  Speech.last.onresult?.({results:[[{transcript:"bola en camino"}]]});Speech.last.onend?.();assert.equal(text,"bola en camino");session.dispose();
  const empty=createDictationSession(Speech,{transcript:()=>undefined,status:value=>message=value,listening:()=>undefined,fallback:()=>focused=true});
  empty.start();Speech.last.onend?.();assert.equal(message,DICTATION_FALLBACK);assert.equal(focused,true);empty.dispose();
});
