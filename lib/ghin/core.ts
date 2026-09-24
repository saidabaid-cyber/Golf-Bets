/**
 * Pure GHIN normalization and request-control primitives.
 *
 * This module deliberately has no transport, environment, logging, or
 * `server-only` dependency. Callers own authentication and HTTP concerns.
 */

type UnknownRecord = Record<string, unknown>;

export type NormalizedGhinStatus = "active" | "inactive" | "unknown";

export type NormalizedGhinGolfer = {
  ghinNumber: string;
  externalPlayerId: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  clubName: string | null;
  associationName: string | null;
  handicapIndex: number | null;
  status: NormalizedGhinStatus;
  rawStatus: string | null;
  isActive: boolean | null;
  updatedAt: string | null;
};

export type NormalizedGhinScore = {
  id: string | null;
  playedOn: string | null;
  courseId: string | null;
  courseName: string | null;
  teeId: string | null;
  teeName: string | null;
  grossScore: number | null;
  adjustedGrossScore: number | null;
  differential: number | null;
  courseRating: number | null;
  slopeRating: number | null;
  scoreType: string | null;
  postingMethod: string | null;
  holes: number | null;
};

export type NormalizedGhinHole = {
  number: number;
  par: number | null;
  yardage: number | null;
  strokeIndex: number | null;
};

export type NormalizedGhinTee = {
  id: string | null;
  name: string | null;
  gender: string | null;
  holes: number | null;
  par: number | null;
  courseRating: number | null;
  slopeRating: number | null;
  totalYards: number | null;
  frontRating: number | null;
  frontSlope: number | null;
  backRating: number | null;
  backSlope: number | null;
  holeData: NormalizedGhinHole[];
};

export type NormalizedGhinCourse = {
  id: string | null;
  facilityId: string | null;
  name: string | null;
  facilityName: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  holes: number | null;
  status: NormalizedGhinStatus;
  rawStatus: string | null;
  tees: NormalizedGhinTee[];
};

export type NormalizedGhinToken = {
  accessToken: string;
  tokenType: "Bearer";
  /** Epoch milliseconds when supplied by the provider; null means unknown. */
  expiresAt: number | null;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/** Reads aliases in priority order while preserving an explicitly null value. */
function field(record: UnknownRecord, aliases: readonly string[]): unknown {
  const entries = Object.entries(record);
  for (const alias of aliases) {
    const wanted = normalizeKey(alias);
    const match = entries.find(([key]) => normalizeKey(key) === wanted);
    if (match) return match[1];
  }
  return undefined;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function identifier(value: unknown): string | null {
  const stringValue = text(value);
  if (stringValue !== null) return stringValue;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)$/.test(trimmed)
    ? Number(trimmed.replace(/,/g, ""))
    : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function integer(value: unknown, minimum = Number.MIN_SAFE_INTEGER): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= minimum ? parsed : null;
}

function boolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || (typeof value === "string" && /^(true|yes|y|1)$/i.test(value.trim()))) return true;
  if (value === 0 || (typeof value === "string" && /^(false|no|n|0)$/i.test(value.trim()))) return false;
  return null;
}

function childRecord(record: UnknownRecord, aliases: readonly string[]): UnknownRecord | null {
  const candidate = field(record, aliases);
  return isRecord(candidate) ? candidate : null;
}

const ENVELOPE_KEYS = ["data", "result", "response", "payload"] as const;

function entityRecord(payload: unknown, aliases: readonly string[], depth = 0): UnknownRecord | null {
  if (depth > 5) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (isRecord(item)) return item;
    }
    return null;
  }
  if (!isRecord(payload)) return null;

  for (const alias of aliases) {
    const candidate = field(payload, [alias]);
    if (isRecord(candidate)) return candidate;
    if (Array.isArray(candidate)) {
      const first = candidate.find(isRecord);
      if (first) return first;
    }
  }
  for (const envelope of ENVELOPE_KEYS) {
    const nested = field(payload, [envelope]);
    if (nested !== undefined && nested !== null) {
      const found = entityRecord(nested, aliases, depth + 1);
      if (found) return found;
    }
  }
  return payload;
}

