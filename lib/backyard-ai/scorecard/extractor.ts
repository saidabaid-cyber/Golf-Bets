import {
  SCORECARD_EXTRACTION_VERSION,
  type ScorecardCellObservation,
  type ScorecardExtraction,
  type ScorecardNormalizationIssue,
  type ScorecardNormalizationResult,
  type ScorecardObservationSource,
  type ScorecardParObservation,
  type ScorecardPhotoExtractionInput,
  type ScorecardPlayerObservation,
  type ScorecardTextObservation,
  type ScorecardTotalKind,
  type ScorecardTotalObservation,
} from "../schemas/scorecard";
import { isScorecardConfidence } from "./confidence";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength = 160) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean && clean.length <= maxLength ? clean : null;
}

function integerOrNull(value: unknown) {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value)) ? value as number | null : undefined;
}

function addIssue(issues: ScorecardNormalizationIssue[], path: string, message: string) {
  issues.push({ path, message });
}

function sourceFrom(
  value: unknown,
  path: string,
  issues: ScorecardNormalizationIssue[],
  authoritativePhotoId?: string,
): ScorecardObservationSource | null {
  if (value === undefined && authoritativePhotoId) return { photoId: authoritativePhotoId };
  const shorthand = nonEmptyString(value, 240);
  if (shorthand) {
    if (authoritativePhotoId && shorthand !== authoritativePhotoId) {
      addIssue(issues, path, "source.photoId no coincide con la foto procesada.");
      return null;
    }
    return { photoId: authoritativePhotoId || shorthand };
  }
  if (!isRecord(value)) {
    addIssue(issues, path, "source debe identificar la foto de origen.");
    return null;
  }
  const photoId = nonEmptyString(value.photoId, 240);
  if (!photoId) {
    addIssue(issues, `${path}.photoId`, "photoId es obligatorio.");
    return null;
  }
  if (authoritativePhotoId && photoId !== authoritativePhotoId) {
    addIssue(issues, `${path}.photoId`, "photoId no coincide con la foto procesada.");
    return null;
  }

  let region: ScorecardObservationSource["region"];
  if (value.region !== undefined) {
    if (!isRecord(value.region)) {
      addIssue(issues, `${path}.region`, "region debe usar coordenadas normalizadas.");
      return null;
    }
    const coordinates = [value.region.x, value.region.y, value.region.width, value.region.height];
    if (!coordinates.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)
      || (value.region.x as number) + (value.region.width as number) > 1.000001
      || (value.region.y as number) + (value.region.height as number) > 1.000001
      || value.region.width === 0
      || value.region.height === 0) {
      addIssue(issues, `${path}.region`, "region contiene coordenadas inválidas.");
      return null;
    }
    region = {
      x: value.region.x as number,
      y: value.region.y as number,
      width: value.region.width as number,
      height: value.region.height as number,
    };
  }

  const rawText = value.rawText === undefined ? undefined : nonEmptyString(value.rawText, 500);
  if (value.rawText !== undefined && !rawText) {
    addIssue(issues, `${path}.rawText`, "rawText debe ser texto breve no vacío.");
    return null;
  }
  return { photoId: authoritativePhotoId || photoId, ...(region ? { region } : {}), ...(rawText ? { rawText } : {}) };
}

function confidenceFrom(value: unknown, path: string, issues: ScorecardNormalizationIssue[]) {
  if (!isScorecardConfidence(value)) {
    addIssue(issues, path, "confidence debe estar entre 0 y 1.");
    return null;
  }
  return value;
}

function textObservationFrom(
  value: unknown,
  path: string,
  issues: ScorecardNormalizationIssue[],
  authoritativePhotoId?: string,
): ScorecardTextObservation | null {
  if (!isRecord(value)) {
    addIssue(issues, path, "La observación debe ser un objeto.");
    return null;
  }
  const text = nonEmptyString(value.value ?? value.name);
  const confidence = confidenceFrom(value.confidence, `${path}.confidence`, issues);
  const source = sourceFrom(value.source, `${path}.source`, issues, authoritativePhotoId);
  if (!text) addIssue(issues, `${path}.value`, "El texto no puede estar vacío.");
  return text && confidence !== null && source ? { value: text, confidence, source } : null;
}

function playerObservationFrom(
  value: unknown,
  path: string,
  issues: ScorecardNormalizationIssue[],
  authoritativePhotoId?: string,
): ScorecardPlayerObservation | null {
  if (!isRecord(value)) {
    addIssue(issues, path, "El jugador debe ser un objeto.");
    return null;
  }
  const playerName = nonEmptyString(value.playerName ?? value.name);
  const confidence = confidenceFrom(value.confidence, `${path}.confidence`, issues);
  const source = sourceFrom(value.source, `${path}.source`, issues, authoritativePhotoId);
  if (!playerName) addIssue(issues, `${path}.playerName`, "playerName no puede estar vacío.");
  return playerName && confidence !== null && source ? { playerName, confidence, source } : null;
}

