import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as views from "../lib/social-feed-view";
import * as presentation from "../lib/social-feed-presentation";
import type { SocialActivityCard } from "../lib/social-activity-contract";
import { socialUI, uiFind, uiNodes, uiText, settleUI } from "./helpers/social-ui";
import { renderCareer } from "./helpers/render-career";

const card:SocialActivityCard={id:"qa-activity",type:"ROUND_COMPLETED",audience:"FRIENDS",author:{userId:"peer",displayName:"Jugador QA",username:"peer",avatarUrl:null},createdAt:"2026-10-05T12:00:00Z",sourceVersion:3,currentHash:"actual-hash",roundId:"qa-round",round:{roundId:"qa-round",localRoundId:"qa-local",date:"2026-10-05",courseName:"Campo de pruebas aisladas",teeName:"Blancas",holesPlayed:18,ownerScore:72,coursePar:72,toPar:0,putts:0,girPct:50,firPct:0,leaderboard:[{userId:"peer",name:"Jugador QA",avatarUrl:null,score:72,toPar:0,holes:18},{userId:"other",name:"Otro jugador",avatarUrl:null,score:80,toPar:8,holes:18}]},achievements:["Mejor ronda"],likesCount:2,likedByMe:false,commentsCount:2,attestCount:1,isAttestedByMe:true,canAttest:false,requiresParticipantConfirmation:false,participantPlayerKey:null,targetUserId:"peer"};
const own={id:"own",activityId:card.id,author:{userId:"owner",displayName:"Mi nombre",username:"owner",avatarUrl:null},text:"Comentario propio",createdAt:card.createdAt};
const other={...own,id:"other",author:card.author,text:"Comentario de otro jugador"};

test("Feed destinations preserve global/card query state and reject another module",()=>{
  const href=views.socialFeedViewHref("?screen=welcome&home=feed&keep=1",{id:card.id,kind:"comments"});
  assert.deepEqual(views.socialFeedViewFromSearch(href.slice(1)),{id:card.id,kind:"comments"});
  assert.equal(views.socialFeedViewFromSearch(`${href.slice(1)}&card=social:qa-activity`),null);
  assert.equal(views.socialFeedViewFromSearch("?screen=career&feedActivity=qa-activity&feedView=comments"),null);
  assert.equal(views.socialFeedViewFromSearch("?home=friends&feedActivity=qa-activity&feedView=comments"),null);
  assert.equal(views.socialFeedViewFromSearch("?feedActivity=%2Fprivate&feedView=results"),null);
  assert.equal(views.socialFeedViewHref("?card=social:qa-activity&cardHole=2&feedActivity=qa-activity&feedView=results",null),"/?card=social%3Aqa-activity&cardHole=2");
});

test("compact metric circles retain zero, omit null/nonfinite, and separate gross from vs par",()=>{
  const html=renderCareer("app/components/cloud-social-activity.tsx","ScoreSummary",{round:card.round});
  assert.match(html,/data-metric="Putts"[\s\S]*>0<\/b>/);assert.match(html,/data-metric="FIR"[\s\S]*>0%<\/b>/);assert.match(html,/0 contra par/);
  const incomplete=renderCareer("app/components/cloud-social-activity.tsx","ScoreSummary",{round:{...card.round,putts:null,girPct:NaN,firPct:undefined,toPar:undefined}});
  assert.doesNotMatch(incomplete,/data-metric|contra par/);assert.match(incomplete,/>72<\/strong>/);
});

