import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { capturedHoleFacts } from "../lib/golf-captured-hole-facts";
import * as scorecard from "../lib/golf-scorecard-presentation";
import { safeSocialRoundCard } from "../lib/social-round-card";
import { displayDistanceFromStoredYards } from "../lib/account-ui-preferences";
import { careerRound } from "./helpers/career-round";
import { socialUI,uiNodes,uiFind,uiText } from "./helpers/social-ui";
test("rich captured facts preserve absence, explicit zero and direction without inventing FIR, OB or GIR",()=>{
  assert.deepEqual(capturedHoleFacts(undefined,4),{});
  assert.deepEqual(capturedHoleFacts({teeDirection:"center",landingLie:"water_ob"},4),{teeDirection:"center",landingLie:"water_ob"});
  const facts=capturedHoleFacts({fairwayHit:true,greenInRegulation:false,penaltyStrokes:0,outOfBoundsCount:0,teeClub:"7i",teeDistance:143,firstPuttDistanceFeet:12,bunkerCount:1,notes:"private"},3);
  assert.equal(facts.fairwayHit,undefined);assert.equal(facts.greenInRegulation,false);assert.equal(facts.outOfBoundsCount,0);assert.equal(facts.teeClub,"7i");assert.doesNotMatch(JSON.stringify(facts),/private|latitude|longitude/);
  assert.deepEqual(capturedHoleFacts({penaltyStrokes:-1,teeDistance:NaN,bunkerCount:1.5,teeClub:" "},4),{});
});
test("local and social facts come from the author's actual hole; private notes and peer equipment never leak",()=>{
  const r=careerRound("rich-hole",1);r.advancedStats={1:{"owner-player":{teeClub:"PW",teeDirection:"left",outOfBounds:true,firstPuttDistanceFeet:5},"rival-player":{teeClub:"Secret club"}}};
  const local=scorecard.historyGolfDetail(r)!;assert.equal(local.card.scorecard![0].teeClub,"PW");
  const social=safeSocialRoundCard({id:"cloud",local_round_id:r.id,snapshot:r},"owner",true)!;assert.equal(social.scorecard![0].outOfBounds,true);assert.doesNotMatch(JSON.stringify(social),/Secret club|notes|latitude|longitude/);
  const before=JSON.stringify(r);assert.equal(displayDistanceFromStoredYards(100,"meters"),"91 m");assert.equal(displayDistanceFromStoredYards(100,"yards"),"100 yd");assert.equal(JSON.stringify(r),before);
});
test("equipment uses the product photo first and a stored monochrome category reference when absent",()=>{
  const h=socialUI("app/components/golf-equipment-media.tsx"), item={category:"Putter",brand:"QA brand",model:"QA model",imageUrl:"/real-product.png"};
  let tree=h.render("GolfEquipmentMedia",{item});assert.equal(tree.props["data-equipment-media"],"product");assert.equal(uiNodes(tree).find(n=>n.props.src)?.props.src,"/real-product.png");
  tree=h.render("GolfEquipmentMedia",{item:{...item,imageUrl:undefined},large:true});assert.equal(tree.props["data-equipment-media"],"category");const image=uiNodes(tree).find(n=>n.props.src)!;assert.ok(existsSync("public"+image.props.src));assert.match(image.props.alt,/Referencia de categoría/);assert.doesNotMatch(uiText(tree),/🎨|⛳|🏌/);
  tree=h.render("GolfEquipmentMedia",{item:{...item,imageUrl:undefined,category:"Bolsa"}});assert.equal(uiNodes(tree).some(n=>n.props.src),false);assert.match(uiNodes(tree).find(n=>n.props["aria-label"])!.props["aria-label"],/Sin fotografía/);
});
test("scorecard shows only captured accuracy and penalty facts while retaining a dedicated hole destination",()=>{
  const h=socialUI("app/components/premium-scorecard.tsx",{"golf-scorecard-presentation":scorecard});let hole=0;
  const tree=h.render("PremiumScorecard",{holes:[{hole:1,par:4,score:3,putts:1,fairwayHit:false,greenInRegulation:true,penaltyStrokes:0},{hole:2,par:4,score:7}],onHole:(n:number)=>hole=n});
  assert.match(uiText(tree),/FIR × No GIR ● Sí Penalidades 0/);uiFind(tree,n=>n.props["aria-label"]==="Abrir hoyo 2 · Doble bogey o más").props.onClick();assert.equal(hole,2);
});
test("saved GHIN history uses a separate flexible course layout from latest-20 numbered rows",()=>{
  const css=readFileSync("app/components/ghin-import-history.module.css","utf8"),component=readFileSync("app/components/ghin-import-history.tsx","utf8");
  assert.match(css,/\.backyardCard\s*\{[^}]*minmax\(0, 1fr\)/);assert.match(component,/className=\{importedStyles.backyardCard\}/);assert.doesNotMatch(component,/className=\{styles.row\}/);
});

test("shared rounds open a summary and retain review controls behind their own participation view",()=>{
  const detail={card:{date:"2026-09-04",courseName:"Actual course",teeName:null,holesPlayed:1,coursePar:4,ownerScore:3,scorecard:[{hole:1,par:4,score:3,putts:1}]},playerName:"Actual participant",shots:[]};
  const h=socialUI("app/components/golf-round-detail.tsx",{"golf-object-data":{useRoundObject:()=>({detail,activity:null,loading:false,failed:false,retry:()=>{},context:{accessToken:"local-test-only"}})},"golf-detail-ui":{golfDate:(value:string)=>value},"golf-scorecard-presentation":scorecard});
  const props={object:{kind:"round",id:"existing-round",source:"shared"},onStats:()=>{},onManage:()=>{},onRules:()=>{}};
  let tree=h.render("GolfRoundDetailView",props);assert.match(uiText(tree),/Resumen Tarjeta Participación/);assert.equal(uiNodes(tree).some(n=>n.type==="RoundParticipationCard"),false);
  uiFind(tree,n=>n.type==="button"&&uiText(n)==="Participación").props.onClick();tree=h.render("GolfRoundDetailView",props);assert.equal(uiNodes(tree).some(n=>n.type==="RoundParticipationCard"),true);
  uiFind(tree,n=>n.type==="button"&&uiText(n)==="Tarjeta").props.onClick();tree=h.render("GolfRoundDetailView",props);assert.equal(uiNodes(tree).some(n=>n.type==="RoundParticipationCard"),false);assert.equal(uiNodes(tree).find(n=>n.type==="PremiumScorecard")?.props.holes,detail.card.scorecard);
});
