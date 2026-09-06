import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EquipmentSyncError,
  chooseEquipmentProfile,
  downloadEquipmentProfile,
  uploadEquipmentProfile,
  type EquipmentCloudRecord,
} from "../lib/equipment-sync";
import { isExplicitFeatureEnabled } from "../lib/feature-flags";
import { createEmptyEquipmentProfile, type EquipmentProfile } from "../lib/golf-equipment";

const USER_ID = "user-equipment-sync";
const OTHER_USER_ID = "other-equipment-sync";
const CREATED_AT = "2026-09-06T12:00:00.000Z";
const MUTATION_ID = "f84a6598-9f3c-4a3f-8f74-c0b9c702f928";

function profile(userId = USER_ID, updatedAt = CREATED_AT): EquipmentProfile {
  const value = createEmptyEquipmentProfile(userId, updatedAt);
  assert.ok(value);
  return value;
}

function cloudRecord(value: EquipmentProfile, version = 1): EquipmentCloudRecord {
  return {
    profile: value,
    version,
    lastMutationId: MUTATION_ID,
    updatedAt: value.updatedAt,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("la nube de equipo falla cerrada salvo activación explícita", () => {
  for (const value of [undefined, "", "0", "false", "off", "no", "enabled", "beta", "banana"]) {
    assert.equal(isExplicitFeatureEnabled(value), false, String(value));
  }

  for (const value of ["1", "true", "TRUE", " on ", "yes"]) {
    assert.equal(isExplicitFeatureEnabled(value), true, value);
  }

  const flags = readFileSync("lib/feature-flags.ts", "utf8");
  assert.match(
    flags,
    /equipmentCloudServerEnabled\s*=\s*isExplicitFeatureEnabled\(process\.env\.EQUIPMENT_CLOUD_ENABLED\)/,
  );
});

test("download exige token e identidad antes de tocar la red", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return jsonResponse({ data: null });
  };

  await assert.rejects(
    () => downloadEquipmentProfile("   ", USER_ID, fetcher),
    (error: unknown) => error instanceof EquipmentSyncError
      && error.status === 401
      && error.code === "AUTH_REQUIRED",
  );
  await assert.rejects(
    () => downloadEquipmentProfile("token", "   ", fetcher),
    (error: unknown) => error instanceof EquipmentSyncError
      && error.status === 400
      && error.code === "INVALID_EQUIPMENT_USER",
  );
  assert.equal(calls, 0);
});

test("download usa Bearer, no-store y rechaza perfiles de otra cuenta", async () => {
  let input = "";
  let init: RequestInit | undefined;
  const expected = cloudRecord(profile());
  const fetcher = async (nextInput: string, nextInit?: RequestInit) => {
    input = nextInput;
    init = nextInit;
    return jsonResponse({ data: expected });
  };

  assert.deepEqual(await downloadEquipmentProfile(" access-token ", USER_ID, fetcher), expected);
  assert.equal(input, "/api/equipment");
  assert.deepEqual(init?.headers, { authorization: "Bearer access-token" });
  assert.equal(init?.cache, "no-store");

  await assert.rejects(
    () => downloadEquipmentProfile("access-token", OTHER_USER_ID, async () => jsonResponse({ data: expected })),
    (error: unknown) => error instanceof EquipmentSyncError
      && error.status === 502
      && error.code === "INVALID_EQUIPMENT_RESPONSE",
  );
});

