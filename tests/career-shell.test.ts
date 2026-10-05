import assert from "node:assert/strict";
import test from "node:test";
import { CAREER_TABS, careerViewFromSearch } from "../lib/career-navigation";
import { BOTTOM_NAV_TARGETS, screenFromSearch, screenHref } from "../lib/app-navigation";
test("Carrera has exactly five ordered Spanish sections", () => assert.deepEqual(CAREER_TABS.map(t=>t.label),["Resumen","Logros","Rivalidades","Rondas","Torneos"]));
for(const tab of CAREER_TABS) test(`direct reload and navigation: ${tab.label}`, () => {
  const href=screenHref("career","?unrelated=kept",null,tab.id);
  assert.equal(screenFromSearch(href.slice(1)),"career"); assert.equal(careerViewFromSearch(href.slice(1)),tab.id);
  assert.match(href,/unrelated=kept/); assert.doesNotMatch(screenHref("play",href.slice(1)),/career=/);
});
test("bad career selection defaults to summary; existing global routes survive",()=>{
  assert.equal(careerViewFromSearch("?career=unknown"),"summary"); assert.equal(screenFromSearch("?screen=friends"),"friends");
  assert.deepEqual(BOTTOM_NAV_TARGETS,{Inicio:"welcome",Carrera:"career",Play:"play","My Coach":"coach",Reglas:"rules"});
  for(const route of ["welcome","play","profile","social","historyDetail"] as const) assert.equal(screenFromSearch(screenHref(route).slice(1)),route);
});
