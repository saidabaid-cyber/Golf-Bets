import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  backyardIndexSelection,
  backyardScoreDifferential,
  calculateBackyardIndex,
  createBackyardIndexRoundSnapshot,
  snapshotBackyardIndexRound,
} from "../lib/backyard-index";
import type {
  BackyardIndexPccEvidence,
  BackyardIndexRatedTeeEvidence,
  Course,
  Player,
  RoundSnapshot,
} from "../lib/types";

const accountUserId = "account-owner";
const playedAt = "2026-09-01";
const ratedTeeEvidence: BackyardIndexRatedTeeEvidence = {
  kind: "OFFICIAL_RATED_TEE", authority: "Synthetic authorized association fixture",
  sourceUrl: "https://ratings.example.test/course/tee", verifiedAt: "2026-08-20T10:00:00.000Z",
  courseId: "course-1", teeId: "tee-1", courseRating: 72, slopeRating: 113,
};
function localZero(date = playedAt): Extract<BackyardIndexPccEvidence, { kind: "DECLARED_LOCAL_ZERO" }> {
  return { kind: "DECLARED_LOCAL_ZERO", value: 0,
    declaredAt: `${date}T20:00:00.000Z`, declaredByAccountUserId: accountUserId };
}

function round(id = "round-1", date = playedAt, scoreAbovePar = 18): RoundSnapshot {
  const holes = Array.from({ length: 18 }, (_, index) => ({
    number: index + 1, par: 4, strokeIndex: index + 1,
  }));
  const course: Course = {
    id: "tee-1", catalogCourseId: "course-1", catalogTeeId: "tee-1",
    name: "Campo de prueba", teeName: "Azules", rating: 72, slope: 113, holes,
  };
  const player: Player = {
    id: "owner-player", name: "Owner", accountUserId, handicap: 36,
    handicapSource: "profile_index", handicapIndex: 8,
    handicapIndexSource: "BACKYARD_MANUAL",
    courseHandicapSnapshot: {
      index: 8, indexSource: "BACKYARD_MANUAL", teeId: "tee-1", teeName: "Azules",
      slope: 113, courseRating: 72, par: 72, courseHandicap: 8,
      appliedHandicap: 8, formulaVersion: "WHS-2024-COURSE-HANDICAP-V1",
      effectiveAt: "2026-08-20T10:00:00.000Z", calculatedAt: "2026-08-20T10:00:00.000Z",
    },
  };
  const base = Math.floor(scoreAbovePar / 18);
  const remainder = scoreAbovePar % 18;
  const scores = Object.fromEntries(holes.map((hole, index) => [
    hole.number, { [player.id]: 4 + base + (index < remainder ? 1 : 0) },
  ]));
  return {
    id, lifecycleState: "completed", snapshotVersion: 2, roundHoles: 18,
    order: holes.map((hole) => hole.number), date, completedAt: `${date}T18:00:00.000Z`,
    updatedAt: `${date}T18:00:00.000Z`, courseName: course.name, teeName: "Azules",
    ownerName: player.name, ownerId: player.id, players: [player], scores,
    courseSnapshot: course,
    playerTeeAssignments: [{
      playerId: player.id, courseId: "course-1", teeId: "tee-1", teeName: "Azules",
      source: "catalog", rating: 72, slope: 113, capturedAt: "2026-08-20T10:00:00.000Z",
    }],
    betResult: 0, expenses: {}, expenseTotal: 0, netResult: 0, categoryResults: {},
  } as RoundSnapshot;
}

test("confirmed shared evidence keeps original round ID, counts once, denies other account and unconfirmed views", () => {
  const saved = snapshotBackyardIndexRound(round(), accountUserId, { ratedTeeEvidence, pccEvidence: localZero() });
  const shared: RoundSnapshot = { ...saved, id: "shared:db-id", cloudReadOnly: true,
    cloudRoundId: "db-id", cloudSourceLocalId: saved.id,
    cloudParticipant: { accountUserId, playerId: "owner-player" } };
  assert.equal(calculateBackyardIndex([shared, shared], accountUserId).eligibleRoundCount, 1);
  assert.equal(calculateBackyardIndex([shared], "other-account").records.length, 0);
  assert.equal(calculateBackyardIndex([{ ...shared, cloudParticipant: undefined }], accountUserId).records.length, 0);
  assert.equal(calculateBackyardIndex([shared, { ...saved, cloudRoundId: "db-id" }], accountUserId).eligibleRoundCount, 1);
  assert.equal(shared.backyardIndexSnapshots?.[0].roundId, saved.id);
});

