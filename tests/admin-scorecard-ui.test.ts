import test from "node:test";
import assert from "node:assert/strict";
import {scorecardHolePatch,scorecardYards} from "../lib/admin-scorecard-ui";
test("editing one hole retains historical IDs and unrelated scorecard changes",()=>{
 const values={tees:[{id:"blue"}],holes:[{id:"h1",par:4,strokeIndex:7},{id:"h2",par:3,strokeIndex:9}],yardages:[{teeIndex:0,holeIndex:1,yards:180}],teeHoleYardages:[{teeId:"blue",holeId:"h1",yards:410}]};
 assert.equal(scorecardYards(values,0,0),410);
 const changed=scorecardHolePatch(values,0,{par:"5",hcp:"8",yards:["430"]});
 assert.equal(changed.holes[0].id,"h1");assert.equal(changed.holes[1],values.holes[1]);assert.equal(values.holes[0].par,4);
 assert.deepEqual(changed.yardages,[values.yardages[0],{teeIndex:0,holeIndex:0,yards:"430"}]);
 assert.equal(scorecardYards({...values,...changed},0,0),"430");
});
test("blank yardages remain unknown and stale hole selection cannot patch another hole",()=>{
 const values={holes:[{id:"h1"}],tees:[{id:"blue"}]};assert.equal(scorecardYards(values,0,0),"");
 assert.throws(()=>scorecardHolePatch(values,18,{par:"4",hcp:"8",yards:["400"]}));
});
