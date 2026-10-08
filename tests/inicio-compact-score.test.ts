import assert from "node:assert/strict";
import test from "node:test";
import { socialUI, uiFind, uiText, uiNodes } from "./helpers/social-ui";
import * as navigation from "../lib/home-social-navigation";

for (const [toPar, expected] of [[-2,"under"],[0,"even"],[12,"over"],[undefined,"unknown"]] as const) test(`Feed expresses ${expected} result without inventing metrics`,()=>{
  const h=socialUI("app/components/cloud-social-activity.tsx");
  const tree=h.render("ScoreSummary",{round:{ownerScore:72,toPar,putts:0,girPct:0}});
  assert.equal(tree.props["data-result"],expected);
  assert.match(uiText(tree),/Score 72/); assert.match(uiText(tree),/Putts 0 GIR 0/);
  assert.doesNotMatch(uiText(tree),/FIR/);
  assert.equal(uiNodes(tree).filter(n=>n.props["aria-label"]?.endsWith("contra par")).length,toPar===undefined?0:1);
});
test("Friends view keeps live round outside the social list",()=>{
  const h=socialUI("app/components/home-dashboard.tsx",{"home-social-navigation":navigation});
  const props={identityUserId:"owner",displayName:"Owner",onContinueRound(){},activeRound:{status:"live",courseName:"Real",currentHole:2,totalHoles:18}};
  let tree=h.render("HomeDashboard",props);
  assert.doesNotMatch(uiText(tree),/Continuar ronda/);
  uiFind(tree,n=>n.type==="button"&&uiText(n)==="Amigos").props.onClick();
  tree=h.render("HomeDashboard",props);assert.doesNotMatch(uiText(tree),/Continuar ronda/);
});