test("score differential usa adjusted gross, Rating, Slope y PCC conocidos; redondea .5 hacia arriba", () => {
  assert.equal(backyardScoreDifferential(90, 72, 113, 0), 18);
  assert.equal(backyardScoreDifferential(90, 72, 113, 1), 17);
  assert.equal(backyardScoreDifferential(80, 72, 130, 0), 7);
  assert.equal(backyardScoreDifferential(70.45, 72, 113, 0), -1.5);
  assert.throws(() => backyardScoreDifferential(90, 72, 113, Number.NaN));
});

test("sin Rating acreditado o PCC declarado no se inventa índice ni PCC 0", () => {
  const saved = createBackyardIndexRoundSnapshot(round(), "owner-player");
  assert.equal(saved.eligible, false);
  assert.ok(saved.reasons.includes("MISSING_OFFICIAL_TEE_RATING"));
  assert.ok(saved.reasons.includes("MISSING_PCC_EVIDENCE"));
  assert.equal(saved.scoreDifferential, undefined);
  assert.equal(saved.adjustedGrossScore, 90);
  const history = snapshotBackyardIndexRound(round(), accountUserId);
  assert.equal(calculateBackyardIndex([history], accountUserId).value, null);
});

test("fecha de juego exige YYYY-MM-DD real al crear y leer evidencia", () => {
  for (const invalidDate of ["not-a-date", "2026-02-30", "2025-02-29", "2026-13-01", "2026-00-01", "2026-2-01"]) {
    const invalid = round(`invalid-${invalidDate}`, invalidDate);
    const saved = snapshotBackyardIndexRound(invalid, accountUserId, {
      ratedTeeEvidence, pccEvidence: localZero(),
    });
    assert.equal(saved.backyardIndexSnapshots?.[0].eligible, false, invalidDate);
    assert.ok(saved.backyardIndexSnapshots?.[0].reasons.includes("INVALID_PLAYED_DATE"), invalidDate);
    assert.equal(saved.backyardIndexSnapshots?.[0].scoreDifferential, undefined, invalidDate);
    assert.equal(calculateBackyardIndex([saved], accountUserId).records[0].eligible, false, invalidDate);
  }
  const leap = snapshotBackyardIndexRound(round("leap", "2028-02-29"), accountUserId, {
    ratedTeeEvidence, pccEvidence: localZero("2028-02-29"),
  });
  assert.equal(leap.backyardIndexSnapshots?.[0].eligible, true);
  const tampered = eligibleRound("tampered-date", "2026-03-01", 9);
  tampered.date = "2026-02-30";
  tampered.backyardIndexSnapshots![0].playedAt = tampered.date;
  assert.equal(calculateBackyardIndex([tampered], accountUserId).records[0].eligible, false);
});

test("tee, Rating y PCC publicados tienen que coincidir con snapshot y fecha de juego", () => {
  const base = round();
  const published: BackyardIndexPccEvidence = {
    kind: "PUBLISHED_PCC", value: 1, appliesToDate: playedAt,
    authority: "Synthetic published fixture", verifiedAt: "2026-09-02T10:00:00.000Z",
  };
  const valid = createBackyardIndexRoundSnapshot(base, "owner-player", {
    ratedTeeEvidence, pccEvidence: published,
  });
  assert.equal(valid.eligible, true);
  assert.equal(valid.scoreDifferential, 17);
  assert.equal(createBackyardIndexRoundSnapshot(base, "owner-player", {
    ratedTeeEvidence: { ...ratedTeeEvidence, teeId: "otro-tee" }, pccEvidence: published,
  }).eligible, false);
  assert.equal(createBackyardIndexRoundSnapshot(base, "owner-player", {
    ratedTeeEvidence: { ...ratedTeeEvidence, courseRating: 73 }, pccEvidence: published,
  }).reasons.includes("TEE_RATING_MISMATCH"), true);
  assert.equal(createBackyardIndexRoundSnapshot(base, "owner-player", {
    ratedTeeEvidence, pccEvidence: { ...published, appliesToDate: "2026-08-31" },
  }).reasons.includes("INVALID_PCC_EVIDENCE"), true);
  assert.equal(createBackyardIndexRoundSnapshot(base, "owner-player", {
    ratedTeeEvidence, pccEvidence: { ...localZero(), declaredByAccountUserId: "otro" },
  }).eligible, false);
});

test("adjusted gross usa Course Handicap irrestricto, jamás el HCP de apuesta", () => {
  const source = round();
  source.scores![10]["owner-player"] = 10;
  const frozen = createBackyardIndexRoundSnapshot(source, "owner-player", {
    ratedTeeEvidence, pccEvidence: localZero(),
  });
  assert.equal(frozen.eligible, true);
  assert.equal(frozen.grossScore, 95);
  assert.equal(frozen.adjustedGrossScore, 91); // Hoyo SI 10: par 4 + 2 + 0, no HCP 36.
  assert.equal(frozen.unrestrictedCourseHandicap, 8);
  assert.equal(source.players![0].handicap, 36);
});

