import type { Course, Hole } from "./types";

export type CourseCatalogIssueSeverity = "error" | "warning";

export type CourseCatalogIssueCode =
  | "invalid_record"
  | "missing_id"
  | "missing_name"
  | "missing_tee_name"
  | "duplicate_id"
  | "unsupported_hole_count"
  | "invalid_hole_number"
  | "duplicate_hole_number"
  | "invalid_par"
  | "invalid_stroke_index"
  | "duplicate_stroke_index"
  | "invalid_yardage"
  | "invalid_rating"
  | "invalid_slope"
  | "invalid_total_yardage"
  | "total_yardage_mismatch";

export type CourseCatalogIssue = {
  code: CourseCatalogIssueCode;
  severity: CourseCatalogIssueSeverity;
  message: string;
  selectionId?: string;
  holeNumber?: number;
};

/**
 * Provider-neutral course entities. The current app still persists one legacy
 * `Course` per playable tee; this read model separates course, tee, holes and
 * tee yardages without rewriting existing drafts or historical snapshots.
 */
export type GolfCourseRecord = {
  id: string;
  name: string;
  holesCount: 9 | 18;
  par: number;
  active: boolean;
  source: "built_in" | "manual";
  updatedAt?: string;
  club?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
};

export type CourseTeeRecord = {
  id: string;
  courseId: string;
  name: string;
  color?: string;
  category?: string;
  rating?: number;
  slope?: number;
  totalYardage?: number;
  yardageSource?: "declared" | "holes";
};

export type CourseHoleRecord = {
  courseId: string;
  holeNumber: number;
  par: number;
  strokeIndex: number;
};

export type TeeHoleYardageRecord = {
  teeId: string;
  holeNumber: number;
  yardage: number;
};

export type InternalCourseCatalogEntry = {
  selectionId: string;
  sourceCourse: Course;
  playable: boolean;
  course?: GolfCourseRecord;
  tee?: CourseTeeRecord;
  holes: CourseHoleRecord[];
  teeHoleYardages: TeeHoleYardageRecord[];
  issues: CourseCatalogIssue[];
};

export type InternalCourseCatalog = {
  entries: InternalCourseCatalogEntry[];
  courses: GolfCourseRecord[];
  tees: CourseTeeRecord[];
  holes: CourseHoleRecord[];
  teeHoleYardages: TeeHoleYardageRecord[];
  issues: CourseCatalogIssue[];
  playableCount: number;
  rejectedCount: number;
};

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function cleanOptionalDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  return Number.isNaN(Date.parse(trimmed)) ? undefined : trimmed;
}

function issue(
  code: CourseCatalogIssueCode,
  severity: CourseCatalogIssueSeverity,
  message: string,
  selectionId?: string,
  holeNumber?: number,
): CourseCatalogIssue {
  return {
    code,
    severity,
    message,
    ...(selectionId ? { selectionId } : {}),
    ...(holeNumber !== undefined ? { holeNumber } : {}),
  };
}

function holeNumberHint(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const number = Reflect.get(value, "number");
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
}

