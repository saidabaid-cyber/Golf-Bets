import type {
  GolfCourseCatalog,
  GolfCourseTee,
  GolfHole,
} from "../golf-course-directory";
import type { NormalizedGhinCourse, NormalizedGhinTee } from "./core";

export const GHIN_COURSE_COMPARISON_STATUSES = [
  "MATCH",
  "DIFFERENT",
  "MISSING_IN_BACKYARD",
  "MISSING_IN_GHIN",
  "UNKNOWN",
] as const;

export type GhinCourseComparisonStatus = (typeof GHIN_COURSE_COMPARISON_STATUSES)[number];
export type GhinCourseComparisonValue = string | number | boolean | null;

export type GhinCourseComparisonField = {
  scope: "course" | "tee" | "hole";
  path: string;
  label: string;
  status: GhinCourseComparisonStatus;
  backyard: GhinCourseComparisonValue;
  ghin: GhinCourseComparisonValue;
  note?: string;
};

export type GhinTeeMatchRule = {
  backyardTeeId: string;
  /** May be a provider record key. It is not assumed to be a GHIN TeeSet ID. */
  ghinTeeId?: string | null;
  ghinTeeName?: string | null;
  /** Additional exact names accepted for this Backyard tee. No fuzzy matching is performed. */
  aliases?: readonly string[];
};

export type GhinCourseComparisonOptions = {
  backyardCourseId: string;
  teeMatches?: readonly GhinTeeMatchRule[];
};

export type GhinTeeMatchKind =
  | "EXPLICIT_ID"
  | "EXPLICIT_NAME"
  | "EXACT_NAME"
  | "ALIAS"
  | "AMBIGUOUS"
  | "UNMATCHED_BACKYARD"
  | "UNMATCHED_GHIN";

export type GhinTeeComparison = {
  backyardTeeId: string | null;
  backyardTeeName: string | null;
  ghinTeeSourceId: string | null;
  ghinTeeName: string | null;
  matchKind: GhinTeeMatchKind;
  fields: GhinCourseComparisonField[];
};

export type GhinCourseComparisonSummary = Record<GhinCourseComparisonStatus, number> & {
  fields: number;
  matchedTees: number;
  backyardOnlyTees: number;
  ghinOnlyTees: number;
};

export type GhinCourseComparisonReport = {
  schemaVersion: 1;
  mode: "DRY_RUN";
  readOnly: true;
  applied: false;
  backyard: {
    clubId: string;
    courseId: string;
    courseName: string;
  };
  ghin: {
    facilityId: string | null;
    courseId: string | null;
    courseName: string | null;
  };
  fields: GhinCourseComparisonField[];
  tees: GhinTeeComparison[];
  summary: GhinCourseComparisonSummary;
  warnings: string[];
  humanReport: string;
};

export type LaVistaMappingProposalOptions = {
  teeMatches?: readonly GhinTeeMatchRule[];
  /**
   * TeeSet IDs must come from separately verified semantics. A source record ID,
   * especially `ghin:<course>:tee:<hash>`, is never promoted automatically.
   */
  verifiedTeeSetIdsBySourceId?: Readonly<Record<string, string>>;
};

export type LaVistaGhinMappingProposal = {
  schemaVersion: 1;
  mode: "DRY_RUN";
  readOnly: true;
  applied: false;
  provider: "GHIN";
  facility: {
    backyardClubId: "club-la-vista";
    proposedProviderExternalId: string | null;
    reviewRequired: true;
  };
  course: {
    backyardCourseId: "course-la-vista";
    proposedProviderExternalId: string | null;
    reviewRequired: true;
  };
  tees: Array<{
    backyardTeeId: string;
    backyardTeeName: string;
    ghinTeeSourceId: string | null;
    ghinTeeName: string | null;
    matchKind: GhinTeeMatchKind;
    proposedProviderExternalId: string | null;
    verifiedTeeSetId: string | null;
    syntheticSourceId: boolean;
    reviewRequired: true;
  }>;
  unmatchedBackyardTeeIds: string[];
  unmatchedGhinTeeSourceIds: Array<string | null>;
  warnings: string[];
};