function cellObservationFrom(
  value: unknown,
  path: string,
  issues: ScorecardNormalizationIssue[],
  authoritativePhotoId?: string,
): ScorecardCellObservation | null {
  if (!isRecord(value)) {
    addIssue(issues, path, "La celda debe ser un objeto.");
    return null;
  }
  const playerName = nonEmptyString(value.playerName);
  const hole = value.hole;
  const score = integerOrNull(value.value);
  const confidence = confidenceFrom(value.confidence, `${path}.confidence`, issues);
  const source = sourceFrom(value.source, `${path}.source`, issues, authoritativePhotoId);
  if (!playerName) addIssue(issues, `${path}.playerName`, "playerName no puede estar vacío.");
  if (typeof hole !== "number" || !Number.isInteger(hole) || hole < 1 || hole > 18) addIssue(issues, `${path}.hole`, "hole debe ser un entero entre 1 y 18.");
  if (score === undefined) addIssue(issues, `${path}.value`, "value debe ser un entero o null si la celda es ilegible.");
  return playerName && typeof hole === "number" && Number.isInteger(hole) && hole >= 1 && hole <= 18
    && score !== undefined && confidence !== null && source
    ? { playerName, hole, value: score, confidence, source }
    : null;
}

function parObservationFrom(
  value: unknown,
  path: string,
  issues: ScorecardNormalizationIssue[],
  authoritativePhotoId?: string,
): ScorecardParObservation | null {
  if (!isRecord(value)) {
    addIssue(issues, path, "El par debe ser un objeto.");
    return null;
  }
  const hole = value.hole;
  const par = integerOrNull(value.value);
  const confidence = confidenceFrom(value.confidence, `${path}.confidence`, issues);
  const source = sourceFrom(value.source, `${path}.source`, issues, authoritativePhotoId);
  if (typeof hole !== "number" || !Number.isInteger(hole) || hole < 1 || hole > 18) addIssue(issues, `${path}.hole`, "hole debe ser un entero entre 1 y 18.");
  if (par === undefined) addIssue(issues, `${path}.value`, "value debe ser un entero o null.");
  return typeof hole === "number" && Number.isInteger(hole) && hole >= 1 && hole <= 18
    && par !== undefined && confidence !== null && source
    ? { hole, value: par, confidence, source }
    : null;
}

function totalKindFrom(value: unknown): ScorecardTotalKind | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return normalized === "out" || normalized === "in" || normalized === "total" ? normalized : null;
}

function totalObservationFrom(
  value: unknown,
  path: string,
  issues: ScorecardNormalizationIssue[],
  authoritativePhotoId?: string,
): ScorecardTotalObservation | null {
  if (!isRecord(value)) {
    addIssue(issues, path, "El total debe ser un objeto.");
    return null;
  }
  const playerName = nonEmptyString(value.playerName);
  const kind = totalKindFrom(value.kind);
  const total = integerOrNull(value.value);
  const confidence = confidenceFrom(value.confidence, `${path}.confidence`, issues);
  const source = sourceFrom(value.source, `${path}.source`, issues, authoritativePhotoId);
  if (!playerName) addIssue(issues, `${path}.playerName`, "playerName no puede estar vacío.");
  if (!kind) addIssue(issues, `${path}.kind`, "kind debe ser OUT, IN o TOTAL.");
  if (total === undefined) addIssue(issues, `${path}.value`, "value debe ser un entero o null.");
  return playerName && kind && total !== undefined && confidence !== null && source
    ? { playerName, kind, value: total, confidence, source }
    : null;
}

function listFrom<T>(
  value: unknown,
  path: string,
  issues: ScorecardNormalizationIssue[],
  parser: (item: unknown, itemPath: string, issues: ScorecardNormalizationIssue[]) => T | null,
  required = false,
) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) {
    addIssue(issues, path, `${path} debe ser una lista${required ? " obligatoria" : ""}.`);
    return [];
  }
  return value.map((item, index) => parser(item, `${path}[${index}]`, issues)).filter((item): item is T => item !== null);
}