for(const kind of ["comments","results"] as const)test(`Feed ${kind} refetches authorized identity and opens a dedicated destination`,async()=>{
  const calls:string[]=[];let opened:any;const h=socialUI("app/components/cloud-social-activity.tsx",{"social-feed-presentation":presentation,"social-feed-detail":{sameSocialActivity:(a:SocialActivityCard,b:SocialActivityCard)=>a.id===b.id&&a.roundId===b.roundId&&a.author.userId===b.author.userId},"social-activity-client":{socialRequest:async(path:string)=>{calls.push(path);return{data:card};},socialErrorMessage:String}});
  const props={card,viewerId:"owner",accessToken:"isolated-test",onRefresh:async()=>{},onOpenScorecard(){},onOpenDetail:(type:string,data:SocialActivityCard)=>{opened={type,data};}};
  const tree=h.render("SocialRoundActivityCard",props);uiFind(tree,n=>n.type==="button"&&(kind==="comments"?String(n.props["aria-label"]).startsWith("Comentar"):uiText(n).includes("Ver resultados"))).props.onClick();await settleUI();
  assert.deepEqual(calls,["/api/social/activity/qa-activity"]);assert.equal(opened.type,kind);assert.equal(opened.data.roundId,card.roundId);assert.equal(opened.data.author.userId,"peer");assert.equal(uiNodes(h.render("SocialRoundActivityCard",props)).filter(n=>n.type==="ol"||n.type==="textarea"||n.type==="table").length,0);
});
test("revoked or mismatched publication never opens a destination",async()=>{
  let opens=0;const h=socialUI("app/components/cloud-social-activity.tsx",{"social-feed-presentation":presentation,"social-feed-detail":{sameSocialActivity:(a:SocialActivityCard,b:SocialActivityCard)=>a.id===b.id&&a.roundId===b.roundId&&a.author.userId===b.author.userId},"social-activity-client":{socialRequest:async()=>({data:{...card,author:{...card.author,userId:"wrong"}}}),socialErrorMessage:String}});
  const props={card,viewerId:"owner",accessToken:"isolated-test",onRefresh:async()=>{},onOpenScorecard(){},onOpenDetail:()=>{opens++;}};
  uiFind(h.render("SocialRoundActivityCard",props),n=>n.type==="button"&&String(n.props["aria-label"]).startsWith("Comentar")).props.onClick();await settleUI();assert.equal(opens,0);assert.match(uiText(h.render("SocialRoundActivityCard",props)),/ya no está disponible/);
});

test("share copies only a permission-protected destination and reports success",async()=>{
  let copied="";const h=socialUI("app/components/cloud-social-activity.tsx",{"social-feed-presentation":presentation,"social-activity-client":{socialErrorMessage:String}},{navigator:{clipboard:{writeText:async(value:string)=>{copied=value;}}}});
  const props={card,viewerId:"owner",accessToken:"isolated-test",onRefresh:async()=>{},onOpenScorecard(){}};
  uiFind(h.render("SocialRoundActivityCard",props),n=>n.type==="button"&&uiText(n)==="Compartir").props.onClick();await settleUI();assert.equal(copied,"https://dev.thebackyard.com.mx/?card=social%3Aqa-activity");assert.match(uiText(h.render("SocialRoundActivityCard",props)),/Enlace copiado/);assert.doesNotMatch(copied,/token|hash|secret/i);
});

function commentsUI(fail=false){const calls:any[]=[];let refresh=0;const h=socialUI("app/components/social-feed-detail.tsx",{"social-feed-presentation":presentation,"social-feed-view":views,"social-activity-client":{socialRequest:async(path:string,_token:string,init:any)=>{calls.push({path,init});if(init?.method&&fail)throw Error("Error controlado");return{data:[own,other]};},socialErrorMessage:String}});const props={card,viewerId:"owner",accessToken:"isolated-test",onClose(){},onRefresh:async()=>{refresh++;}};return{h,calls,render:()=>h.render("SocialActivityComments",props),refresh:()=>refresh};}