type MatchedTee = {
  backyard: GolfCourseTee | null;
  ghin: NormalizedGhinTee | null;
  matchKind: GhinTeeMatchKind;
  ghinIndex: number | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-MX");
}

function comparisonValue(value: unknown): GhinCourseComparisonValue {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return null;
}

function valuesMatch(left: GhinCourseComparisonValue, right: GhinCourseComparisonValue) {
  if (typeof left === "string" && typeof right === "string") return normalizeText(left) === normalizeText(right);
  return left === right;
}

function compareField(
  scope: GhinCourseComparisonField["scope"],
  path: string,
  label: string,
  backyardInput: unknown,
  ghinInput: unknown,
  note?: string,
): GhinCourseComparisonField {
  const backyard = comparisonValue(backyardInput);
  const ghin = comparisonValue(ghinInput);
  const status: GhinCourseComparisonStatus = backyard === null && ghin === null
    ? "UNKNOWN"
    : backyard === null
      ? "MISSING_IN_BACKYARD"
      : ghin === null
        ? "MISSING_IN_GHIN"
        : valuesMatch(backyard, ghin)
          ? "MATCH"
          : "DIFFERENT";
  return { scope, path, label, status, backyard, ghin, ...(note ? { note } : {}) };
}

function teeSourceId(tee: NormalizedGhinTee | null) {
  return comparisonValue(tee?.id) as string | null;
}

/** IDs from the reviewed owner snapshot are stable evidence keys, not GHIN TeeSet IDs. */
export function isSyntheticReviewedGhinTeeId(value: unknown) {
  return typeof value === "string" && /^ghin:\d+:tee:[0-9a-f]{12}$/i.test(value.trim());
}

function candidatesByNames(ghinTees: readonly NormalizedGhinTee[], names: readonly string[], used: ReadonlySet<number>) {
  const accepted = new Set(names.map(normalizeText).filter(Boolean));
  return ghinTees
    .map((tee, index) => ({ tee, index }))
    .filter(({ tee, index }) => !used.has(index) && accepted.has(normalizeText(tee.name)));
}

function matchTees(
  backyardTees: readonly GolfCourseTee[],
  ghinTees: readonly NormalizedGhinTee[],
  rules: readonly GhinTeeMatchRule[],
) {
  const byBackyardId = new Map(rules.map((rule) => [rule.backyardTeeId, rule]));
  const used = new Set<number>();
  const warnings: string[] = [];
  const matches: MatchedTee[] = [];

  for (const backyard of backyardTees) {
    const rule = byBackyardId.get(backyard.id);
    let candidates: Array<{ tee: NormalizedGhinTee; index: number }> = [];
    let matchKind: GhinTeeMatchKind = "EXACT_NAME";

    if (rule?.ghinTeeId) {
      candidates = ghinTees
        .map((tee, index) => ({ tee, index }))
        .filter(({ tee, index }) => !used.has(index) && tee.id === rule.ghinTeeId);
      matchKind = "EXPLICIT_ID";
    } else if (rule?.ghinTeeName) {
      candidates = candidatesByNames(ghinTees, [rule.ghinTeeName], used);
      matchKind = "EXPLICIT_NAME";
    } else {
      candidates = candidatesByNames(ghinTees, [backyard.name], used);
      matchKind = "EXACT_NAME";
      if (!candidates.length && rule?.aliases?.length) {
        candidates = candidatesByNames(ghinTees, rule.aliases, used);
        matchKind = "ALIAS";
      }
    }

    if (candidates.length === 1) {
      used.add(candidates[0].index);
      matches.push({ backyard, ghin: candidates[0].tee, matchKind, ghinIndex: candidates[0].index });
      continue;
    }
    if (candidates.length > 1) {
      warnings.push(`Tee ambiguo: ${backyard.id} coincide con ${candidates.length} tees GHIN; no se eligió ninguno.`);
      matches.push({ backyard, ghin: null, matchKind: "AMBIGUOUS", ghinIndex: null });
      continue;
    }
    if (rule?.ghinTeeId || rule?.ghinTeeName) warnings.push(`Mapping explícito sin destino: ${backyard.id}.`);
    matches.push({ backyard, ghin: null, matchKind: "UNMATCHED_BACKYARD", ghinIndex: null });
  }

  ghinTees.forEach((ghin, index) => {
    if (!used.has(index)) matches.push({ backyard: null, ghin, matchKind: "UNMATCHED_GHIN", ghinIndex: index });
  });
  return { matches, warnings };
}

