import assert from "node:assert/strict";
import test from "node:test";

import { createGhinHandicapProvider } from "../features/handicap/providers";
import type { NormalizedGhinGolfer } from "../lib/ghin/core";

function golfer(overrides: Partial<NormalizedGhinGolfer> = {}): NormalizedGhinGolfer {
  return {
    ghinNumber: "11103349",
    externalPlayerId: "88",
    name: "Said Abaid Taja",
    firstName: "Said",
    lastName: "Abaid Taja",
    clubName: "La Vista Country Club",
    associationName: null,
    handicapIndex: 7.2,
    status: "active",
    rawStatus: "Active",
    isActive: true,
    updatedAt: "2026-09-24T12:00:00.000Z",
    ...overrides,
  };
}

test("adapta el índice oficial sin aplicarle el cap del handicap manual", async () => {
  const provider = createGhinHandicapProvider({
    async lookupGolfer() {
      return { data: golfer({ handicapIndex: 41.7 }), endpoint: "/golfers.json", httpStatus: 200, fetchedAt: "2026-09-24T12:00:00.000Z" };
    },
  }, { enabled: true });

  const result = await provider.getCurrent({ userId: "user-1", externalPlayerId: "11103349" });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.value, 41.7);
    assert.equal(result.data.classification, "official");
  }
  assert.equal(provider.capabilities.authorized_write, false);
  assert.equal(provider.capabilities.account_link, false);
});

test("NH/null nunca se transforma a cero", async () => {
  const provider = createGhinHandicapProvider({
    async lookupGolfer() {
      return { data: golfer({ handicapIndex: null }), endpoint: "/golfers.json", httpStatus: 200, fetchedAt: "2026-09-24T12:00:00.000Z" };
    },
  }, { enabled: true });

  const result = await provider.getCurrent({ userId: "user-1", externalPlayerId: "11103349" });

  assert.deepEqual(result, {
    ok: false,
    code: "not_found",
    message: "GHIN no reportó un handicap activo.",
    providerId: "ghin-read-only",
  });
});

test("rechaza una identidad GHIN distinta a la solicitada", async () => {
  const provider = createGhinHandicapProvider({
    async lookupGolfer() {
      return { data: golfer({ ghinNumber: "99999999" }), endpoint: "/golfers/search.json", httpStatus: 200, fetchedAt: "2026-09-24T12:00:00.000Z" };
    },
  }, { enabled: true });

  assert.deepEqual(await provider.getCurrent({ userId: "user-1", externalPlayerId: "11103349" }), {
    ok: false,
    code: "invalid_response",
    message: "GHIN devolvió una identidad distinta.",
    providerId: "ghin-read-only",
  });
});

test("permanece fail-closed y sanitiza errores de autorización", async () => {
  const disabled = createGhinHandicapProvider({
    async lookupGolfer() {
      throw new Error("should not run");
    },
  }, { enabled: false, allowAccountLink: true });
  assert.equal(disabled.capabilities.current_index, false);
  assert.equal(disabled.capabilities.account_link, false);
  assert.equal((await disabled.getCurrent({ userId: "u", externalPlayerId: "11103349" })).ok, false);

  const unauthorized = createGhinHandicapProvider({
    async lookupGolfer() {
      throw Object.assign(new Error("private remote detail"), { code: "unauthorized" });
    },
  }, { enabled: true });
  assert.deepEqual(await unauthorized.getCurrent({ userId: "u", externalPlayerId: "11103349" }), {
    ok: false,
    code: "not_authorized",
    message: "GHIN no autorizó la consulta.",
    providerId: "ghin-read-only",
  });
});