test("score inicial sin Index usa par+5 y 9 hoyos/incompletos quedan ineligible", () => {
  const source = round();
  source.players![0].handicapIndex = undefined;
  source.players![0].courseHandicapSnapshot = undefined;
  source.scores![1]["owner-player"] = 12;
  const initial = createBackyardIndexRoundSnapshot(source, "owner-player", {
    ratedTeeEvidence, pccEvidence: localZero(),
  });
  assert.equal(initial.adjustmentMethod, "INITIAL_PAR_PLUS_FIVE");
  assert.equal(initial.adjustedGrossScore, 94);
  assert.equal(initial.scoreDifferential, 22);
  const nine = { ...source, roundHoles: 9 as const, order: source.order!.slice(0, 9) };
  assert.equal(createBackyardIndexRoundSnapshot(nine, "owner-player", {
    ratedTeeEvidence, pccEvidence: localZero(),
  }).reasons.includes("NOT_COMPLETE_18_HOLES"), true);
  const incomplete = round();
  delete incomplete.scores![18];
  assert.equal(createBackyardIndexRoundSnapshot(incomplete, "owner-player", {
    ratedTeeEvidence, pccEvidence: localZero(),
  }).reasons.includes("MISSING_HOLE_SCORES"), true);
});

test("tabla progresiva 3–19 coincide exactamente con USGA/R&A Rule 5.2a", () => {
  const expected: Record<number, [number, number]> = {
    3: [1, -2], 4: [1, -1], 5: [1, 0], 6: [2, -1], 7: [2, 0],
    8: [2, 0], 9: [3, 0], 10: [3, 0], 11: [3, 0], 12: [4, 0],
    13: [4, 0], 14: [4, 0], 15: [5, 0], 16: [5, 0], 17: [6, 0],
    18: [6, 0], 19: [7, 0], 20: [8, 0],
  };
  for (const [count, [use, adjustment]] of Object.entries(expected)) {
    assert.deepEqual(backyardIndexSelection(Number(count)), { use, adjustment });
  }
  assert.deepEqual(backyardIndexSelection(2), { use: 0, adjustment: 0 });
  assert.deepEqual(backyardIndexSelection(25), { use: 8, adjustment: 0 });
});

function eligibleRound(id: string, date: string, differential: number): RoundSnapshot {
  const source = round(id, date, differential);
  return snapshotBackyardIndexRound(source, accountUserId, {
    ratedTeeEvidence, pccEvidence: localZero(date),
  });
}

for (const [count, used, value] of [
  [0, 0, null], [1, 0, null], [2, 0, null], [3, 1, -1], [4, 1, 0], [5, 1, 1],
  [6, 2, 0.5], [8, 2, 1.5], [10, 3, 2], [14, 4, 2.5], [16, 5, 3],
  [18, 6, 3.5], [19, 7, 4], [20, 8, 4.5], [21, 8, 5.5],
] as const) {
  test(`A–O: ${count} scores · ${used} seleccionados · índice ${value ?? "sin valor"}`, () => {
    const records = Array.from({ length: count }, (_, index) => eligibleRound(`progress-${index}`, `2026-02-${String(index + 1).padStart(2, "0")}`, index + 1));
    const result = calculateBackyardIndex(records, accountUserId);
    assert.equal(result.value, value);
    assert.equal(result.usedCount, used);
    assert.equal(result.recentRoundCount, Math.min(count, 20));
    if (count === 21) assert.equal(result.usedRoundIds.includes("progress-0"), false);
  });
}

test("3 elegibles usan menor diferencial -2 y 20 últimos usan mejores 8", () => {
  const three = [eligibleRound("a", "2026-01-01", 14), eligibleRound("b", "2026-01-02", 12),
    eligibleRound("c", "2026-01-03", 10)];
  const summary3 = calculateBackyardIndex(three, accountUserId);
  assert.equal(summary3.value, 8);
  assert.equal(summary3.usedCount, 1);
  assert.deepEqual(summary3.usedRoundIds, ["c"]);
  const twentyOne = Array.from({ length: 21 }, (_, index) =>
    eligibleRound(`r-${index + 1}`, `2026-02-${String(index + 1).padStart(2, "0")}`, index + 1));
  const summary = calculateBackyardIndex(twentyOne, accountUserId);
  assert.equal(summary.eligibleRoundCount, 21);
  assert.equal(summary.recentRoundCount, 20);
  assert.equal(summary.usedCount, 8);
  assert.equal(summary.value, 5.5); // Excludes oldest 1; best 2..9.
  assert.equal(summary.usedRoundIds.includes("r-1"), false);
});

