import { createHash } from "node:crypto";

import type { NormalizedGhinScore } from "./core";

export type GhinScoreType = "H" | "A" | "T";
export type GhinTeeSetSide = "All18" | "F9" | "B9";

export type GhinHoleScore = {
  holeNumber: number;
  rawScore: number;
};

export type GhinScorePostingCandidate = {
  ownerId: string;
  roundId: string;
  golferId: string | null;
  providerCourseId: string | null;
  providerTeeSetId: string | null;
  providerMappingConfirmed: boolean;
  sourceIsProvisional: boolean;
  teeSetSide: GhinTeeSetSide | null;
  playedAt: string | null;
  scoreType: GhinScoreType | null;
  gender: "M" | "F" | null;
  numberOfHoles: 9 | 18 | null;
  holeDetails: GhinHoleScore[];
  courseName: string | null;
  teeName: string | null;
};

export type GhinScorePostingDryRun = {
  status: "READY" | "BLOCKED" | "DUPLICATE";
  endpoint: "/scores/hbh.json";
  fingerprint: string | null;
  grossScore: number | null;
  errors: string[];
  duplicateScoreId: string | null;
  payload: {
    golfer_id: string;
    course_id: string;
    tee_set_id: string;
    tee_set_side: GhinTeeSetSide;
    played_at: string;
    score_type: GhinScoreType;
    hole_details: Array<{ hole_number: number; raw_score: number }>;
    number_of_holes: "9" | "18";
    number_of_played_holes: number;
    gender: "M" | "F";
  } | null;
};

function normalizeName(value: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function validDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)));
}

function fingerprintPayload(payload: NonNullable<GhinScorePostingDryRun["payload"]>) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function findDuplicateGhinScore(
  candidate: Pick<GhinScorePostingCandidate, "playedAt" | "providerCourseId" | "providerTeeSetId" | "courseName" | "teeName" | "holeDetails">,
  scores: readonly NormalizedGhinScore[],
) {
  const gross = candidate.holeDetails.reduce((sum, hole) => sum + hole.rawScore, 0);
  return scores.find((score) => {
    if (score.playedOn !== candidate.playedAt) return false;
    const courseMatches = candidate.providerCourseId && score.courseId
      ? candidate.providerCourseId === score.courseId
      : normalizeName(candidate.courseName) !== "" && normalizeName(candidate.courseName) === normalizeName(score.courseName);
    const teeMatches = candidate.providerTeeSetId && score.teeId
      ? candidate.providerTeeSetId === score.teeId
      : normalizeName(candidate.teeName) !== "" && normalizeName(candidate.teeName) === normalizeName(score.teeName);
    const scoreMatches = score.grossScore === gross || score.adjustedGrossScore === gross;
    return Boolean(courseMatches && teeMatches && scoreMatches);
  }) ?? null;
}