test('Atest distinguishes own confirmations, persisted pending requests and no remaining eligible companions without duplicate controls',()=>{
  const h=socialUI('app/components/cloud-social-activity.tsx',{'social-feed-presentation':presentation});
  const base={viewerId:'peer',accessToken:'isolated-test',onRefresh:async()=>{},onOpenScorecard(){}};
  let tree=h.render('SocialRoundActivityCard',{...base,card:{...card,isAttestedByMe:false,attestCount:2,pendingAttestRequests:1,remainingAttestCompanions:0}});
  assert.match(uiText(tree),/Atestada por 2 compañeros/);assert.doesNotMatch(uiText(tree),/Solicitar Atest|Solicitar a otro/);
  const controls=uiNodes(tree).filter(n=>n.type==='button'&&n.props['aria-label']==='Qué significa Atest');assert.equal(controls.length,1);
  controls[0].props.onClick();tree=h.render('SocialRoundActivityCard',{...base,card:{...card,isAttestedByMe:false,attestCount:2,pendingAttestRequests:1,remainingAttestCompanions:0}});
  assert.match(uiText(tree),/2 compañeros confirmaron · Versión 3.*1 solicitudes pendientes.*Sin más compañeros disponibles/);
  tree=h.render('SocialRoundActivityCard',{...base,card:{...card,isAttestedByMe:false,attestCount:0,pendingAttestRequests:1,remainingAttestCompanions:1}});
  assert.match(uiText(tree),/Solicitud pendiente.*Solicitar a otro compañero/);assert.doesNotMatch(uiText(tree),/Atestada por/);
  tree=h.render('SocialRoundActivityCard',{...base,viewerId:'another',card:{...card,isAttestedByMe:true,canAttest:true}});
  assert.match(uiText(tree),/Atestada por ti/);assert.equal(uiNodes(tree).filter(n=>n.type==='button'&&uiText(n)==='Atestar').length,0);
});

test('results player name focuses that authorized player and Ver tarjetas opens the shared grid',()=>{
  const opened:Array<string|undefined>=[];const h=socialUI('app/components/social-feed-detail.tsx',{'use-modal-dialog':{useModalDialog:()=>({current:null})}});
  const tree=h.render('SocialRoundResults',{card,onClose(){},onOpenScorecard:(playerId?:string)=>opened.push(playerId)});
  uiFind(tree,n=>n.type==='button'&&uiText(n)==='Otro jugador').props.onClick();
  uiFind(tree,n=>n.type==='button'&&uiText(n)==='Ver tarjetas').props.onClick();
  assert.deepEqual(opened,['other',undefined]);
});
test("dedicated comments load lazily, preserve authors and expose only own editing/deletion",async()=>{const s=commentsUI();s.render();await settleUI();const tree=s.render();assert.match(uiText(tree),/Comentario propio[\s\S]*Comentario de otro jugador/);assert.equal(uiNodes(tree).filter(n=>n.type==="button"&&uiText(n)==="Editar").length,1);assert.equal(uiNodes(tree).filter(n=>n.type==="button"&&uiText(n)==="Eliminar").length,1);assert.equal(uiFind(tree,n=>n.props["data-feed-view"]==="comments").type,"section");});
test("comment create/edit/cancel/delete keep the existing hash, paths and single-card refresh",async()=>{
  const s=commentsUI();s.render();await settleUI();let tree=s.render();uiFind(tree,n=>n.type==="textarea").props.onChange({target:{value:"  Buena ronda  "}});tree=s.render();uiFind(tree,n=>n.type==="form").props.onSubmit({preventDefault(){}});await settleUI();assert.equal(s.refresh(),1);assert.deepEqual({...s.calls.find(c=>c.init?.method==="POST").init.body},{text:"Buena ronda",expectedHash:card.currentHash});
  tree=s.render();uiFind(tree,n=>n.type==="button"&&uiText(n)==="Editar").props.onClick();tree=s.render();uiFind(tree,n=>n.type==="button"&&uiText(n)==="Cancelar edición").props.onClick();tree=s.render();assert.equal(uiFind(tree,n=>n.type==="textarea").props.value,"");
  uiFind(tree,n=>n.type==="button"&&uiText(n)==="Editar").props.onClick();tree=s.render();uiFind(tree,n=>n.type==="form").props.onSubmit({preventDefault(){}});await settleUI();assert.match(s.calls.find(c=>c.init?.method==="PATCH").path,/\/comments\/own$/);
  tree=s.render();uiFind(tree,n=>n.type==="button"&&uiText(n)==="Eliminar").props.onClick();await settleUI();assert.equal(s.calls.find(c=>c.init?.method==="DELETE").init.body.expectedHash,card.currentHash);assert.equal(s.refresh(),3);
});
test("comment errors retain the draft and do not refresh unrelated activity",async()=>{const s=commentsUI(true);s.render();await settleUI();let tree=s.render();uiFind(tree,n=>n.type==="textarea").props.onChange({target:{value:"No perder este comentario"}});tree=s.render();uiFind(tree,n=>n.type==="form").props.onSubmit({preventDefault(){}});await settleUI();tree=s.render();assert.equal(uiFind(tree,n=>n.type==="textarea").props.value,"No perder este comentario");assert.match(uiText(tree),/Error controlado/);assert.equal(s.refresh(),0);});