function findCollection(payload: unknown, aliases: readonly string[], depth = 0): unknown[] | null {
  if (depth > 5) return null;
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return null;

  for (const alias of aliases) {
    const candidate = field(payload, [alias]);
    if (Array.isArray(candidate)) return candidate;
    if (isRecord(candidate)) return [candidate];
  }
  for (const envelope of ENVELOPE_KEYS) {
    const nested = field(payload, [envelope]);
    if (nested !== undefined && nested !== null) {
      const found = findCollection(nested, aliases, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function records(payload: unknown, aliases: readonly string[]): UnknownRecord[] {
  const collection = findCollection(payload, aliases);
  if (collection) return collection.filter(isRecord);
  return isRecord(payload) ? [payload] : [];
}

function statusDetails(record: UnknownRecord): {
  status: NormalizedGhinStatus;
  rawStatus: string | null;
  isActive: boolean | null;
} {
  const rawValue = field(record, ["status", "golfer_status", "membership_status", "course_status", "active_status"]);
  const rawStatus = text(rawValue);
  const inactive = boolean(field(record, ["is_inactive", "inactive", "disabled"]));
  const active = boolean(field(record, ["is_active", "active", "enabled"]));
  const normalized = normalizeKey(rawStatus ?? "");

  let status: NormalizedGhinStatus = "unknown";
  if (
    inactive === true
    || active === false
    || ["i", "inactive", "disabled", "suspended", "revoked", "terminated", "deceased"].includes(normalized)
  ) {
    status = "inactive";
  } else if (
    active === true
    || ["a", "active", "current", "enabled", "goodstanding"].includes(normalized)
  ) {
    status = "active";
  }

  return { status, rawStatus, isActive: status === "active" ? true : status === "inactive" ? false : null };
}

export function parseGhinStatus(payload: unknown): NormalizedGhinStatus {
  return isRecord(payload) ? statusDetails(payload).status : "unknown";
}

/**
 * Converts a GHIN display index into calculation semantics. A leading `+`
 * denotes a plus handicap and is therefore represented as a negative number.
 */
export function parseGhinHandicapIndex(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const noHandicap = normalizeKey(trimmed);
  if (["nh", "nohandicap", "notestablished", "unestablished", "none"].includes(noHandicap)) return null;
  const parsed = finiteNumber(trimmed);
  if (parsed === null) return null;
  if (trimmed.startsWith("+")) return parsed === 0 ? 0 : -Math.abs(parsed);
  return parsed;
}

export function parseGhinGolfer(payload: unknown): NormalizedGhinGolfer | null {
  const record = entityRecord(payload, ["golfer", "golfers", "player", "players"]);
  if (!record) return null;

  const ghinNumber = identifier(field(record, ["ghin_number", "ghin", "ghin_no", "ghin_id", "handicap_id"]));
  if (!ghinNumber) return null;

  const firstName = text(field(record, ["first_name", "firstname", "given_name"]));
  const lastName = text(field(record, ["last_name", "lastname", "surname", "family_name"]));
  const joinedName = [firstName, lastName].filter((value): value is string => value !== null).join(" ") || null;
  const club = childRecord(record, ["club", "golf_club", "primary_club"]);
  const association = childRecord(record, ["association", "golf_association"]);
  const status = statusDetails(record);

  return {
    ghinNumber,
    externalPlayerId: identifier(field(record, ["golfer_id", "player_id", "user_id", "id"])),
    name: text(field(record, ["name", "full_name", "display_name", "golfer_name"])) ?? joinedName,
    firstName,
    lastName,
    clubName: text(field(record, ["club_name", "golf_club_name", "primary_club_name"]))
      ?? (club ? text(field(club, ["name", "club_name"])) : null),
    associationName: text(field(record, ["association_name", "golf_association_name"]))
      ?? (association ? text(field(association, ["name", "association_name"])) : null),
    handicapIndex: parseGhinHandicapIndex(field(record, ["handicap_index", "handicapindex", "current_handicap_index", "hi"])),
    ...status,
    updatedAt: text(field(record, ["handicap_updated_at", "updated_at", "revision_date", "effective_date", "as_of_date"])),
  };
}

export function parseGhinGolfers(payload: unknown): NormalizedGhinGolfer[] {
  return records(payload, ["golfers", "players"])
    .map((record) => parseGhinGolfer(record))
    .filter((golfer): golfer is NormalizedGhinGolfer => golfer !== null);
}

function scoreHoles(record: UnknownRecord): number | null {
  const explicit = integer(field(record, ["holes_played", "number_of_holes", "hole_count"]), 1);
  if (explicit !== null) return explicit;
  const holesValue = field(record, ["holes", "hole_scores", "scores_by_hole"]);
  if (Array.isArray(holesValue)) return holesValue.length || null;
  return integer(holesValue, 1);
}

export function parseGhinScore(payload: unknown): NormalizedGhinScore | null {
  const record = entityRecord(payload, ["score", "scores"]);
  if (!record) return null;

  const normalized: NormalizedGhinScore = {
    id: identifier(field(record, ["score_id", "id", "score_uid"])),
    playedOn: text(field(record, ["played_on", "date_played", "score_day", "score_date", "played_at", "date"])),
    courseId: identifier(field(record, ["course_id", "ghin_course_id"])),
    courseName: text(field(record, ["course_name", "golf_course_name", "facility_name"])),
    teeId: identifier(field(record, ["tee_set_id", "tee_id", "tee_set_rating_id"])),
    teeName: text(field(record, ["tee_name", "tee_set_name", "tee_color"])),
    grossScore: finiteNumber(field(record, ["gross_score", "total_score", "score"])),
    adjustedGrossScore: finiteNumber(field(record, ["adjusted_gross_score", "adjusted_score", "ags"])),
    differential: finiteNumber(field(record, ["score_differential", "differential"])),
    courseRating: finiteNumber(field(record, ["course_rating", "rating"])),
    slopeRating: finiteNumber(field(record, ["slope_rating", "slope"])),
    scoreType: text(field(record, ["score_type", "type"])),
    postingMethod: text(field(record, ["posting_method", "post_method", "method"])),
    holes: scoreHoles(record),
  };

  const hasIdentity = normalized.id !== null || normalized.playedOn !== null || normalized.courseName !== null;
  const hasScore = normalized.grossScore !== null || normalized.adjustedGrossScore !== null || normalized.differential !== null;
  return hasIdentity || hasScore ? normalized : null;
}

export function parseGhinScores(payload: unknown): NormalizedGhinScore[] {
  return records(payload, ["scores", "score_history", "posted_scores"])
    .map((record) => parseGhinScore(record))
    .filter((score): score is NormalizedGhinScore => score !== null);
}

export function parseGhinHole(payload: unknown): NormalizedGhinHole | null {
  const record = entityRecord(payload, ["hole"]);
  if (!record) return null;
  const number = integer(field(record, ["hole_number", "number", "hole_no", "sequence", "hole"]), 1);
  if (number === null) return null;
  return {
    number,
    par: integer(field(record, ["par"]), 1),
    yardage: integer(field(record, ["yardage", "yards", "length", "distance"]), 0),
    strokeIndex: integer(field(record, ["stroke_index", "handicap_allocation", "allocation", "handicap", "hcp"]), 1),
  };
}

export function parseGhinHoles(payload: unknown): NormalizedGhinHole[] {
  return records(payload, ["holes", "hole_data", "hole_details"])
    .map((record) => parseGhinHole(record))
    .filter((hole): hole is NormalizedGhinHole => hole !== null)
    .sort((left, right) => left.number - right.number);
}

type RatingCandidate = { record: UnknownRecord; label: string };

function ratingCandidates(record: UnknownRecord): RatingCandidate[] {
  const source = field(record, ["ratings", "tee_set_ratings", "rating_values"]);
  if (Array.isArray(source)) {
    return source.filter(isRecord).map((candidate) => ({
      record: candidate,
      label: text(field(candidate, ["rating_type", "type", "name", "holes"] )) ?? "",
    }));
  }
  if (!isRecord(source)) return [];

  const nested = Object.entries(source)
    .filter((entry): entry is [string, UnknownRecord] => isRecord(entry[1]))
    .map(([label, candidate]) => ({ record: candidate, label }));
  return nested.length ? nested : [{ record: source, label: text(field(source, ["rating_type", "type", "name"])) ?? "" }];
}

function segmentedRating(candidates: readonly RatingCandidate[], segment: "total" | "front" | "back"): RatingCandidate | null {
  const matches = (label: string) => {
    const normalized = normalizeKey(label);
    if (segment === "front") return /front|first|out|holes?1to9|9front/.test(normalized);
    if (segment === "back") return /back|second|in|holes?10to18|9back/.test(normalized);
    return /total|overall|full|18hole|all/.test(normalized);
  };
  const explicit = candidates.find((candidate) => matches(candidate.label));
  if (explicit) return explicit;
  if (segment === "total" && candidates.length === 1 && !/front|back|first|second|out|9front|9back/.test(normalizeKey(candidates[0].label))) {
    return candidates[0];
  }
  return null;
}

function completeSum(values: readonly (number | null)[]): number | null {
  return values.length > 0 && values.every((value): value is number => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

function ratingNumber(candidate: RatingCandidate | null, aliases: readonly string[]): number | null {
  return candidate ? finiteNumber(field(candidate.record, aliases)) : null;
}

export function parseGhinTee(payload: unknown): NormalizedGhinTee | null {
  const record = entityRecord(payload, ["tee", "tee_set", "tee_set_rating"]);
  if (!record) return null;
  const candidates = ratingCandidates(record);
  const total = segmentedRating(candidates, "total");
  const front = segmentedRating(candidates, "front");
  const back = segmentedRating(candidates, "back");
  const holeData = parseGhinHoles(record);
  const id = identifier(field(record, ["tee_set_rating_id", "tee_set_id", "tee_id", "rating_id", "id"]));
  const name = text(field(record, ["tee_set_name", "tee_name", "name", "color"]));
  const explicitHoles = integer(field(record, ["number_of_holes", "holes_number", "hole_count", "holes"]), 1);
  const explicitPar = integer(field(record, ["par", "total_par"]), 1);
  const explicitYards = integer(field(record, ["total_yardage", "total_yards", "yardage", "yards", "length"]), 0);

  const tee: NormalizedGhinTee = {
    id,
    name,
    gender: text(field(record, ["gender", "gender_code", "tee_gender"])),
    holes: explicitHoles ?? (holeData.length ? holeData.length : null),
    par: explicitPar ?? completeSum(holeData.map((hole) => hole.par)),
    courseRating: finiteNumber(field(record, ["course_rating", "rating"]))
      ?? ratingNumber(total, ["course_rating", "rating"]),
    slopeRating: finiteNumber(field(record, ["slope_rating", "slope"]))
      ?? ratingNumber(total, ["slope_rating", "slope"]),
    totalYards: explicitYards ?? completeSum(holeData.map((hole) => hole.yardage)),
    frontRating: finiteNumber(field(record, ["front_rating", "front_course_rating", "out_rating"]))
      ?? ratingNumber(front, ["course_rating", "rating"]),
    frontSlope: finiteNumber(field(record, ["front_slope", "front_slope_rating", "out_slope"]))
      ?? ratingNumber(front, ["slope_rating", "slope"]),
    backRating: finiteNumber(field(record, ["back_rating", "back_course_rating", "in_rating"]))
      ?? ratingNumber(back, ["course_rating", "rating"]),
    backSlope: finiteNumber(field(record, ["back_slope", "back_slope_rating", "in_slope"]))
      ?? ratingNumber(back, ["slope_rating", "slope"]),
    holeData,
  };

  const hasRating = tee.courseRating !== null || tee.slopeRating !== null || tee.par !== null || tee.totalYards !== null;
  return id !== null || name !== null || hasRating || holeData.length > 0 ? tee : null;
}

export function parseGhinTees(payload: unknown): NormalizedGhinTee[] {
  return records(payload, ["tees", "tee_sets", "tee_set_ratings", "ratings_by_tee"])
    .map((record) => parseGhinTee(record))
    .filter((tee): tee is NormalizedGhinTee => tee !== null);
}

export function parseGhinCourse(payload: unknown): NormalizedGhinCourse | null {
  const record = entityRecord(payload, ["course", "courses"]);
  if (!record) return null;
  const facility = childRecord(record, ["facility", "golf_facility"]);
  const location = childRecord(record, ["address", "location"])
    ?? (facility ? childRecord(facility, ["address", "location"]) : null);
  const id = identifier(field(record, ["course_id", "ghin_course_id", "id"]));
  const name = text(field(record, ["course_name", "name"]));
  if (id === null && name === null) return null;
  const status = statusDetails(record);
  const holesValue = field(record, ["number_of_holes", "holes_number", "hole_count", "holes"]);
  const holes = Array.isArray(holesValue) ? holesValue.length || null : integer(holesValue, 1);
  const teeCollection = findCollection(record, ["tees", "tee_sets", "tee_set_ratings", "ratings_by_tee"]);

  return {
    id,
    facilityId: identifier(field(record, ["facility_id", "golf_facility_id"]))
      ?? (facility ? identifier(field(facility, ["facility_id", "id"])) : null),
    name,
    facilityName: text(field(record, ["facility_name", "golf_facility_name", "club_name"]))
      ?? (facility ? text(field(facility, ["facility_name", "name"])) : null),
    city: text(field(record, ["city"])) ?? (location ? text(field(location, ["city"])) : null),
    state: text(field(record, ["state", "state_region", "province", "region"]))
      ?? (location ? text(field(location, ["state", "state_region", "province", "region"])) : null),
    country: text(field(record, ["country", "country_name", "country_code"]))
      ?? (location ? text(field(location, ["country", "country_name", "country_code"])) : null),
    holes,
    ...status,
    tees: teeCollection
      ? teeCollection.map((tee) => parseGhinTee(tee)).filter((tee): tee is NormalizedGhinTee => tee !== null)
      : [],
  };
}

export function parseGhinCourses(payload: unknown): NormalizedGhinCourse[] {
  return records(payload, ["courses", "golf_courses"])
    .map((record) => parseGhinCourse(record))
    .filter((course): course is NormalizedGhinCourse => course !== null);
}

const TOKEN_KEYS = ["golfer_user_token", "access_token", "bearer_token", "auth_token", "token"] as const;
const TOKEN_CONTAINER_KEYS = new Set([
  ...ENVELOPE_KEYS.map(normalizeKey),
  "user",
  "golferuser",
  "auth",
  "authentication",
  "session",
]);

function tokenText(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const withoutScheme = candidate.replace(/^Bearer\s+/i, "").trim();
  if (!withoutScheme || /^(null|undefined)$/i.test(withoutScheme) || withoutScheme.length > 16_384) return null;
  return withoutScheme;
}

function findToken(payload: unknown, depth = 0): string | null {
  if (depth > 6) return null;
  if (typeof payload === "string") return tokenText(payload);
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const candidate = findToken(item, depth + 1);
      if (candidate) return candidate;
    }
    return null;
  }
  if (!isRecord(payload)) return null;

  for (const key of TOKEN_KEYS) {
    const candidate = field(payload, [key]);
    const parsed = tokenText(candidate);
    if (parsed) return parsed;
    if (isRecord(candidate)) {
      const nested = findToken(candidate, depth + 1);
      if (nested) return nested;
    }
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!TOKEN_CONTAINER_KEYS.has(normalizeKey(key))) continue;
    const candidate = findToken(value, depth + 1);
    if (candidate) return candidate;
  }
  return null;
}

/** Extracts only allowlisted token fields and never searches credential/password fields. */
export function extractGhinToken(payload: unknown): string | null {
  return findToken(payload);
}

function nestedScalar(payload: unknown, aliases: readonly string[], depth = 0): unknown {
  if (depth > 6 || !isRecord(payload)) return undefined;
  for (const alias of aliases) {
    const candidate = field(payload, [alias]);
    if (candidate !== undefined) return candidate;
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!TOKEN_CONTAINER_KEYS.has(normalizeKey(key))) continue;
    const candidate = nestedScalar(value, aliases, depth + 1);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

function epochMilliseconds(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric !== null && numeric >= 0) return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  const stringValue = text(value);
  if (!stringValue) return null;
  const parsed = Date.parse(stringValue);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseGhinToken(payload: unknown, now = Date.now()): NormalizedGhinToken | null {
  const accessToken = extractGhinToken(payload);
  if (!accessToken) return null;
  const absoluteExpiry = epochMilliseconds(nestedScalar(payload, ["expires_at", "expiration", "expiration_time"]));
  const expiresIn = finiteNumber(nestedScalar(payload, ["expires_in", "expires_in_seconds", "ttl"]));
  const expiresAt = absoluteExpiry ?? (expiresIn !== null && expiresIn >= 0 ? now + expiresIn * 1_000 : null);
  return { accessToken, tokenType: "Bearer", expiresAt };
}

/** Parses untrusted response text without throwing. */
export function safeJsonParse(value: string): unknown | null {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export type GhinErrorCode =
  | "invalid_credentials"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "inactive_golfer"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "invalid_response"
  | "unknown";

export type NormalizedGhinError = {
  code: GhinErrorCode;
  message: string;
  httpStatus: number | null;
  retryable: boolean;
};

const SAFE_ERROR_MESSAGES: Record<GhinErrorCode, string> = {
  invalid_credentials: "GHIN rechazó las credenciales.",
  unauthorized: "La sesión de GHIN no está autorizada o expiró.",
  forbidden: "GHIN no autorizó esta operación.",
  not_found: "GHIN no encontró el recurso solicitado.",
  inactive_golfer: "El jugador GHIN está inactivo.",
  rate_limited: "GHIN limitó temporalmente las consultas.",
  timeout: "GHIN no respondió a tiempo.",
  unavailable: "GHIN no está disponible temporalmente.",
  invalid_response: "GHIN devolvió una respuesta no reconocida.",
  unknown: "No se pudo completar la consulta a GHIN.",
};

function errorStatus(input: unknown): number | null {
  if (!isRecord(input)) return null;
  const candidate = integer(field(input, ["http_status", "status_code", "status"]), 100);
  return candidate !== null && candidate <= 599 ? candidate : null;
}

function errorClassifierText(input: unknown): string {
  if (input instanceof Error) return `${input.name} ${input.message}`.toLowerCase();
  if (typeof input === "string") return input.toLowerCase();
  if (!isRecord(input)) return "";
  return [field(input, ["name"]), field(input, ["code"]), field(input, ["error"]), field(input, ["message"])]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

/** Maps an untrusted failure to a fixed, secret-free public error. */
export function normalizeGhinError(input: unknown, suppliedHttpStatus?: number): NormalizedGhinError {
  const embeddedStatus = errorStatus(input);
  const httpStatus = Number.isInteger(suppliedHttpStatus) && (suppliedHttpStatus as number) >= 100 && (suppliedHttpStatus as number) <= 599
    ? suppliedHttpStatus as number
    : embeddedStatus;
  const classifier = errorClassifierText(input);
  let code: GhinErrorCode;

  if (/inactive|suspended|deactivated/.test(classifier)) code = "inactive_golfer";
  else if (/(?:invalid|incorrect).{0,20}(credential|password|login)|bad.{0,10}(credential|password)/.test(classifier)) code = "invalid_credentials";
  else if (/aborterror|timeout|timed out|etimedout/.test(classifier) || httpStatus === 408 || httpStatus === 504) code = "timeout";
  else if (httpStatus === 401) code = "unauthorized";
  else if (httpStatus === 403) code = "forbidden";
  else if (httpStatus === 404) code = "not_found";
  else if (httpStatus === 429) code = "rate_limited";
  else if (httpStatus !== null && httpStatus >= 500) code = "unavailable";
  else if (/json|parse|malformed|invalid response|unexpected response/.test(classifier)) code = "invalid_response";
  else code = "unknown";

  return {
    code,
    message: SAFE_ERROR_MESSAGES[code],
    httpStatus,
    retryable: code === "rate_limited" || code === "timeout" || code === "unavailable",
  };
}

type TtlCacheEntry<Value> =
  | { kind: "value"; value: Value; expiresAt: number }
  | { kind: "pending"; promise: Promise<Value>; marker: symbol };

export type TtlPromiseCacheOptions = {
  ttlMs: number;
  now?: () => number;
};

function validDuration(value: number, label: string, allowZero: boolean) {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError(`${label} must be ${allowZero ? "non-negative" : "positive"} and finite.`);
  }
  return value;
}

/** In-memory TTL cache that shares one loader promise for concurrent callers. */
export class TtlPromiseCache<Key, Value> {
  private readonly entries = new Map<Key, TtlCacheEntry<Value>>();
  private readonly defaultTtlMs: number;
  private readonly clock: () => number;

  constructor(options: TtlPromiseCacheOptions);
  constructor(ttlMs: number, now?: () => number);
  constructor(optionsOrTtl: TtlPromiseCacheOptions | number, now: () => number = Date.now) {
    const options = typeof optionsOrTtl === "number" ? { ttlMs: optionsOrTtl, now } : optionsOrTtl;
    this.defaultTtlMs = validDuration(options.ttlMs, "ttlMs", true);
    this.clock = options.now ?? Date.now;
  }

  private currentTime() {
    const current = this.clock();
    if (!Number.isFinite(current)) throw new RangeError("now() must return a finite number.");
    return current;
  }

  get(key: Key, loader: () => Promise<Value> | Value, ttlMs = this.defaultTtlMs): Promise<Value> {
    const resolvedTtl = validDuration(ttlMs, "ttlMs", true);
    const current = this.entries.get(key);
    const now = this.currentTime();
    if (current?.kind === "value") {
      if (current.expiresAt > now) return Promise.resolve(current.value);
      this.entries.delete(key);
    } else if (current?.kind === "pending") {
      return current.promise;
    }

    const marker = Symbol("ttl-cache-load");
    const pending = Promise.resolve()
      .then(loader)
      .then(
        (value) => {
          const latest = this.entries.get(key);
          if (latest?.kind === "pending" && latest.marker === marker) {
            if (resolvedTtl === 0) this.entries.delete(key);
            else this.entries.set(key, { kind: "value", value, expiresAt: this.currentTime() + resolvedTtl });
          }
          return value;
        },
        (error: unknown) => {
          const latest = this.entries.get(key);
          if (latest?.kind === "pending" && latest.marker === marker) this.entries.delete(key);
          throw error;
        },
      );
    this.entries.set(key, { kind: "pending", promise: pending, marker });
    return pending;
  }

  getOrLoad(key: Key, loader: () => Promise<Value> | Value, ttlMs = this.defaultTtlMs): Promise<Value> {
    return this.get(key, loader, ttlMs);
  }

  set(key: Key, value: Value, ttlMs = this.defaultTtlMs): Value {
    const resolvedTtl = validDuration(ttlMs, "ttlMs", true);
    if (resolvedTtl === 0) this.entries.delete(key);
    else this.entries.set(key, { kind: "value", value, expiresAt: this.currentTime() + resolvedTtl });
    return value;
  }

  peek(key: Key): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.kind === "pending") return undefined;
    if (entry.expiresAt <= this.currentTime()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: Key): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.kind === "pending") return true;
    if (entry.expiresAt > this.currentTime()) return true;
    this.entries.delete(key);
    return false;
  }

  delete(key: Key): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    const now = this.currentTime();
    for (const [key, entry] of this.entries) {
      if (entry.kind === "value" && entry.expiresAt <= now) this.entries.delete(key);
    }
    return this.entries.size;
  }
}

export type SlidingWindowRateLimiterOptions = {
  limit: number;
  windowMs: number;
  now?: () => number;
};

export type SlidingWindowRateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  resetAt: number;
};