function backyardYardage(catalog: GolfCourseCatalog, teeId: string | null, hole: GolfHole | null) {
  if (!teeId || !hole) return null;
  const row = catalog.teeHoleYardages.find((candidate) => candidate.teeId === teeId && candidate.holeId === hole.id)
    ?? catalog.teeHoleYardages.find((candidate) => candidate.teeId === teeId && candidate.holeNumber === hole.holeNumber);
  return row?.yards ?? null;
}

function teeFields(
  catalog: GolfCourseCatalog,
  backyardCourseId: string,
  match: MatchedTee,
) {
  const backyard = match.backyard;
  const ghin = match.ghin;
  const key = backyard?.id ?? `ghin-${match.ghinIndex ?? "unknown"}`;
  const fields: GhinCourseComparisonField[] = [
    compareField("tee", `tees.${key}.name`, "Tee · nombre", backyard?.name, ghin?.name),
    compareField("tee", `tees.${key}.gender`, "Tee · categoría/género", backyard?.gender, ghin?.gender),
    compareField("tee", `tees.${key}.holes`, "Tee · hoyos", backyard ? catalog.holes.filter((hole) => hole.courseId === backyardCourseId).length : null, ghin?.holes),
    compareField("tee", `tees.${key}.rating`, "Tee · Course Rating", backyard?.rating, ghin?.courseRating),
    compareField("tee", `tees.${key}.slope`, "Tee · Slope Rating", backyard?.slope, ghin?.slopeRating),
    compareField("tee", `tees.${key}.frontRating`, "Tee · rating front nine", backyard?.frontNineRating, ghin?.frontRating),
    compareField("tee", `tees.${key}.frontSlope`, "Tee · slope front nine", null, ghin?.frontSlope, "El catálogo runtime actual no modela slope por nueve."),
    compareField("tee", `tees.${key}.backRating`, "Tee · rating back nine", backyard?.backNineRating, ghin?.backRating),
    compareField("tee", `tees.${key}.backSlope`, "Tee · slope back nine", null, ghin?.backSlope, "El catálogo runtime actual no modela slope por nueve."),
    compareField("tee", `tees.${key}.par`, "Tee · par", backyard?.par, ghin?.par),
    compareField("tee", `tees.${key}.totalYards`, "Tee · yardas totales", backyard?.totalYards, ghin?.totalYards),
  ];

  const backyardHoles = catalog.holes.filter((hole) => hole.courseId === backyardCourseId);
  const backyardByNumber = new Map(backyardHoles.map((hole) => [hole.holeNumber, hole]));
  const ghinByNumber = new Map((ghin?.holeData ?? []).map((hole) => [hole.number, hole]));
  const numbers = [...new Set([...backyardByNumber.keys(), ...ghinByNumber.keys()])].sort((left, right) => left - right);
  for (const number of numbers) {
    const backyardHole = backyardByNumber.get(number) ?? null;
    const ghinHole = ghinByNumber.get(number) ?? null;
    fields.push(
      compareField("hole", `tees.${key}.holes.${number}.par`, `H${number} · par`, backyardHole?.par, ghinHole?.par),
      compareField("hole", `tees.${key}.holes.${number}.yards`, `H${number} · yardas`, backyardYardage(catalog, backyard?.id ?? null, backyardHole), ghinHole?.yardage),
      compareField("hole", `tees.${key}.holes.${number}.strokeIndex`, `H${number} · Stroke Index`, backyardHole?.strokeIndex, ghinHole?.strokeIndex),
    );
  }
  return fields;
}

function summary(fields: readonly GhinCourseComparisonField[], tees: readonly GhinTeeComparison[]): GhinCourseComparisonSummary {
  const counts: Record<GhinCourseComparisonStatus, number> = {
    MATCH: 0,
    DIFFERENT: 0,
    MISSING_IN_BACKYARD: 0,
    MISSING_IN_GHIN: 0,
    UNKNOWN: 0,
  };
  for (const field of fields) counts[field.status] += 1;
  return {
    ...counts,
    fields: fields.length,
    matchedTees: tees.filter((tee) => !["AMBIGUOUS", "UNMATCHED_BACKYARD", "UNMATCHED_GHIN"].includes(tee.matchKind)).length,
    backyardOnlyTees: tees.filter((tee) => tee.matchKind === "UNMATCHED_BACKYARD" || tee.matchKind === "AMBIGUOUS").length,
    ghinOnlyTees: tees.filter((tee) => tee.matchKind === "UNMATCHED_GHIN").length,
  };
}

