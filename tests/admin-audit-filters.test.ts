import test from "node:test";
import assert from "node:assert/strict";
import {auditFilters} from "../lib/admin-audit-filters";
test("audit filters use bounded pages and inclusive dates without raw SQL",()=>{const filters=auditFilters(new URLSearchParams({from:"2026-10-01",until:"2026-10-01",entity:"COURSE",action:"PUBLISH",offset:"40"}));assert.equal(filters.until,"2026-10-02T00:00:00.000Z");assert.equal(filters.offset,40);for(const value of ["2026-02-30","invalid"]){assert.throws(()=>auditFilters(new URLSearchParams({from:value})));}assert.throws(()=>auditFilters(new URLSearchParams({offset:"1.5"})));assert.throws(()=>auditFilters(new URLSearchParams({action:"%;delete"})));});
