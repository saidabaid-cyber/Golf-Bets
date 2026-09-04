import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { describeCloudConflict } from "../lib/cloud-conflict-display";
import { actionableCloudConflicts, findAmbiguousCloudConflicts, mergeLocalAndCloud, type CloudDataBundle } from "../lib/cloud-sync";
import { ballFriendScoreResult } from "../lib/hole-bet-display";
import { finalizeNumericCapture, normalizeNumericCaptureText, parseNumericCapture } from "../lib/numeric-input";

function bundle(deviceId: string, activeDraft: unknown, baseDraft: unknown): CloudDataBundle {
  return {
    version: 1,
    deviceId,
    history: [],
    frequentPlayers: [],
    frequentGroups: [],
    rivals: [],
    courses: [],
    preferences: { highContrast: true, language: "es-MX", notificationsEnabled: false, defaultHandicap: null },
    activeDraft,
    activeDraftUpdatedAt: "2026-09-04T16:28:12.731Z",
    baseDraft,
    baseDraftFingerprint: JSON.stringify(baseDraft),
    tombstones: [],
  };
}

test("$100 y 80% se confirman completos; signo, punto y coma usan teclado de texto", () => {
  assert.equal(normalizeNumericCaptureText("$1"), "1");
  assert.equal(normalizeNumericCaptureText("$10"), "10");
  assert.equal(normalizeNumericCaptureText("$100"), "100");
  assert.equal(finalizeNumericCapture("100").value, 100);
  assert.equal(finalizeNumericCapture("80", 0, 100).value, 80);
  assert.equal(parseNumericCapture("-500"), -500);
  assert.equal(parseNumericCapture("12.7"), 12.7);
  assert.equal(parseNumericCapture("12,7"), 12.7);
  assert.equal(parseNumericCapture("cien"), null);
  const input = readFileSync("app/components/numeric-capture-input.tsx", "utf8");
  assert.match(input, /type="text"/);
  assert.match(input, /inputMode="text"/);
  assert.match(input, /flushSync\(\(\) => onValueChange\(finalized\.value\)\)/);
  assert.doesNotMatch(input, /onValueChange\([^\n]*event\.target\.value/);
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /commitUnchanged placeholder=\{String\(hole\.par\)\}/);
});

test("todas las apuestas editadas por el mismo dispositivo conservan el valor local sin modal", () => {
  const betKeys = ["rabbits", "skins", "units", "foursome", "polla", "miniPolla", "ballFriend", "loba"];
  for (const key of betKeys) {
    const base = { roundId: "r", bets: { [key]: { enabled: false, value: 50, hcpPct: 100 } } };
    const local = { roundId: "r", bets: { [key]: { enabled: true, value: 100, hcpPct: 80 } } };
    const cloud = { roundId: "r", bets: { [key]: { enabled: false, value: 1, hcpPct: 1 } } };
    const localBundle = bundle("3022ae5e-66bc-45ee-a9da-a3dbcc47918e", local, base);
    const cloudBundle = { ...bundle("3022ae5e-66bc-45ee-a9da-a3dbcc47918e", cloud, undefined), baseDraftFingerprint: undefined, baseDraft: undefined };
    assert.equal(actionableCloudConflicts(findAmbiguousCloudConflicts(localBundle, cloudBundle)).length, 0, key);
    assert.deepEqual(mergeLocalAndCloud(localBundle, cloudBundle).activeDraft, local, key);
  }
  const base = { roundId: "r", personalBets: [{ id: "personal-1", value: 50 }], manualBets: [{ id: "manual-1", amounts: { said: 0 } }] };
  const local = { roundId: "r", personalBets: [{ id: "personal-1", value: 100 }], manualBets: [{ id: "manual-1", amounts: { said: -500 } }] };
  const cloud = { roundId: "r", personalBets: [{ id: "personal-1", value: 1 }], manualBets: [{ id: "manual-1", amounts: { said: 0 } }] };
  const localBundle = bundle("same-installation", local, base);
  const cloudBundle = { ...bundle("same-installation", cloud, undefined), baseDraftFingerprint: undefined, baseDraft: undefined };
  assert.equal(actionableCloudConflicts(findAmbiguousCloudConflicts(localBundle, cloudBundle)).length, 0);
  assert.deepEqual(mergeLocalAndCloud(localBundle, cloudBundle).activeDraft, local);
});

