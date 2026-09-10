import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { usernameFromEmail } from "../lib/account-state";
import { BET_REGISTRY, betAiAliasCatalog } from "../lib/bets/registry";
import { captureRequirementsForPlayer } from "../lib/bets/capture-requirements";
import { createInternalEquipmentCatalogProvider } from "../lib/equipment-catalog-provider";
import { golfBallCatalog, golfClubCatalog, golfShaftCatalog } from "../lib/golf-equipment-catalog";
import { normalizeLaunchMonitorVisionExtraction } from "../lib/backyard-ai/schemas/launch-monitor";
import { prepareLaunchMonitorPhotos } from "../lib/backyard-ai/launch-monitor/client";
import { initialBets } from "../lib/new-round-bets";
import { squareCropRect } from "../lib/profile-image";
import { buildPlayerRoundStats } from "../lib/round-statistics";

test("perfil genera username sin llenar nombre y recorta fotos al centro", () => {
  assert.equal(usernameFromEmail("said_aba@hotmail.com"), "said_aba");
  assert.equal(usernameFromEmail("Juan Pérez+Golf@gmail.com"), "juan_perez_golf");
  assert.equal(usernameFromEmail("said_aba@hotmail.com", ["SAID_ABA", "said_aba_2"]), "said_aba_3");
  assert.deepEqual(squareCropRect(4032, 3024), { sourceX: 504, sourceY: 0, sourceSize: 3024 });
  assert.deepEqual(squareCropRect(3024, 4032), { sourceX: 0, sourceY: 504, sourceSize: 3024 });
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(provider, /displayName: ""/);
  assert.doesNotMatch(provider, /displayName:.*usernameFromEmail/);
});

test("registro de apuestas tiene IDs, historia, adaptador y aliases canónicos únicos", () => {
  assert.equal(new Set(BET_REGISTRY.map((bet) => bet.id)).size, BET_REGISTRY.length);
  for (const bet of BET_REGISTRY) {
    assert.ok(bet.id && bet.label && bet.icon && bet.engineAdapter && bet.resultPresenter);
    assert.equal(bet.captureRequirements.requiresScore, true);
    assert.ok(bet.historyVersion >= 1);
    assert.ok(bet.aiAliases.length > 0);
  }
  const aliases = new Map<string, Set<string>>();
  for (const entry of betAiAliasCatalog()) {
    const key = entry.alias.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const owners = aliases.get(key) || new Set<string>();
    owners.add(entry.betId);
    aliases.set(key, owners);
  }
  assert.ok([...aliases.values()].every((owners) => owners.size === 1), "un alias no puede activar dos apuestas distintas");
  for (const id of ["rabbits", "skins", "units", "foursome", "ball_friend", "vipers", "camels", "fish", "loba", "personals"]) {
    assert.ok(BET_REGISTRY.some((bet) => bet.id === id), `Falta ${id}`);
  }
});

test("capture requirements sólo obliga score y putts cuando la apuesta los consume", () => {
  const bets = initialBets(["said"]);
  assert.deepEqual(captureRequirementsForPlayer({ playerId: "said", playedHoleIndex: 0, bets, supplementalBets: [] }), { required: ["score"], optional: [] });
  bets.camels.enabled = true; bets.camels.participantIds = ["said"];
  bets.fish.enabled = true; bets.fish.participantIds = ["said"];
  const optional = captureRequirementsForPlayer({ playerId: "said", playedHoleIndex: 0, bets, supplementalBets: [] });
  assert.deepEqual(optional.required, ["score"]);
  assert.deepEqual(new Set(optional.optional), new Set(["green_side_bunker", "fairway_bunker", "penalty_area"]));
  bets.vipers.enabled = true; bets.vipers.participantIds = ["said"];
  assert.ok(captureRequirementsForPlayer({ playerId: "said", playedHoleIndex: 0, bets, supplementalBets: [] }).required.includes("putts"));
});