function inspectHoles(rawHoles: unknown, selectionId: string) {
  const issues: CourseCatalogIssue[] = [];
  if (!Array.isArray(rawHoles) || (rawHoles.length !== 9 && rawHoles.length !== 18)) {
    issues.push(issue("unsupported_hole_count", "error", "La tarjeta debe tener exactamente 9 o 18 hoyos.", selectionId));
    return { holesCount: null, holes: [] as Hole[], issues };
  }

  const holesCount = rawHoles.length as 9 | 18;
  const holes: Hole[] = [];
  const holeNumbers = new Set<number>();
  const strokeIndexes = new Set<number>();

  for (const rawHole of rawHoles) {
    const hint = holeNumberHint(rawHole);
    if (!rawHole || typeof rawHole !== "object") {
      issues.push(issue("invalid_hole_number", "error", "Hay un hoyo sin número válido.", selectionId, hint));
      continue;
    }

    const number = Reflect.get(rawHole, "number");
    const par = Reflect.get(rawHole, "par");
    const strokeIndex = Reflect.get(rawHole, "strokeIndex");
    const yards = Reflect.get(rawHole, "yards");
    let valid = true;

    if (!Number.isInteger(number) || (number as number) < 1 || (number as number) > 18) {
      issues.push(issue("invalid_hole_number", "error", "Cada hoyo necesita un número entero entre 1 y 18.", selectionId, hint));
      valid = false;
    } else if (holeNumbers.has(number as number)) {
      issues.push(issue("duplicate_hole_number", "error", `El hoyo ${number} está duplicado.`, selectionId, number as number));
      valid = false;
    } else {
      holeNumbers.add(number as number);
    }

    if (!Number.isInteger(par) || (par as number) < 3 || (par as number) > 6) {
      issues.push(issue("invalid_par", "error", "El par debe ser un entero entre 3 y 6.", selectionId, hint));
      valid = false;
    }

    if (!Number.isInteger(strokeIndex) || (strokeIndex as number) < 1 || (strokeIndex as number) > holesCount) {
      issues.push(issue("invalid_stroke_index", "error", `La Ventaja/SI debe estar entre 1 y ${holesCount}.`, selectionId, hint));
      valid = false;
    } else if (strokeIndexes.has(strokeIndex as number)) {
      issues.push(issue("duplicate_stroke_index", "error", `La Ventaja/SI ${strokeIndex} está duplicada.`, selectionId, hint));
      valid = false;
    } else {
      strokeIndexes.add(strokeIndex as number);
    }

    if (yards !== undefined && !finitePositive(yards)) {
      issues.push(issue("invalid_yardage", "warning", "La distancia del hoyo debe ser mayor que cero para poder mostrarla.", selectionId, hint));
    }

    if (valid) {
      holes.push({
        number: number as number,
        par: par as number,
        strokeIndex: strokeIndex as number,
        ...(finitePositive(yards) ? { yards } : {}),
      });
    }
  }

  const expectedNumbers = Array.from({ length: holesCount }, (_, index) => index + 1);
  if (!expectedNumbers.every((number) => holeNumbers.has(number))) {
    issues.push(issue("invalid_hole_number", "error", `La tarjeta debe contener una vez cada hoyo del 1 al ${holesCount}.`, selectionId));
  }
  if (!expectedNumbers.every((number) => strokeIndexes.has(number))) {
    issues.push(issue("invalid_stroke_index", "error", `La Ventaja/SI debe contener una vez cada valor del 1 al ${holesCount}.`, selectionId));
  }

  return { holesCount, holes: holes.sort((left, right) => left.number - right.number), issues };
}

