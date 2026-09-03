import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { browseRulesSource, searchRulesCorpus, searchRulesDocumentPages } from "../lib/rules-search";
import { searchNavigableRules } from "../lib/rules-navigation";
import { createDictationSession, DICTATION_NO_RESULT, speechRecognitionErrorMessage, type SpeechRecognitionLike } from "../lib/speech-dictation";

test("Búsquedas reales: número, subregla, título, sinónimos y acentos",()=>{
  for(const [query,reference] of [["16.1","16.1"],["bola provisional","18.3"],["cart path","16.1"],["OB","18"],["drop","14.3"],["bola injugable","19"],["ÁREA DE PENALIDAD","17"],["aspersor","16"],["7.3","7.3"]]) {
    assert.ok(searchRulesCorpus(query).some(result=>result.rule.startsWith(reference)),query);
  }
  assert.deepEqual(searchRulesCorpus("área penalidad"),searchRulesCorpus("AREA  PENALIDAD"));
  assert.ok(!searchNavigableRules("cart path").some(result=>result.section?.number==="16.2"));
  assert.ok(!searchNavigableRules("7.3").some(result=>result.section?.number==="17.3"));
});
test("Búsqueda no corta coincidencias a12 ni subreglas a18; incluye Comité y Aclaraciones",()=>{
  const results=searchRulesCorpus("bola");assert.ok(results.length>30);
  assert.ok(results.some(result=>result.documentType==="clarification")); assert.ok(results.some(result=>result.documentType==="committee"));
  assert.ok(browseRulesSource("committee-procedures-part-2").length>24);
  assert.equal(browseRulesSource("clarifications-july-2026").length,13);
  assert.ok(results.every((entry,index)=>results.findIndex(other=>other.id===entry.id)===index));
});
test("Visor PDF usa canvas interno, solo carga al abrir, con navegación, zoom y limpieza",()=>{
  const viewer=readFileSync("app/components/internal-pdf-viewer.tsx","utf8"), panel=readFileSync("app/components/rules-panel.tsx","utf8");
  assert.match(viewer,/import\("pdfjs-dist\/legacy\/build\/pdf.mjs"\)/);assert.match(viewer,/getDocument\(\{ url: document.localUrl \}\)/);
  assert.match(viewer,/← Regresar a Reglas/);assert.match(viewer,/<canvas/);assert.match(viewer,/render\?\.cancel\(\)/);assert.match(viewer,/task\?\.destroy\(\)/);
  assert.match(panel,/selectedDocument && <InternalPdfViewer/);assert.doesNotMatch(panel,/<iframe src=\{selectedDocument/);
  const route=readFileSync("app/api/rules/documents/[id]/route.ts","utf8")+readFileSync("lib/pdf-proxy.ts","utf8");
  assert.match(route,/cache: "no-store"/);assert.match(route,/s-maxage=86400/);
});
test("visor PDF usa índice local por página, incluso si Safari no expone capa de texto",()=>{
  const viewer=readFileSync("app/components/internal-pdf-viewer.tsx","utf8");
  const route=readFileSync("app/api/rules/documents/[id]/search/route.ts","utf8");
  const penalty=searchRulesDocumentPages("official-guide-part-1","área de penalidad");
  const provisional=searchRulesDocumentPages("official-guide-part-1","bola provisional");
  const committee=searchRulesDocumentPages("committee-procedures-part-2","ritmo de juego");
  assert.ok(penalty.length>1);assert.ok(committee.length>0);
  assert.ok(provisional.length>0);assert.ok(provisional.every(match=>match.excerpt.includes("bola provisional")));
  assert.deepEqual(searchRulesDocumentPages("official-guide-part-1","ÁREA  DE PENALIDAD"),penalty);
  assert.deepEqual(searchRulesDocumentPages("clarifications-july-2026","texto-inexistente-zzzz"),[]);
  assert.match(viewer,/static-index-unavailable/);assert.match(viewer,/índice local/);
  assert.match(route,/searchRulesDocumentPages/);assert.match(route,/static-page-index/);
});
test("índice PDF encuentra consultas reales y devuelve página, fragmento y navegación interna",()=>{
  const cases: Array<["official-guide-part-1" | "committee-procedures-part-2", string]> = [
    ["official-guide-part-1", "bola provisional"],
    ["official-guide-part-1", "área de penalidad"],
    ["official-guide-part-1", "bunker"],
    ["official-guide-part-1", "obstrucción"],
    ["official-guide-part-1", "cart path"],
    ["official-guide-part-1", "bola injugable"],
    ["committee-procedures-part-2", "ritmo de juego"],
  ];
  for (const [sourceId, query] of cases) {
    const matches = searchRulesDocumentPages(sourceId, query);
    assert.ok(matches.length > 0, query);
    assert.ok(matches.every(match => Number.isInteger(match.page) && match.page > 0), `${query}: página`);
    assert.ok(matches.every(match => Boolean(match.excerpt?.trim())), `${query}: fragmento`);
  }
  const viewer=readFileSync("app/components/internal-pdf-viewer.tsx","utf8");
  assert.match(viewer,/scrollToPage\(indexed\[0\]\.page\)/);
  assert.match(viewer,/moveMatch\(-1\)/);
  assert.match(viewer,/moveMatch\(1\)/);
  assert.match(viewer,/scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
});
class SpeechMock implements SpeechRecognitionLike {
  static last: SpeechMock; lang="";continuous=false;interimResults=false;
  onstart: SpeechRecognitionLike["onstart"]=null;onresult:SpeechRecognitionLike["onresult"]=null;onerror:SpeechRecognitionLike["onerror"]=null;onend:SpeechRecognitionLike["onend"]=null;
  stopped=false;constructor(){SpeechMock.last=this;}start(){this.onstart?.();}stop(){this.stopped=true;}
}
test("Dictado inicia dentro del gesto, entrega resultado final después de Detener y limpia handlers",()=>{
  const texts:string[]=[], statuses:string[]=[],listening:boolean[]=[];
  const session=createDictationSession(SpeechMock,{transcript:text=>texts.push(text),status:text=>statuses.push(text),listening:value=>listening.push(value)});
  session.start();assert.equal(SpeechMock.last.lang,"es-MX");assert.equal(listening.at(-1),true);
  session.stop();SpeechMock.last.onresult?.({results:[[{transcript:"bola en camino"}]]});SpeechMock.last.onend?.();
  assert.deepEqual(texts,["bola en camino"]);assert.equal(listening.at(-1),false);assert.notEqual(statuses.at(-1),DICTATION_NO_RESULT);
  session.dispose();assert.equal(SpeechMock.last.onresult,null);
});
test("Dictado fin sin resultado y error de permisos/red no quedan como Escuchando",()=>{
  let message="",listening=false;
  const callbacks={transcript:()=>undefined,status:(text:string)=>{message=text;},listening:(value:boolean)=>{listening=value;}};
  const empty=createDictationSession(SpeechMock,callbacks);empty.start();SpeechMock.last.onend?.();assert.equal(message,DICTATION_NO_RESULT);assert.equal(listening,false);empty.dispose();
  for(const error of ["network","not-allowed","audio-capture"]) {
    const session=createDictationSession(SpeechMock,callbacks);session.start();SpeechMock.last.onerror?.({error});SpeechMock.last.onend?.();
    assert.equal(message,speechRecognitionErrorMessage({error}));assert.equal(listening,false);session.dispose();
  }
});
