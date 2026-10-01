import test from "node:test";
import assert from "node:assert/strict";
import {humanChanges,preserveVerificationTime} from "../lib/admin-simple-catalog";
test("course preview ignores stale form aliases without mutating stored evidence",()=>{const before={course:{id:"course",name:"Campo"},club:{address:"Before"},address:"Stale"};const after={course:{id:"course",name:"Campo"},club:{address:"After"}};const snapshot=JSON.stringify(before);const changes=humanChanges(before,after);assert.deepEqual(changes,[{label:"Club · Dirección",before:"Before",after:"After"}]);assert.equal(JSON.stringify(before),snapshot);});
test("unchanged verification day preserves the original timestamp",()=>{const previous="2026-10-01T14:15:51.525Z";assert.equal(preserveVerificationTime(previous,"2026-10-01"),previous);assert.equal(preserveVerificationTime(previous,"2026-10-02"),"2026-10-02");});