export function buildGhinScorePostingDryRun(
  candidate: GhinScorePostingCandidate,
  scoringRecord: readonly NormalizedGhinScore[],
): GhinScorePostingDryRun {
  const errors: string[] = [];
  if (!candidate.golferId) errors.push("GOLFER_ID_REQUIRED");
  if (!candidate.providerCourseId) errors.push("GHIN_COURSE_ID_REQUIRED");
  if (!candidate.providerTeeSetId) errors.push("GHIN_TEE_SET_ID_REQUIRED");
  if (!candidate.providerMappingConfirmed) errors.push("GHIN_MAPPING_NOT_CONFIRMED");
  if (candidate.sourceIsProvisional) errors.push("PROVISIONAL_LAYOUT_NOT_POSTABLE");
  if (!candidate.teeSetSide) errors.push("TEE_SET_SIDE_REQUIRED");
  if (!validDate(candidate.playedAt)) errors.push("PLAYED_AT_REQUIRED");
  if (!candidate.scoreType) errors.push("SCORE_TYPE_REQUIRED");
  if (!candidate.gender) errors.push("GENDER_REQUIRED");
  if (candidate.numberOfHoles !== 9 && candidate.numberOfHoles !== 18) errors.push("NUMBER_OF_HOLES_REQUIRED");
  const expected = candidate.numberOfHoles ?? 0;
  const sortedHoles = [...candidate.holeDetails].sort((left, right) => left.holeNumber - right.holeNumber);
  if (sortedHoles.length !== expected) errors.push("COMPLETE_HOLE_BY_HOLE_SCORE_REQUIRED");
  if (new Set(sortedHoles.map((hole) => hole.holeNumber)).size !== sortedHoles.length) errors.push("DUPLICATE_HOLE_NUMBER");
  if (sortedHoles.some((hole) => !Number.isInteger(hole.holeNumber) || hole.holeNumber < 1 || hole.holeNumber > 18
    || !Number.isInteger(hole.rawScore) || hole.rawScore < 1)) errors.push("INVALID_HOLE_SCORE");
  const expectedHoleNumbers = candidate.teeSetSide === "F9"
    ? Array.from({ length: 9 }, (_, index) => index + 1)
    : candidate.teeSetSide === "B9"
      ? Array.from({ length: 9 }, (_, index) => index + 10)
      : candidate.teeSetSide === "All18"
        ? Array.from({ length: 18 }, (_, index) => index + 1)
        : [];
  if (expectedHoleNumbers.length && (
    expectedHoleNumbers.length !== sortedHoles.length
    || expectedHoleNumbers.some((number, index) => sortedHoles[index]?.holeNumber !== number)
  )) errors.push("TEE_SET_SIDE_HOLES_MISMATCH");
  if (errors.length) return {
    status: "BLOCKED",
    endpoint: "/scores/hbh.json",
    fingerprint: null,
    grossScore: sortedHoles.length ? sortedHoles.reduce((sum, hole) => sum + hole.rawScore, 0) : null,
    errors: [...new Set(errors)],
    duplicateScoreId: null,
    payload: null,
  };

  const payload = {
    golfer_id: candidate.golferId as string,
    course_id: candidate.providerCourseId as string,
    tee_set_id: candidate.providerTeeSetId as string,
    tee_set_side: candidate.teeSetSide as GhinTeeSetSide,
    played_at: candidate.playedAt as string,
    score_type: candidate.scoreType as GhinScoreType,
    hole_details: sortedHoles.map((hole) => ({ hole_number: hole.holeNumber, raw_score: hole.rawScore })),
    number_of_holes: String(candidate.numberOfHoles) as "9" | "18",
    number_of_played_holes: sortedHoles.length,
    gender: candidate.gender as "M" | "F",
  };
  const duplicate = findDuplicateGhinScore(candidate, scoringRecord);
  return {
    status: duplicate ? "DUPLICATE" : "READY",
    endpoint: "/scores/hbh.json",
    fingerprint: fingerprintPayload(payload),
    grossScore: sortedHoles.reduce((sum, hole) => sum + hole.rawScore, 0),
    errors: duplicate ? ["DUPLICATE_SCORE_FOUND"] : [],
    duplicateScoreId: duplicate?.id ?? null,
    payload,
  };
}

export async function postGhinScoreExactlyOnce<T>(input: {
  dryRun: GhinScorePostingDryRun;
  claim: (fingerprint: string) => Promise<{ acquired: boolean; prior?: T }>;
  post: (payload: NonNullable<GhinScorePostingDryRun["payload"]>) => Promise<T>;
  finalize: (result: T) => Promise<void>;
  fail: (code: string) => Promise<void>;
}) {
  if (input.dryRun.status !== "READY" || !input.dryRun.payload || !input.dryRun.fingerprint) {
    throw new Error("GHIN_SCORE_POST_NOT_READY");
  }
  const claim = await input.claim(input.dryRun.fingerprint);
  if (!claim.acquired) return { posted: false as const, result: claim.prior ?? null };
  try {
    const result = await input.post(input.dryRun.payload);
    await input.finalize(result);
    return { posted: true as const, result };
  } catch (error) {
    await input.fail("GHIN_SCORE_POST_FAILED");
    throw error;
  }
}