test("upload valida localmente y envía el contrato CAS sin campos de autoridad separados", async () => {
  let calls = 0;
  const requests: Array<{ body: Record<string, unknown>; headers: HeadersInit | undefined }> = [];
  const local = profile();
  const saved = cloudRecord(local, 2);
  const fetcher = async (_input: string, init?: RequestInit) => {
    calls += 1;
    requests.push({
      headers: init?.headers,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return jsonResponse({ data: saved });
  };

  const result = await uploadEquipmentProfile(local, "token", {
    expectedVersion: 1,
    mutationId: MUTATION_ID,
    deviceId: "iphone-device",
  }, fetcher);

  assert.deepEqual(result, saved);
  assert.equal(calls, 1);
  const request = requests[0];
  assert.deepEqual(request.headers, { authorization: "Bearer token", "content-type": "application/json" });
  assert.equal(request.body.expectedVersion, 1);
  assert.equal(request.body.mutationId, MUTATION_ID);
  assert.equal(request.body.deviceId, "iphone-device");
  assert.equal((request.body.profile as EquipmentProfile).userId, USER_ID);
  assert.equal("userId" in request.body, false, "la autoridad se deriva de auth, no de otro campo manipulable");

  await assert.rejects(
    () => uploadEquipmentProfile({ ...local, updatedAt: "not-a-date" }, "token", {
      expectedVersion: 1,
      mutationId: MUTATION_ID,
    }, fetcher),
    (error: unknown) => error instanceof EquipmentSyncError
      && error.status === 400
      && error.code === "INVALID_EQUIPMENT_PROFILE",
  );
  assert.equal(calls, 1, "un perfil local inválido no llega a la API");
});

test("upload conserva 409/CAS y solo acepta el conflicto de la misma cuenta", async () => {
  const local = profile();
  const remote = cloudRecord(profile(USER_ID, "2026-09-06T12:05:00.000Z"), 4);
  await assert.rejects(
    () => uploadEquipmentProfile(local, "token", {
      expectedVersion: 3,
      mutationId: MUTATION_ID,
    }, async () => jsonResponse({
      error: "Otro dispositivo cambió tu equipo.",
      code: "EQUIPMENT_VERSION_CONFLICT",
      conflict: remote,
    }, 409)),
    (error: unknown) => {
      assert.ok(error instanceof EquipmentSyncError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "EQUIPMENT_VERSION_CONFLICT");
      assert.deepEqual(error.remote, remote);
      return true;
    },
  );

  const foreign = cloudRecord(profile(OTHER_USER_ID, "2026-09-06T12:06:00.000Z"), 5);
  await assert.rejects(
    () => uploadEquipmentProfile(local, "token", {
      expectedVersion: 3,
      mutationId: MUTATION_ID,
    }, async () => jsonResponse({ code: "EQUIPMENT_VERSION_CONFLICT", conflict: foreign }, 409)),
    (error: unknown) => error instanceof EquipmentSyncError
      && error.status === 409
      && error.remote === null,
  );
});

test("la decisión de merge nunca resuelve silenciosamente empates divergentes", () => {
  const base = profile();
  assert.equal(chooseEquipmentProfile(null, null), "equal");
  assert.equal(chooseEquipmentProfile(base, null), "local");
  assert.equal(chooseEquipmentProfile(null, cloudRecord(base)), "remote");
  assert.equal(chooseEquipmentProfile(base, cloudRecord(structuredClone(base))), "equal");

  const newerLocal = { ...base, updatedAt: "2026-09-06T12:02:00.000Z" };
  const newerRemote = cloudRecord({ ...base, updatedAt: "2026-09-06T12:03:00.000Z" }, 2);
  assert.equal(chooseEquipmentProfile(newerLocal, cloudRecord(base)), "conflict");
  assert.equal(chooseEquipmentProfile(base, newerRemote), "conflict");
  assert.equal(
    chooseEquipmentProfile({ ...base, ballPreference: "SKIPPED" }, cloudRecord(base)),
    "conflict",
  );
});

test("la ruta deriva identidad del token, limita payload y no expone errores internos", () => {
  const route = readFileSync("app/api/equipment/route.ts", "utf8");
  const accountStart = route.indexOf("async function account");
  const featureGate = route.indexOf("!equipmentCloudServerEnabled", accountStart);
  const tokenRead = route.indexOf("const token = bearer(request)", accountStart);
  const userLookup = route.indexOf("supabase.auth.getUser(token)", accountStart);
  assert.ok(accountStart >= 0 && featureGate > accountStart && tokenRead > featureGate && userLookup > tokenRead);

  assert.match(route, /getSupabaseForUser\(token\)/);
  assert.match(route, /getSupabaseAdmin\("cloud"\)/);
  assert.doesNotMatch(route, /SERVICE_ROLE|SECRET_KEY|process\.env/);
  assert.match(route, /normalizeEquipmentProfileStrict\(body\.profile, authenticated\.userId\)/);
  assert.match(route, /readJsonBody\(request\)/);
  assert.match(route, /\.eq\("user_id", authenticated\.userId\)/);
  assert.match(route, /user_id:\s*authenticated\.userId/);
  assert.doesNotMatch(route, /body\.userId|profile\.userId\s*===\s*authenticated/);
  assert.match(route, /MAX_BODY_BYTES\s*=\s*1_000_000/);
  assert.match(route, /UUID\.test\(body\.mutationId\)/);
  assert.match(route, /cache-control":\s*"private, no-store"/);
  assert.doesNotMatch(route, /export async function DELETE/);

  const safeErrorStart = route.indexOf("function safeDbError");
  const loggerStart = route.indexOf("function logFailure", safeErrorStart);
  const safeError = route.slice(safeErrorStart, loggerStart);
  assert.match(safeError, /value\.code === "23505"/);
  assert.match(safeError, /EQUIPMENT_VERSION_CONFLICT/);
  assert.match(safeError, /EQUIPMENT_PERMISSION_DENIED/);
  assert.doesNotMatch(safeError, /return\s+\{[^}]*[\s\S]*message:\s*value\.message/);
});

test("la migración exige CAS, RLS propietario y no concede borrado ni service-role al cliente", () => {
  const sql = readFileSync("supabase/migrations/20260906193435_equipment_ball_fitting.sql", "utf8");

  assert.match(sql, /create table public\.player_equipment_profiles[\s\S]*?user_id uuid primary key references auth\.users\(id\)/);
  assert.match(sql, /create or replace function public\.enforce_player_equipment_profile_cas\(\)/);
  assert.match(sql, /new\.expected_version is null or new\.expected_version <> old\.version/);
  assert.match(sql, /errcode = '40001',[\s\S]*?message = 'equipment_profile_version_conflict'/);
  assert.match(sql, /new\.last_mutation_id = old\.last_mutation_id/);
  assert.match(sql, /message = 'equipment_profile_mutation_id_reused'/);
  assert.match(sql, /new\.user_id := old\.user_id/);
  assert.match(sql, /create trigger player_equipment_profiles_cas/);

  assert.match(sql, /alter table public\.player_equipment_profiles enable row level security/);
  assert.match(sql, /create policy player_equipment_profiles_owner_read[\s\S]*?user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /create policy player_equipment_profiles_owner_insert[\s\S]*?with check \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(sql, /create policy player_equipment_profiles_owner_update[\s\S]*?using \(user_id = \(select auth\.uid\(\)\)\)[\s\S]*?with check \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.doesNotMatch(sql, /->\s*'user_metadata'/);
  assert.match(sql, /->\s*'app_metadata'\s*->>\s*'role'/);
  assert.match(sql, /revoke all on table[\s\S]*from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*to authenticated/i);
  assert.match(sql, /grant select, insert, update on table[\s\S]*to service_role;/);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*to service_role/i);
  assert.doesNotMatch(sql, /create policy[^;]+for delete/i);
  assert.doesNotMatch(sql, /security\s+definer/i);
});