function printable(value: GhinCourseComparisonValue) {
  return value === null ? "—" : String(value);
}

function humanReport(
  backyardCourseName: string,
  ghinCourseName: string | null,
  fields: readonly GhinCourseComparisonField[],
  tees: readonly GhinTeeComparison[],
  result: GhinCourseComparisonSummary,
  warnings: readonly string[],
) {
  const lines = [
    "GHIN COURSE COMPARISON · DRY RUN · NO CHANGES APPLIED",
    `Backyard: ${backyardCourseName}`,
    `GHIN: ${ghinCourseName || "unknown"}`,
    `Fields: ${result.fields} · MATCH ${result.MATCH} · DIFFERENT ${result.DIFFERENT} · MISSING_IN_BACKYARD ${result.MISSING_IN_BACKYARD} · MISSING_IN_GHIN ${result.MISSING_IN_GHIN} · UNKNOWN ${result.UNKNOWN}`,
    "Course:",
    ...fields.filter((field) => field.scope === "course").map((field) => `- [${field.status}] ${field.label}: Backyard=${printable(field.backyard)} | GHIN=${printable(field.ghin)}`),
    "Tees:",
  ];
  for (const tee of tees) {
    lines.push(`- ${tee.backyardTeeName || "—"} ↔ ${tee.ghinTeeName || "—"} (${tee.matchKind})`);
    for (const field of tee.fields) lines.push(`  - [${field.status}] ${field.label}: Backyard=${printable(field.backyard)} | GHIN=${printable(field.ghin)}`);
  }
  if (warnings.length) lines.push("Warnings:", ...warnings.map((warning) => `- ${warning}`));
  return lines.join("\n");
}

export function compareGhinCourseDryRun(
  catalog: GolfCourseCatalog,
  ghin: NormalizedGhinCourse,
  options: GhinCourseComparisonOptions,
): GhinCourseComparisonReport {
  const course = catalog.courses.find((candidate) => candidate.id === options.backyardCourseId);
  if (!course) throw new Error(`BACKYARD_COURSE_NOT_FOUND:${options.backyardCourseId}`);
  const club = catalog.clubs.find((candidate) => candidate.id === course.clubId);
  if (!club) throw new Error(`BACKYARD_CLUB_NOT_FOUND:${course.clubId}`);

  const fields: GhinCourseComparisonField[] = [
    compareField("course", "course.facilityExternalId", "Facility external ID", club.provider === "GHIN" ? club.providerExternalId : null, ghin.facilityId, "Sólo se compara un ID ya clasificado como GHIN."),
    compareField("course", "course.courseExternalId", "Course external ID", course.provider === "GHIN" ? course.providerExternalId : null, ghin.id, "Un slug BACKYARD_INTERNAL no es un ID GHIN."),
    compareField("course", "course.facilityName", "Club/facility", club.name, ghin.facilityName),
    compareField("course", "course.name", "Recorrido", course.name, ghin.name),
    compareField("course", "course.city", "Ciudad", club.city, ghin.city),
    compareField("course", "course.state", "Estado/región", club.stateRegion, ghin.state),
    compareField("course", "course.country", "País", club.country, ghin.country),
    compareField("course", "course.holes", "Hoyos", course.holes, ghin.holes),
    compareField("course", "course.status", "Estado operativo", course.active ? "active" : "inactive", ghin.status === "unknown" ? null : ghin.status),
  ];
  const matched = matchTees(
    catalog.tees.filter((tee) => tee.active && tee.courseId === course.id),
    ghin.tees,
    options.teeMatches ?? [],
  );
  const tees = matched.matches.map((match): GhinTeeComparison => ({
    backyardTeeId: match.backyard?.id ?? null,
    backyardTeeName: comparisonValue(match.backyard?.name) as string | null,
    ghinTeeSourceId: teeSourceId(match.ghin),
    ghinTeeName: comparisonValue(match.ghin?.name) as string | null,
    matchKind: match.matchKind,
    fields: teeFields(catalog, course.id, match),
  }));
  const allFields = [...fields, ...tees.flatMap((tee) => tee.fields)];
  const resultSummary = summary(allFields, tees);
  const warnings = [...matched.warnings];
  if (ghin.tees.some((tee) => isSyntheticReviewedGhinTeeId(tee.id))) {
    warnings.push("Uno o más IDs de tee son claves sintéticas del catálogo revisado; no son GHIN TeeSet IDs.");
  }
  return {
    schemaVersion: 1,
    mode: "DRY_RUN",
    readOnly: true,
    applied: false,
    backyard: { clubId: club.id, courseId: course.id, courseName: course.name },
    ghin: { facilityId: ghin.facilityId, courseId: ghin.id, courseName: ghin.name },
    fields,
    tees,
    summary: resultSummary,
    warnings,
    humanReport: humanReport(course.name, ghin.name, fields, tees, resultSummary, warnings),
  };
}

