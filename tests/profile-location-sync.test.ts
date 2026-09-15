import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseStoredProfileLocation,
  readProfileLocationMetadata,
  saveProfileLocationMetadata,
} from "../lib/profile-location-sync";

const firstAt = "2026-09-15T12:00:00.000Z";
const secondAt = "2026-09-15T12:01:00.000Z";
const puebla = { countryCode: "MX", country: "México", stateCode: "MX-PUE", state: "Puebla" };
const jalisco = { countryCode: "MX", country: "México", stateCode: "MX-JAL", state: "Jalisco" };

function fakeAuthClient(options: {
  ownerId?: string;
  metadata?: Record<string, unknown>;
  getError?: Error;
  updateError?: Error;
  updateOwnerId?: string;
  updateMetadata?: Record<string, unknown>;
} = {}) {
  const ownerId = options.ownerId ?? "owner-a";
  let metadata = { ...(options.metadata ?? {}) };
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    auth: {
      getUser: async () => options.getError
        ? { data: { user: null }, error: options.getError }
        : { data: { user: { id: ownerId, user_metadata: metadata } }, error: null },
      updateUser: async (attributes: { data: Record<string, unknown> }) => {
        calls.push(attributes.data);
        if (options.updateError) return { data: { user: null }, error: options.updateError };
        metadata = { ...metadata, ...attributes.data };
        return {
          data: { user: { id: options.updateOwnerId ?? ownerId, user_metadata: options.updateMetadata ?? metadata } },
          error: null,
        };
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls, metadata: () => metadata };
}

test("metadata de ubicación valida códigos y normaliza nombres sin almacenar imagen", () => {
  assert.deepEqual(parseStoredProfileLocation({ ...puebla, country: "mexico", state: "puebla", version: 1, updatedAt: firstAt }), {
    ...puebla, version: 1, updatedAt: firstAt,
  });
  assert.deepEqual(parseStoredProfileLocation({ countryCode: "", country: "", stateCode: "", state: "", version: 1, updatedAt: firstAt }), {
    countryCode: "", country: "", stateCode: "", state: "", version: 1, updatedAt: firstAt,
  });
  assert.equal(parseStoredProfileLocation({ ...puebla, countryCode: "ZZ", version: 1, updatedAt: firstAt }), null);
  assert.equal(parseStoredProfileLocation({ ...puebla, stateCode: "MX-INVALID", version: 1, updatedAt: firstAt }), null);
  assert.equal(parseStoredProfileLocation({ ...puebla, version: 2, updatedAt: firstAt }), null);
  assert.equal(parseStoredProfileLocation({ ...puebla, version: 1, updatedAt: "2026-02-31T12:00:00.000Z" }), null);
  assert.equal(parseStoredProfileLocation({ ...puebla, state: "data:image/png;base64,aGVsbG8=", version: 1, updatedAt: firstAt }), null);
});

test("lectura usa getUser autenticado, verifica propietario y falla cerrado ante error", async () => {
  const stored = { ...puebla, updatedAt: firstAt, version: 1 };
  const { client } = fakeAuthClient({ metadata: { backyard_profile_location: stored } });
  assert.deepEqual(await readProfileLocationMetadata(client, "owner-a"), stored);
  await assert.rejects(() => readProfileLocationMetadata(client, "other-user"), (error: unknown) => (error as { code?: string }).code === "PROFILE_OWNER_MISMATCH");
  const errorClient = fakeAuthClient({ getError: new Error("offline") }).client;
  await assert.rejects(() => readProfileLocationMetadata(errorClient, "owner-a"), /offline/);
});

test("escritura guarda sólo ubicación pequeña y confirma respuesta del mismo propietario", async () => {
  const { client, calls, metadata } = fakeAuthClient({ metadata: { username: "said" } });
  const saved = await saveProfileLocationMetadata(client, "owner-a", puebla, firstAt);
  assert.deepEqual(saved, { ...puebla, version: 1, updatedAt: firstAt });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { backyard_profile_location: saved });
  assert.deepEqual(metadata(), { username: "said", backyard_profile_location: saved });
  assert.doesNotMatch(JSON.stringify(calls), /avatar|data:image/i);
});

test("remote más nuevo o mismo timestamp distinto no se sobrescribe; retry idéntico es idempotente", async () => {
  const newer = { ...jalisco, updatedAt: secondAt, version: 1 };
  const newerClient = fakeAuthClient({ metadata: { backyard_profile_location: newer } });
  await assert.rejects(() => saveProfileLocationMetadata(newerClient.client, "owner-a", puebla, firstAt), (error: unknown) => (error as { code?: string }).code === "CLOUD_FIELD_CONFLICT");
  assert.equal(newerClient.calls.length, 0);
  const malformedNewer = fakeAuthClient({ metadata: { backyard_profile_location: { ...newer, countryCode: "ZZ" } } });
  await assert.rejects(() => saveProfileLocationMetadata(malformedNewer.client, "owner-a", puebla, firstAt), (error: unknown) => (error as { code?: string }).code === "CLOUD_FIELD_CONFLICT");
  assert.equal(malformedNewer.calls.length, 0);

  const sameAt = { ...jalisco, updatedAt: firstAt, version: 1 };
  const tiedClient = fakeAuthClient({ metadata: { backyard_profile_location: sameAt } });
  await assert.rejects(() => saveProfileLocationMetadata(tiedClient.client, "owner-a", puebla, firstAt), (error: unknown) => (error as { code?: string }).code === "CLOUD_FIELD_CONFLICT");
  assert.equal(tiedClient.calls.length, 0);
  assert.deepEqual(await saveProfileLocationMetadata(tiedClient.client, "owner-a", jalisco, firstAt), sameAt);
  assert.equal(tiedClient.calls.length, 0);
});

test("sin ownership o sin confirmación Auth la ubicación queda pendiente", async () => {
  const wrongOwner = fakeAuthClient({ ownerId: "someone-else" });
  await assert.rejects(() => saveProfileLocationMetadata(wrongOwner.client, "owner-a", puebla, firstAt), (error: unknown) => (error as { code?: string }).code === "PROFILE_OWNER_MISMATCH");
  assert.equal(wrongOwner.calls.length, 0);

  const wrongResponse = fakeAuthClient({ updateOwnerId: "someone-else" });
  await assert.rejects(() => saveProfileLocationMetadata(wrongResponse.client, "owner-a", puebla, firstAt), (error: unknown) => (error as { code?: string }).code === "PROFILE_OWNER_MISMATCH");

  const staleResponse = fakeAuthClient({ updateMetadata: {} });
  await assert.rejects(() => saveProfileLocationMetadata(staleResponse.client, "owner-a", puebla, firstAt), (error: unknown) => (error as { code?: string }).code === "PROFILE_LOCATION_UNVERIFIED");

  const failedWrite = fakeAuthClient({ updateError: new Error("Auth unavailable") });
  await assert.rejects(() => saveProfileLocationMetadata(failedWrite.client, "owner-a", puebla, firstAt), /Auth unavailable/);
});
