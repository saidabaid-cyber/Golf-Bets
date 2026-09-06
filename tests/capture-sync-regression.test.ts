import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { describeCloudConflict } from "../lib/cloud-conflict-display";
import { actionableCloudConflicts, findAmbiguousCloudConflicts, mergeLocalAndCloud, type CloudDataBundle } from "../lib/cloud-sync";
import { runCloudSyncCycle } from "../lib/cloud-sync-cycle";
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

test("el último carácter del score se confirma antes de guardar, sin microtask ni render intermedio", () => {
  let editingBuffer = normalizeNumericCaptureText("4");
  editingBuffer = normalizeNumericCaptureText("17");
  let confirmedScore: number | null = 4;
  const finalized = finalizeNumericCapture(editingBuffer, 1, 20);
  confirmedScore = finalized.value;
  const savedScore = confirmedScore;
  assert.equal(savedScore, 17, "el guardado observa el valor final ya validado, no el render anterior");

  const input = readFileSync("app/components/numeric-capture-input.tsx", "utf8");
  assert.match(input, /commit\(event\.currentTarget\.value\)/);
  assert.match(input, /finalizeNumericCapture\(latestRawValue, min, max\)/);
  assert.match(input, /rawValueRef\.current = nextRawValue/);
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /useLayoutEffect\(\(\) => \{ latestSaveAndAdvance\.current = saveAndAdvance; \}\)/);
  assert.match(page, /function requestSaveAndAdvance\(\) \{[\s\S]*?latestSaveAndAdvance\.current\(\);[\s\S]*?\}/);
  assert.match(page, /function requestSaveAndAdvance\(\) \{[\s\S]*?commitFocusedNumericCapture\(\);[\s\S]*?latestSaveAndAdvance\.current\(\);/);
  assert.doesNotMatch(page, /queueMicrotask\(\(\) => latestSaveAndAdvance\.current\(\)\)/);
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

test("una respuesta cloud más nueva en reloj del mismo dispositivo no retrocede scores locales", () => {
  const local = { roundId: "round-live", scores: { 7: { said: 4 }, 8: { said: 3 } }, scoreEdits: {} };
  const staleCloud = { roundId: "round-live", scores: { 7: { said: 4 } }, scoreEdits: {} };
  const localBundle = { ...bundle("iphone-main", local, undefined), activeDraftUpdatedAt: "2026-09-04T10:00:00.000Z", baseDraftFingerprint: undefined };
  const cloudBundle = { ...bundle("iphone-main", staleCloud, undefined), activeDraftUpdatedAt: "2026-09-04T10:05:00.000Z", baseDraftFingerprint: undefined };
  assert.deepEqual(mergeLocalAndCloud(localBundle, cloudBundle).activeDraft, local);
  assert.equal(findAmbiguousCloudConflicts(localBundle, cloudBundle).length, 0);
});

test("dos dispositivos sin base común no usan el reloj para ocultar un conflicto real", () => {
  const local = { roundId: "round-live", scores: { 8: { said: 3 } } };
  const cloud = { roundId: "round-live", scores: { 8: { said: 6 } } };
  const localBundle = { ...bundle("iphone-a", local, undefined), activeDraftUpdatedAt: "2026-09-04T10:00:00.000Z", baseDraftFingerprint: undefined };
  const cloudBundle = { ...bundle("iphone-b", cloud, undefined), activeDraftUpdatedAt: "2026-09-04T10:05:00.000Z", baseDraftFingerprint: undefined };
  const conflicts = actionableCloudConflicts(findAmbiguousCloudConflicts(localBundle, cloudBundle));
  assert.deepEqual(conflicts.map(item => item.fieldPath), ["/scores/8/said"]);
  assert.equal((mergeLocalAndCloud(localBundle, cloudBundle).activeDraft as typeof local).scores[8].said, 3);
});

test("cambios rápidos entre hoyos sobreviven a una respuesta retrasada y se sincronizan en el reintento", async () => {
  const deviceId = "iphone-main";
  const initial = { roundId: "round-live", scores: { 7: { said: 4 } }, scoreEdits: {} };
  const changed = { roundId: "round-live", scores: { 7: { said: 4 }, 8: { said: 3 }, 9: { said: 5 } }, scoreEdits: {} };
  let local: CloudDataBundle = { ...bundle(deviceId, initial, undefined), activeDraftUpdatedAt: "2026-09-04T10:00:00.000Z", baseDraftFingerprint: undefined };
  let cloud: CloudDataBundle = structuredClone(local);
  let uploadCount = 0;
  let retries = 0;
  const apply = (data: CloudDataBundle) => { local = structuredClone(data); };
  const first = await runCloudSyncCycle({
    read: () => local,
    download: async () => structuredClone(cloud),
    upload: async data => {
      uploadCount += 1;
      cloud = structuredClone(data);
      local = { ...bundle(deviceId, changed, initial), activeDraftUpdatedAt: "2026-09-04T10:01:00.000Z", baseDraftFingerprint: JSON.stringify(initial) };
    },
    media: async () => {},
    apply,
    retry: () => { retries += 1; },
    current: () => true,
    status: () => {},
  });
  assert.equal(first, false);
  assert.equal(retries, 1);
  assert.deepEqual((local.activeDraft as typeof changed).scores, changed.scores);

  const second = await runCloudSyncCycle({
    read: () => local,
    download: async () => structuredClone(cloud),
    upload: async data => { uploadCount += 1; cloud = structuredClone(data); },
    media: async () => {},
    apply,
    current: () => true,
    status: () => {},
  });
  assert.equal(second, true);
  assert.equal(uploadCount, 2);
  assert.deepEqual((cloud.activeDraft as typeof changed).scores, changed.scores);
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
  assert.match(page, /title={<SetupModeTitle icon=\{BET_PRESENTATION\.personals\.icon\} title=\{BET_PRESENTATION\.personals\.title\}/);
  assert.match(page, /id="personals" title=\{betDisplayLabel\("personals"\)\}/);
  assert.match(readFileSync("app/components/personal-opponent-results.tsx", "utf8"), /<span>Contra<\/span>[\s\S]*Balance/);
});