/** Strictly normalizes one provider payload. Any malformed field rejects the whole payload. */
export function normalizeScorecardExtraction(input: unknown, authoritativePhotoId?: string): ScorecardNormalizationResult {
  const issues: ScorecardNormalizationIssue[] = [];
  if (!isRecord(input)) return { ok: false, extraction: null, issues: [{ path: "$", message: "La extracción debe ser un objeto." }] };
  if (input.version !== SCORECARD_EXTRACTION_VERSION) addIssue(issues, "version", `version debe ser ${SCORECARD_EXTRACTION_VERSION}.`);

  let course: ScorecardTextObservation | null = null;
  if (input.course !== undefined && input.course !== null) course = textObservationFrom(input.course, "course", issues, authoritativePhotoId);
  const inputCourses = listFrom(input.courses, "courses", issues, (item, path, listIssues) => textObservationFrom(item, path, listIssues, authoritativePhotoId));
  const players = listFrom(input.players, "players", issues, (item, path, listIssues) => playerObservationFrom(item, path, listIssues, authoritativePhotoId));
  const cells = listFrom(input.cells, "cells", issues, (item, path, listIssues) => cellObservationFrom(item, path, listIssues, authoritativePhotoId), true);
  const pars = listFrom(input.pars, "pars", issues, (item, path, listIssues) => parObservationFrom(item, path, listIssues, authoritativePhotoId));
  const totals = listFrom(input.totals, "totals", issues, (item, path, listIssues) => totalObservationFrom(item, path, listIssues, authoritativePhotoId));

  if (issues.length) return { ok: false, extraction: null, issues };
  const courses = [...new Map([
    ...(course ? [course] : []),
    ...inputCourses,
  ].map((item) => [`${item.source.photoId}:${item.value}`, item])).values()];
  course = [...courses].sort((left, right) => right.confidence - left.confidence)[0] ?? null;
  const sourceIds = [...new Set([
    ...(authoritativePhotoId ? [authoritativePhotoId] : []),
    ...courses.map((item) => item.source.photoId),
    ...players.map((item) => item.source.photoId),
    ...cells.map((item) => item.source.photoId),
    ...pars.map((item) => item.source.photoId),
    ...totals.map((item) => item.source.photoId),
  ])];
  if (!sourceIds.length) return { ok: false, extraction: null, issues: [{ path: "source", message: "La extracción no identifica ninguna foto." }] };

  return {
    ok: true,
    extraction: { version: SCORECARD_EXTRACTION_VERSION, sourceIds, course, courses, players, cells, pars, totals },
    issues: [],
  };
}

/** Preserves all cell evidence; duplicate/conflicting observations are resolved only by the validator. */
export function mergeScorecardExtractions(extractions: readonly ScorecardExtraction[]): ScorecardExtraction {
  const courses = [...new Map(extractions.flatMap((item) => item.courses?.length ? item.courses : item.course ? [item.course] : [])
    .map((item) => [`${item.source.photoId}:${item.value}`, item])).values()];
  const course = [...courses].sort((left, right) => right.confidence - left.confidence)[0] ?? null;
  return {
    version: SCORECARD_EXTRACTION_VERSION,
    sourceIds: [...new Set(extractions.flatMap((item) => item.sourceIds))],
    course,
    courses,
    players: extractions.flatMap((item) => item.players),
    cells: extractions.flatMap((item) => item.cells),
    pars: extractions.flatMap((item) => item.pars),
    totals: extractions.flatMap((item) => item.totals),
  };
}

/** Normalizes multiple photos with their caller-controlled IDs and then merges their evidence. */
export function normalizeScorecardPhotoExtractions(inputs: readonly ScorecardPhotoExtractionInput[]): ScorecardNormalizationResult {
  if (!inputs.length) return { ok: false, extraction: null, issues: [{ path: "$", message: "Se requiere al menos una foto." }] };
  const normalized: ScorecardExtraction[] = [];
  const issues: ScorecardNormalizationIssue[] = [];
  const seen = new Set<string>();
  inputs.forEach((input, index) => {
    const photoId = nonEmptyString(input.photoId, 240);
    if (!photoId) {
      addIssue(issues, `[${index}].photoId`, "photoId es obligatorio.");
      return;
    }
    if (seen.has(photoId)) {
      addIssue(issues, `[${index}].photoId`, "Cada foto debe tener un photoId único.");
      return;
    }
    seen.add(photoId);
    const result = normalizeScorecardExtraction(input.payload, photoId);
    if (!result.ok) {
      issues.push(...result.issues.map((issue) => ({ ...issue, path: `[${index}].payload.${issue.path}` })));
      return;
    }
    normalized.push(result.extraction);
  });
  return issues.length
    ? { ok: false, extraction: null, issues }
    : { ok: true, extraction: mergeScorecardExtractions(normalized), issues: [] };
}