export function proposeLaVistaGhinMappings(
  catalog: GolfCourseCatalog,
  ghin: NormalizedGhinCourse,
  options: LaVistaMappingProposalOptions = {},
): LaVistaGhinMappingProposal {
  const course = catalog.courses.find((candidate) => candidate.id === "course-la-vista");
  if (!course || course.clubId !== "club-la-vista") throw new Error("LA_VISTA_CATALOG_IDENTITY_NOT_FOUND");
  const backyardTees = catalog.tees.filter((tee) => tee.active && tee.courseId === course.id);
  const matched = matchTees(backyardTees, ghin.tees, options.teeMatches ?? []);
  const warnings = [...matched.warnings, "Las propuestas son de revisión: esta función no persiste ni aplica mappings."];
  const tees = matched.matches.flatMap((match) => {
    if (!match.backyard) return [];
    const sourceId = teeSourceId(match.ghin);
    const syntheticSourceId = isSyntheticReviewedGhinTeeId(sourceId);
    const explicitTeeSetId = sourceId ? comparisonValue(options.verifiedTeeSetIdsBySourceId?.[sourceId]) as string | null : null;
    const verifiedTeeSetId = explicitTeeSetId && !isSyntheticReviewedGhinTeeId(explicitTeeSetId) ? explicitTeeSetId : null;
    if (syntheticSourceId) warnings.push(`${sourceId} se conserva sólo como source ID; nunca se usa como provider_external_id ni TeeSet ID.`);
    if (sourceId && !syntheticSourceId && !verifiedTeeSetId) warnings.push(`${sourceId} requiere verificar semántica TeeSet antes de proponer un mapping.`);
    if (explicitTeeSetId && !verifiedTeeSetId) warnings.push(`TeeSet ID rechazado por ser sintético: ${explicitTeeSetId}.`);
    return [{
      backyardTeeId: match.backyard.id,
      backyardTeeName: match.backyard.name,
      ghinTeeSourceId: sourceId,
      ghinTeeName: comparisonValue(match.ghin?.name) as string | null,
      matchKind: match.matchKind,
      proposedProviderExternalId: verifiedTeeSetId,
      verifiedTeeSetId,
      syntheticSourceId,
      reviewRequired: true as const,
    }];
  });
  return {
    schemaVersion: 1,
    mode: "DRY_RUN",
    readOnly: true,
    applied: false,
    provider: "GHIN",
    facility: { backyardClubId: "club-la-vista", proposedProviderExternalId: ghin.facilityId, reviewRequired: true },
    course: { backyardCourseId: "course-la-vista", proposedProviderExternalId: ghin.id, reviewRequired: true },
    tees,
    unmatchedBackyardTeeIds: tees.filter((tee) => tee.matchKind === "UNMATCHED_BACKYARD" || tee.matchKind === "AMBIGUOUS").map((tee) => tee.backyardTeeId),
    unmatchedGhinTeeSourceIds: matched.matches.filter((match) => !match.backyard && match.ghin).map((match) => teeSourceId(match.ghin)),
    warnings: [...new Set(warnings)],
  };
}
