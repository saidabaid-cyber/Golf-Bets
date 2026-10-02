import assert from "node:assert/strict";
import test from "node:test";
import { adminModeDatabaseIsolated, applicationRole, simpleAdminModules } from "../lib/admin-mode";
import { membershipAllows, type AdminMembership } from "../lib/admin-control-center";

const admin: AdminMembership = { userId: "a", role: "ADMIN", scopeType: "GLOBAL", scopeId: null, active: true };
test("PLAYER has no administrative permissions and inactive memberships revoke immediately", () => {
  assert.equal(applicationRole([]), "PLAYER");
  assert.deepEqual(simpleAdminModules([]), []);
  assert.equal(applicationRole([{ ...admin, active: false }]), "PLAYER");
});
test("ADMIN has daily modules but cannot audit, import or administer administrators", () => {
  assert.equal(applicationRole([admin]), "ADMIN");
  assert.deepEqual(simpleAdminModules([admin]), ["courses", "equipment", "balls", "bets", "competitions", "requests", "users", "content"]);
  assert.equal(membershipAllows(admin, { entityType: "IMPORT", scopeType: "GLOBAL", scopeId: null }, "PUBLISH"), false);
  assert.equal(membershipAllows(admin, { entityType: "BALL", scopeType: "GLOBAL", scopeId: null }, "AUDIT"), false);
});
test("SUPER_ADMIN requires an actual global persisted grant", () => {
  assert.equal(applicationRole([{ ...admin, role: "SUPER_ADMIN" }]), "SUPER_ADMIN");
  assert.ok(simpleAdminModules([{ ...admin, role: "SUPER_ADMIN" }]).includes("administrators"));
  assert.equal(membershipAllows({...admin,role:"SUPER_ADMIN",scopeId:"forged"},{entityType:"BALL",scopeType:"GLOBAL",scopeId:null},"PUBLISH"),false);
});
test("scoped legacy administrators retain their permitted domains", () => {
  const member: AdminMembership = { ...admin, role: "COURSE_ADMIN", scopeType: "COURSE", scopeId: "course-a" };
  assert.deepEqual(simpleAdminModules([member]), ["courses", "users"]);
  assert.equal(membershipAllows(member, { entityType: "COURSE", scopeType: "COURSE", scopeId: "course-b" }, "PUBLISH"), false);
  assert.equal(membershipAllows(member,{entityType:"IMPORT",scopeType:"COURSE",scopeId:"course-a"},"CREATE_DRAFT"),false);
  assert.equal(membershipAllows(member,{entityType:"COURSE",scopeType:"COURSE",scopeId:"course-a"},"AUDIT"),false);
});
test("a feature Preview must prove a distinct DB; frozen DEV, Production and forged URLs fail closed", () => {
  const env = { ADMIN_MODE_V2_ENABLED: "true", ADMIN_MODE_ISOLATED_DB_REF: "abcdefghijklmnopqrst", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature/admin-mode-v2" };
  assert.equal(adminModeDatabaseIsolated(env), true);
  for (const ref of ["bymeopxkxapfizeeqeyb", "zhqmlpljloumldaczcfp"]) assert.equal(adminModeDatabaseIsolated({ ...env, ADMIN_MODE_ISOLATED_DB_REF: ref, NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co` }), false);
  assert.equal(adminModeDatabaseIsolated({ ...env, VERCEL_ENV: "production" }), false);
  assert.equal(adminModeDatabaseIsolated({ ...env, VERCEL_GIT_COMMIT_REF: "integration/backyard-current" }), false);
  assert.equal(adminModeDatabaseIsolated({ ...env, NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co.evil.invalid" }), false);
  assert.equal(adminModeDatabaseIsolated({ ...env, NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co/?redirect=evil" }), false);
});