test("corrección histórica reutiliza evidencia congelada sin mutar histórico o mover fecha de juego", () => {
  const old = eligibleRound("same", "2026-01-01", 10);
  const oldJson = JSON.stringify(old);
  const corrected = round("same", "2026-01-01", 8);
  corrected.updatedAt = "2026-12-31T20:00:00.000Z";
  const wrapped = snapshotBackyardIndexRound(corrected, accountUserId, { priorRound: old });
  assert.equal(wrapped.backyardIndexSnapshots?.[0].scoreDifferential, 8);
  assert.deepEqual(wrapped.backyardIndexSnapshots?.[0].ratedTeeEvidence, ratedTeeEvidence);
  assert.deepEqual(wrapped.backyardIndexSnapshots?.[0].pccEvidence, localZero("2026-01-01"));
  assert.equal(JSON.stringify(old), oldJson);
  assert.equal(old.backyardIndexSnapshots?.[0].scoreDifferential, 10);
  const more = [wrapped, ...Array.from({ length: 20 }, (_, index) =>
    eligibleRound(`later-${index}`, `2026-02-${String(index + 1).padStart(2, "0")}`, index + 1))];
  const summary = calculateBackyardIndex([old, ...more], accountUserId);
  assert.equal(summary.records[0].roundId, "later-19");
  assert.equal(summary.records.at(-1)?.roundId, "same");
  assert.equal(summary.eligibleRoundCount, 21); // Latest correction deduped.
});

test("mover fecha histórica descarta PCC 0 heredado hasta redeclararlo explícitamente", () => {
  const old = eligibleRound("date-correction", "2026-01-01", 10);
  const moved = snapshotBackyardIndexRound(round("date-correction", "2026-01-02", 10), accountUserId, { priorRound: old });
  assert.equal(moved.backyardIndexSnapshots?.[0].pccEvidence, undefined);
  assert.ok(moved.backyardIndexSnapshots?.[0].reasons.includes("MISSING_PCC_EVIDENCE"));
  assert.equal(moved.backyardIndexSnapshots?.[0].eligible, false);
  assert.deepEqual(old.backyardIndexSnapshots?.[0].pccEvidence, localZero("2026-01-01"));
  const redeclared = snapshotBackyardIndexRound(round("date-correction", "2026-01-02", 10), accountUserId, {
    priorRound: old, pccEvidence: localZero("2026-01-02"),
  });
  assert.equal(redeclared.backyardIndexSnapshots?.[0].eligible, true);
  const current = round("date-correction", "2026-01-02", 10);
  current.backyardIndexSnapshots = structuredClone(old.backyardIndexSnapshots);
  const staleCurrent = snapshotBackyardIndexRound(current, accountUserId);
  assert.equal(staleCurrent.backyardIndexSnapshots?.[0].pccEvidence, undefined);
});

test("cache/snapshot corrupto falla cerrado sin romper el resumen", () => {
  const corrupt = eligibleRound("corrupt", "2026-03-01", 9);
  corrupt.backyardIndexSnapshots![0].holeAdjustments![0] = null as never;
  corrupt.backyardIndexSnapshots![0].ratedTeeEvidence!.authority = {} as unknown as string;
  assert.doesNotThrow(() => calculateBackyardIndex([corrupt], accountUserId));
  const summary = calculateBackyardIndex([corrupt], accountUserId);
  assert.equal(summary.value, null);
  assert.equal(summary.records[0].eligible, false);
  assert.deepEqual(summary.records[0].reasons, ["INVALID_INDEX_SNAPSHOT"]);
  const mismatchedOwner = eligibleRound("other-owner", "2026-03-02", 9);
  mismatchedOwner.backyardIndexSnapshots![0].playerId = "unknown-player";
  assert.equal(calculateBackyardIndex([mismatchedOwner], accountUserId).records[0].eligible, false);
  const mismatchedHole = eligibleRound("other-hole", "2026-03-03", 9);
  mismatchedHole.courseSnapshot!.holes[0].par = 5;
  assert.equal(calculateBackyardIndex([mismatchedHole], accountUserId).records[0].eligible, false);
});

test("tarjeta requiere opt-in, nombra NO OFICIAL y mantiene HCP/ GHIN separados", () => {
  const card = readFileSync("app/components/backyard-index-card.tsx", "utf8");
  assert.match(card, /enabled: boolean/);
  assert.match(card, /LOCAL · NO OFICIAL/);
  assert.match(card, /NO ELEGIBLE/);
  assert.match(card, /HCP de juego y ventajas de apuestas se calculan por ronda y tee/);
  assert.match(card, /GHIN será una fuente separada/);
  assert.doesNotMatch(card, /defaultHandicap\s*=/);
});