export function inspectInternalCourse(value: unknown): InternalCourseCatalogEntry {
  if (!value || typeof value !== "object") {
    const invalidIssue = issue("invalid_record", "error", "El registro del campo no tiene un formato válido.");
    return {
      selectionId: "",
      sourceCourse: value as Course,
      playable: false,
      holes: [],
      teeHoleYardages: [],
      issues: [invalidIssue],
    };
  }

  const rawId = Reflect.get(value, "id");
  const rawName = Reflect.get(value, "name");
  const rawTeeName = Reflect.get(value, "teeName");
  const selectionId = typeof rawId === "string" ? rawId.trim() : "";
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const teeName = typeof rawTeeName === "string" ? rawTeeName.trim() : "";
  const issues: CourseCatalogIssue[] = [];

  if (!selectionId) issues.push(issue("missing_id", "error", "El campo no tiene un identificador válido."));
  if (!name) issues.push(issue("missing_name", "error", "Escribe el nombre del campo.", selectionId));
  if (!teeName) issues.push(issue("missing_tee_name", "error", "Escribe el nombre del tee.", selectionId));

  const inspectedHoles = inspectHoles(Reflect.get(value, "holes"), selectionId);
  issues.push(...inspectedHoles.issues);

  const rawRating = Reflect.get(value, "rating");
  const rawSlope = Reflect.get(value, "slope");
  const rawTotalYards = Reflect.get(value, "totalYards");
  if (rawRating !== undefined && !finitePositive(rawRating)) issues.push(issue("invalid_rating", "warning", "El rating no es un número positivo y no se mostrará.", selectionId));
  if (rawSlope !== undefined && !finitePositive(rawSlope)) issues.push(issue("invalid_slope", "warning", "El slope no es un número positivo y no se mostrará.", selectionId));
  if (rawTotalYards !== undefined && !finitePositive(rawTotalYards)) issues.push(issue("invalid_total_yardage", "warning", "El yardaje total no es válido y no se mostrará.", selectionId));

  const holeYardages = inspectedHoles.holes
    .filter((hole) => finitePositive(hole.yards))
    .map((hole) => ({ teeId: selectionId, holeNumber: hole.number, yardage: hole.yards as number }));
  const hasCompleteHoleYardage = inspectedHoles.holesCount !== null && holeYardages.length === inspectedHoles.holesCount;
  const summedYardage = hasCompleteHoleYardage
    ? holeYardages.reduce((total, record) => total + record.yardage, 0)
    : undefined;
  if (finitePositive(rawTotalYards) && summedYardage !== undefined && Math.abs(rawTotalYards - summedYardage) > 1) {
    issues.push(issue("total_yardage_mismatch", "warning", "El yardaje total no coincide con la suma de los hoyos.", selectionId));
  }

  const hasIdentity = Boolean(selectionId && name && teeName);
  const playable = hasIdentity
    && inspectedHoles.holesCount !== null
    && inspectedHoles.holes.length === inspectedHoles.holesCount
    && !issues.some((candidate) => candidate.severity === "error");
  const course = hasIdentity && inspectedHoles.holesCount !== null
    ? {
        id: selectionId,
        name,
        holesCount: inspectedHoles.holesCount,
        par: inspectedHoles.holes.reduce((total, hole) => total + hole.par, 0),
        active: true,
        source: Reflect.get(value, "builtIn") === true ? "built_in" as const : "manual" as const,
        ...(cleanOptionalDate(Reflect.get(value, "updatedAt")) ? { updatedAt: cleanOptionalDate(Reflect.get(value, "updatedAt")) } : {}),
      }
    : undefined;
  const tee = hasIdentity
    ? {
        id: selectionId,
        courseId: selectionId,
        name: teeName,
        ...(finitePositive(rawRating) ? { rating: rawRating } : {}),
        ...(finitePositive(rawSlope) ? { slope: rawSlope } : {}),
        ...(finitePositive(rawTotalYards)
          ? { totalYardage: rawTotalYards, yardageSource: "declared" as const }
          : summedYardage !== undefined
            ? { totalYardage: summedYardage, yardageSource: "holes" as const }
            : {}),
      }
    : undefined;
  const holes = course
    ? inspectedHoles.holes.map((hole) => ({ courseId: course.id, holeNumber: hole.number, par: hole.par, strokeIndex: hole.strokeIndex }))
    : [];

  return {
    selectionId,
    sourceCourse: value as Course,
    playable,
    ...(course ? { course } : {}),
    ...(tee ? { tee } : {}),
    holes,
    teeHoleYardages: holeYardages,
    issues,
  };
}

export function buildInternalCourseCatalog(values: readonly unknown[]): InternalCourseCatalog {
  const inspectedEntries = values.map(inspectInternalCourse);
  const idCounts = new Map<string, number>();
  for (const entry of inspectedEntries) {
    if (entry.selectionId) idCounts.set(entry.selectionId, (idCounts.get(entry.selectionId) ?? 0) + 1);
  }
  const entries = inspectedEntries.map((entry) => {
    if (!entry.selectionId || idCounts.get(entry.selectionId) === 1) return entry;
    const duplicateIssue = issue("duplicate_id", "error", `El identificador ${entry.selectionId} está duplicado.`, entry.selectionId);
    return { ...entry, playable: false, issues: [...entry.issues, duplicateIssue] };
  });
  const issues = entries.flatMap((entry) => entry.issues);

  const playableEntries = entries.filter((entry) => entry.playable && entry.course && entry.tee);
  return {
    entries,
    courses: playableEntries.map((entry) => entry.course as GolfCourseRecord),
    tees: playableEntries.map((entry) => entry.tee as CourseTeeRecord),
    holes: playableEntries.flatMap((entry) => entry.holes),
    teeHoleYardages: playableEntries.flatMap((entry) => entry.teeHoleYardages),
    issues,
    playableCount: playableEntries.length,
    rejectedCount: entries.length - playableEntries.length,
  };
}