test("comments Back restores feed scroll, results → scorecard → Back restores classification",()=>{
  let open:any;const h=socialUI("app/components/social-feed-detail.tsx",{"social-feed-view":views,"social-activity-client":{socialRequest:async()=>({data:card}),socialErrorMessage:String}});
  const props={viewerId:"owner",accessToken:"isolated-test",onRefresh:async()=>{},children:(fn:any)=>{open=fn;return"Mounted Feed";},onOpenScorecard:()=>{h.window.history.pushState({...h.window.history.state,backyardScorecard:"social:qa-activity"},"","/?feedActivity=qa-activity&feedView=results&card=social:qa-activity");}};
  h.render("SocialFeedViews",props);h.window.scrollY=540;open("comments",card);let tree=h.render("SocialFeedViews",props);assert.equal(h.window.scrollY,0);assert.ok(uiNodes(tree).some(n=>n.type==="div"&&n.props.hidden));uiFind(tree,n=>typeof n.type==="function"&&n.type.name==="SocialActivityComments").props.onClose();tree=h.render("SocialFeedViews",props);assert.equal(h.window.scrollY,540);assert.equal(views.socialFeedViewFromSearch(h.location.search),null);
  open("results",card);tree=h.render("SocialFeedViews",props);uiFind(tree,n=>typeof n.type==="function"&&n.type.name==="SocialRoundResults").props.onOpenScorecard();tree=h.render("SocialFeedViews",props);assert.ok(!uiNodes(tree).some(n=>typeof n.type==="function"&&n.type.name==="SocialRoundResults"));h.window.history.back();tree=h.render("SocialFeedViews",props);assert.equal(uiFind(tree,n=>typeof n.type==="function"&&n.type.name==="SocialRoundResults").props.card.id,card.id);uiFind(tree,n=>typeof n.type==="function"&&n.type.name==="SocialRoundResults").props.onClose();h.render("SocialFeedViews",props);assert.equal(h.window.scrollY,540);
});
test("results show only authorized participants, gross scores and existing achievements",()=>{const html=renderCareer("app/components/social-feed-detail.tsx","SocialRoundResults",{card,onClose(){},onOpenScorecard(){}});assert.match(html,/role="dialog"/);assert.match(html,/Jugador QA[\s\S]*Otro jugador/);assert.match(html,/Score bruto/);assert.doesNotMatch(html,/Neto|apuesta|balance|\$/i);assert.match(html,/Ver tarjetas/);const source=readFileSync("app/components/cloud-social-activity.tsx","utf8");assert.doesNotMatch(source,/styles\.leaderboard|showComments|roundDetails/);assert.match(source,/expectedVersion: card.sourceVersion, expectedHash: card.currentHash/);});