test("proveedor interno devuelve modelos reales por categoría, marca y varilla", async () => {
  const provider = createInternalEquipmentCatalogProvider({ balls: golfBallCatalog, clubs: golfClubCatalog, shafts: golfShaftCatalog });
  for (const [kind, query, category] of [
    ["CLUB", "TaylorMade", "DRIVER"], ["CLUB", "Titleist", "DRIVER"], ["CLUB", "Callaway", "DRIVER"],
    ["CLUB", "PING", "DRIVER"], ["CLUB", "Mizuno", "IRON_SET"], ["CLUB", "Cleveland", "WEDGE"],
    ["CLUB", "Odyssey", "PUTTER"], ["SHAFT", "Fujikura", null], ["BALL", "Titleist", null],
  ] as const) {
    const page = await provider.search({ kind, query, category, limit: 50 });
    assert.ok(page.items.length > 0, `${kind} ${query} ${category || ""} debe devolver resultados`);
  }
  assert.ok(golfClubCatalog.every((item) => item.officialUrl && item.sourceName && item.verifiedAt));
  assert.ok(golfShaftCatalog.every((item) => item.officialUrl && item.sourceName && item.verifiedAt));
  assert.ok(golfBallCatalog.every((item) => item.officialUrl && item.sourceName && item.verifiedAt));
});

test("visión de launch monitor conserva evidencia parcial y rechaza rangos inventados", () => {
  const metrics = {
    clubSpeedMph: { value: 101.2, confidence: .98 }, ballSpeedMph: { value: 148.4, confidence: .97 },
    launchAngleDegrees: { value: 13.1, confidence: .7 }, spinRpm: { value: null, confidence: .4 },
    carryYards: { value: 253, confidence: .96 }, totalYards: { value: null, confidence: .3 },
    peakHeightYards: { value: null, confidence: .3 }, landingAngleDegrees: { value: null, confidence: .3 },
  };
  const valid = normalizeLaunchMonitorVisionExtraction({ version: 1, source: "TrackMan", shots: [{ sourcePhotoId: "photo-1", club: "DRIVER", clubConfidence: .95, metrics }] }, ["photo-1"]);
  assert.equal(valid?.shots.length, 1);
  assert.equal(valid?.shots[0].metrics.spinRpm.value, null);
  assert.equal(normalizeLaunchMonitorVisionExtraction({ version: 1, source: "x", shots: [{ sourcePhotoId: "photo-1", club: "DRIVER", clubConfidence: 1, metrics: { ...metrics, ballSpeedMph: { value: 999, confidence: 1 } } }] }, ["photo-1"]), null);
  const camera = readFileSync("app/components/launch-monitor-camera.tsx", "utf8");
  assert.match(camera, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(camera, /Revisa antes de guardar/);
  assert.match(camera, /normalizeLaunchMonitorVisionExtraction\(extraction/);
});

test("fotos de launch monitor reparten el presupuesto agregado antes del POST", async () => {
  const seenBudgets: number[] = [];
  const photos = [1, 2, 3, 4].map((value) => ({ id: `photo-${value}`, file: new File([String(value)], `${value}.jpg`, { type: "image/jpeg" }) }));
  const prepared = await prepareLaunchMonitorPhotos(photos, {
    compress: async (_file, maxBytes) => { seenBudgets.push(maxBytes || 0); return new Blob([new Uint8Array(128)], { type: "image/jpeg" }); },
    encode: async () => `data:image/jpeg;base64,${"A".repeat(172)}`,
  });
  assert.equal(prepared.length, 4);
  assert.equal(new Set(seenBudgets).size, 1);
  assert.ok(seenBudgets[0] > 0 && seenBudgets[0] < 1_000_000);
});

test("resumen deriva GIR sin captura manual y conserva putts cero", () => {
  const data = buildPlayerRoundStats({
    playerId: "said",
    course: { id: "c", name: "Campo", teeName: "Blancas", holes: [{ number: 1, par: 4, strokeIndex: 1 }] },
    order: [1], scores: { 1: { said: 3 } }, putts: { 1: { said: 0 } },
    advancedStats: { 1: { said: { greenSideBunkerCount: 1, fairwayBunkerCount: 2, penaltyAreaCount: 1 } } },
  });
  assert.equal(data.holes[0].putts, 0);
  assert.equal(data.holes[0].gir, false, "un hole-out sin putt no debe inventarse como green alcanzado");
  assert.equal(data.summary.bunkers, 3);
  assert.equal(data.summary.penaltyAreas, 1);
  assert.doesNotMatch(readFileSync("app/components/round-capture-v2.tsx", "utf8"), />GIR</);
});