/** Deterministic per-key sliding-window limiter with an injectable clock. */
export class SlidingWindowRateLimiter<Key> {
  private readonly attempts = new Map<Key, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: () => number;

  constructor(options: SlidingWindowRateLimiterOptions);
  constructor(limit: number, windowMs: number, now?: () => number);
  constructor(optionsOrLimit: SlidingWindowRateLimiterOptions | number, windowMs?: number, now: () => number = Date.now) {
    const options = typeof optionsOrLimit === "number"
      ? { limit: optionsOrLimit, windowMs: windowMs as number, now }
      : optionsOrLimit;
    if (!Number.isInteger(options.limit) || options.limit <= 0) throw new RangeError("limit must be a positive integer.");
    this.limit = options.limit;
    this.windowMs = validDuration(options.windowMs, "windowMs", false);
    this.clock = options.now ?? Date.now;
  }

  private currentTime(at?: number) {
    const current = at ?? this.clock();
    if (!Number.isFinite(current)) throw new RangeError("now must be finite.");
    return current;
  }

  private activeAttempts(key: Key, now: number) {
    const cutoff = now - this.windowMs;
    const active = (this.attempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (active.length) this.attempts.set(key, active);
    else this.attempts.delete(key);
    return active;
  }

  consume(key: Key, at?: number): SlidingWindowRateLimitDecision {
    const now = this.currentTime(at);
    const active = this.activeAttempts(key, now);
    if (active.length >= this.limit) {
      const resetAt = active[0] + this.windowMs;
      return { allowed: false, limit: this.limit, remaining: 0, retryAfterMs: Math.max(0, resetAt - now), resetAt };
    }

    active.push(now);
    this.attempts.set(key, active);
    const resetAt = active[0] + this.windowMs;
    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - active.length,
      retryAfterMs: 0,
      resetAt,
    };
  }

  attempt(key: Key, at?: number): SlidingWindowRateLimitDecision {
    return this.consume(key, at);
  }

  reset(key: Key): boolean {
    return this.attempts.delete(key);
  }

  clear(): void {
    this.attempts.clear();
  }

  get size(): number {
    const now = this.currentTime();
    for (const key of this.attempts.keys()) this.activeAttempts(key, now);
    return this.attempts.size;
  }
}