test("dos dispositivos distintos todavía generan conflicto para el mismo dato", () => {
  const base = { roundId: "r", bets: { rabbits: { enabled: true, value: 50, hcpPct: 100 } } };
  const local = { roundId: "r", bets: { rabbits: { enabled: true, value: 100, hcpPct: 80 } } };
  const cloud = { roundId: "r", bets: { rabbits: { enabled: true, value: 1, hcpPct: 1 } } };
  const conflicts = actionableCloudConflicts(findAmbiguousCloudConflicts(bundle("iphone-a", local, base), {
    ...bundle("iphone-b", cloud, undefined), baseDraftFingerprint: undefined, baseDraft: undefined,
  }));
  assert.deepEqual(conflicts.map(item => item.fieldPath).sort(), ["/bets/rabbits/hcpPct", "/bets/rabbits/value"]);
});

test("el conflicto muestra contexto humano sin ruta, UUID, JSON ni timestamp", () => {
  const money = describeCloudConflict({ collection: "activeDraft", localId: "/bets/rabbits/value", fieldPath: "/bets/rabbits/value", localValue: 100, cloudValue: 1 }, () => "Said");
  const handicap = describeCloudConflict({ collection: "activeDraft", localId: "/bets/rabbits/hcpPct", fieldPath: "/bets/rabbits/hcpPct", localValue: 80, cloudValue: 100 }, () => "Said");
  const score = describeCloudConflict({ collection: "activeDraft", localId: "/scores/5/said", fieldPath: "/scores/5/said", playerId: "said", hole: 5, localValue: 4, cloudValue: 5 }, () => "Said");
  assert.deepEqual(money, { label: "Valor de Conejos", cloudValue: "$1", localValue: "$100" });
  assert.deepEqual(handicap, { label: "Porcentaje HCP de Conejos", cloudValue: "100%", localValue: "80%" });
  assert.equal(score.label, "Score de Said en hoyo 5");
  const visible = JSON.stringify([money, handicap, score]);
  assert.doesNotMatch(visible, /\/bets\/|3022ae|2026-09-04T|fieldPath/);
});

test("Bola Amiga usa el resultado guardado una sola vez y expresa el monto por jugador", () => {
  assert.equal(ballFriendScoreResult({ pointDiff: 2 }, 100), "🤝 Bola Amiga · Ganó Equipo 1 · $200 por jugador");
  assert.equal(ballFriendScoreResult({ pointDiff: -1 }, 100), "🤝 Bola Amiga · Ganó Equipo 2 · $100 por jugador");
  assert.equal(ballFriendScoreResult({ pointDiff: 0 }, 100), "🤝 Bola Amiga · Empate · $0");
  const page = readFileSync("app/page.tsx", "utf8");
  assert.equal((page.match(/ballFriendScoreResult\(savedBfDetail/g) || []).length, 1);
  assert.match(page, /completedHoles\.has\(holeNumber\) && savedBfDetail/);
});

test("scores siguen arriba y Personales queda fuera del Resumen General sin duplicarse", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const scorecard = page.indexOf('<section className="card scoreCard">');
  const priorStatus = page.indexOf('<section className="card compact priorBetStatus"');
  assert.ok(scorecard >= 0 && priorStatus > scorecard);
  assert.match(page, /generalBetBalances = useMemo\(\(\) => mergeBalances\(players,[^\n]+manual\.balances/);
  assert.doesNotMatch(page.match(/const generalBetBalances[^\n]+/)?.[0] || "", /personals\.balances/);
  assert.equal((page.match(/title="Resultados de Apuestas Personales"/g) || []).length, 1);
  assert.match(readFileSync("app/components/personal-compact.tsx", "utf8"), /Total de Personales/);
});
