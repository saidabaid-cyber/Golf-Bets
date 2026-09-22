import { canonicalJson, publicationIsEffective } from "./admin-control-center";

export type BaseCourseHole = { id: string; holeNumber: number; par: number; strokeIndex: number };
export type BaseCourseTee = {
  id: string;
  name: string;
  rating: number | null;
  slope: number | null;
  category: string | null;
  yardages: Record<string, number | null>;
};
export type BaseCourseDefinition = { id: string; name: string; version: number; holes: BaseCourseHole[]; tees: BaseCourseTee[] };

export type ConfigurationHole = {
  id: string;
  sequence: number;
  runtimeHoleNumber: number | null;
  displayLabel: string;
  sourceBaseHoleId: string | null;
  sourceBaseHoleNumber: number | null;
  kind: "BASE" | "TEMPORARY";
  playable: boolean;
  parOverride: number | null;
  strokeIndexOverride: number | null;
  notes: string | null;
  temporaryGreen: boolean;
  temporaryTee: boolean;
  dropZoneNote: string | null;
  operationalNote: string | null;
};

export type ConfigurationTeeHole = { configurationHoleId: string; teeId: string; yardsOverride: number | null; source: string | null; verifiedAt: string | null };
export type ConfigurationRating = { teeId: string; rating: number; slope: number; category: string | null; source: string; verifiedAt: string };
export type CourseConfiguration = {
  id: string;
  courseId: string;
  competitionId: string | null;
  scopeType: "COURSE" | "COMPETITION";
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "SUPERSEDED" | "EXPIRED" | "CANCELLED" | "ARCHIVED";
  version: number;
  revisionHash: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  holes: ConfigurationHole[];
  teeHoles: ConfigurationTeeHole[];
  ratings: ConfigurationRating[];
};

export type ResolvedCourseHole = Omit<ConfigurationHole, "runtimeHoleNumber"> & { runtimeHoleNumber: number; par: number; strokeIndex: number; sourceBaseHoleId: string | null };
export type ResolvedCourseTee = BaseCourseTee & {
  ratingProvenance: "BASE" | "TEMPORARY_VERIFIED";
  yardages: Record<string, number | null>;
};
export type ResolvedCourseSnapshot = {
  sourceCourseId: string;
  courseName: string;
  baseVersion: number;
  configurationIds: string[];
  configurationVersions: number[];
  configurationHashes: string[];
  resolvedHoles: ResolvedCourseHole[];
  resolvedTees: ResolvedCourseTee[];
  par: number;
  warnings: string[];
  effectiveAt: string;
  snapshotPayload: string;
};

function applicable(config: CourseConfiguration, courseId: string, at: string, competitionId?: string | null) {
  if (config.courseId !== courseId || !["PUBLISHED", "SCHEDULED"].includes(config.status)) return false;
  if (!publicationIsEffective(config, at)) return false;
  if (config.scopeType === "COMPETITION") return Boolean(competitionId && config.competitionId === competitionId);
  return config.competitionId === null;
}

function selectSingle(rows: readonly CourseConfiguration[], scope: "COURSE" | "COMPETITION") {
  const matches = rows.filter((row) => row.scopeType === scope).sort((a, b) => b.version - a.version);
  if (matches.length > 1) throw new Error(`OVERLAPPING_${scope}_CONFIGURATIONS`);
  return matches[0] ?? null;
}

function resolveLayer(base: BaseCourseDefinition, configuration: CourseConfiguration | null, prior?: ResolvedCourseSnapshot): ResolvedCourseSnapshot {
  if (!configuration) return prior ?? {
    sourceCourseId: base.id,
    courseName: base.name,
    baseVersion: base.version,
    configurationIds: [],
    configurationVersions: [],
    configurationHashes: [],
    resolvedHoles: base.holes.map((hole, index) => ({
      id: hole.id,
      sequence: index + 1,
      runtimeHoleNumber: index + 1,
      displayLabel: String(hole.holeNumber),
      sourceBaseHoleId: hole.id,
      sourceBaseHoleNumber: hole.holeNumber,
      kind: "BASE",
      playable: true,
      parOverride: null,
      strokeIndexOverride: null,
      notes: null,
      temporaryGreen: false,
      temporaryTee: false,
      dropZoneNote: null,
      operationalNote: null,
      par: hole.par,
      strokeIndex: hole.strokeIndex,
    })),
    resolvedTees: base.tees.map((tee) => ({ ...tee, ratingProvenance: "BASE" as const, yardages: { ...tee.yardages } })),
    par: base.holes.reduce((sum, hole) => sum + hole.par, 0),
    warnings: [],
    effectiveAt: "",
    snapshotPayload: "",
  };

  const sourceHoles = new Map(base.holes.map((hole) => [hole.id, hole]));
  const seenSequence = new Set<number>();
  const seenRuntime = new Set<number>();
  const resolvedHoles = configuration.holes
    .filter((hole) => hole.playable)
    .sort((a, b) => a.sequence - b.sequence)
    .map((hole) => {
      if (!Number.isInteger(hole.runtimeHoleNumber) || hole.runtimeHoleNumber === null || hole.runtimeHoleNumber < 1 || hole.runtimeHoleNumber > 18) throw new Error("INVALID_RUNTIME_HOLE");
      if (seenSequence.has(hole.sequence) || seenRuntime.has(hole.runtimeHoleNumber)) throw new Error("DUPLICATE_RUNTIME_HOLE");
      seenSequence.add(hole.sequence);
      seenRuntime.add(hole.runtimeHoleNumber);
      const source = hole.sourceBaseHoleId ? sourceHoles.get(hole.sourceBaseHoleId) : null;
      if (hole.kind === "BASE" && !source) throw new Error("MISSING_BASE_HOLE");
      const par = hole.parOverride ?? source?.par;
      const strokeIndex = hole.strokeIndexOverride ?? source?.strokeIndex;
      if (!par || par < 3 || par > 6 || !strokeIndex || strokeIndex < 1 || strokeIndex > 18) throw new Error("INVALID_RESOLVED_HOLE");
      return { ...hole, runtimeHoleNumber: hole.runtimeHoleNumber, par, strokeIndex };
    });

  if (![9, 18].includes(resolvedHoles.length)) throw new Error("INVALID_PLAYABLE_HOLE_COUNT");
  const teeHole = new Map(configuration.teeHoles.map((row) => [`${row.teeId}:${row.configurationHoleId}`, row]));
  const rating = new Map(configuration.ratings.map((row) => [row.teeId, row]));
  const warnings: string[] = [];
  const resolvedTees = base.tees.map((tee) => {
    const temporaryRating = rating.get(tee.id);
    const verifiedRating = temporaryRating
      && temporaryRating.source.trim()
      && !Number.isNaN(Date.parse(temporaryRating.verifiedAt))
      ? temporaryRating : null;
    if (temporaryRating && !verifiedRating) warnings.push(`Rating/Slope temporal no verificado: ${tee.name}`);
    const yardages: Record<string, number | null> = {};
    for (const hole of resolvedHoles) {
      const override = teeHole.get(`${tee.id}:${hole.id}`);
      const baseYardage = hole.sourceBaseHoleId ? tee.yardages[hole.sourceBaseHoleId] ?? null : null;
      yardages[hole.id] = override?.yardsOverride ?? baseYardage;
      if (yardages[hole.id] === null) warnings.push(`Yardaje pendiente: ${tee.name} · ${hole.displayLabel}`);
    }
    return {
      ...tee,
      rating: verifiedRating?.rating ?? tee.rating,
      slope: verifiedRating?.slope ?? tee.slope,
      category: verifiedRating?.category ?? tee.category,
      ratingProvenance: verifiedRating ? "TEMPORARY_VERIFIED" as const : "BASE" as const,
      yardages,
    };
  });
  return {
    ...(prior ?? resolveLayer(base, null)),
    configurationIds: [...(prior?.configurationIds ?? []), configuration.id],
    configurationVersions: [...(prior?.configurationVersions ?? []), configuration.version],
    configurationHashes: [...(prior?.configurationHashes ?? []), configuration.revisionHash],
    resolvedHoles,
    resolvedTees,
    par: resolvedHoles.reduce((sum, hole) => sum + hole.par, 0),
    // Each configuration is a complete resolved layer. A competition override
    // can replace temporary holes from the general Course configuration, so
    // warnings from the previous layer may describe holes that no longer
    // exist. Keep only warnings produced by the final resolved layer.
    warnings,
  };
}

/** Resolves current data once. A round persists this returned object verbatim. */
export function resolveEffectiveCourse(input: { base: BaseCourseDefinition; configurations: readonly CourseConfiguration[]; at: string; competitionId?: string | null }): ResolvedCourseSnapshot {
  if (Number.isNaN(Date.parse(input.at))) throw new Error("INVALID_EFFECTIVE_AT");
  const candidates = input.configurations.filter((configuration) => applicable(configuration, input.base.id, input.at, input.competitionId));
  const course = selectSingle(candidates, "COURSE");
  const competition = input.competitionId ? selectSingle(candidates, "COMPETITION") : null;
  let resolved = resolveLayer(input.base, course);
  resolved = resolveLayer(input.base, competition, resolved);
  const snapshot = { ...resolved, effectiveAt: input.at, snapshotPayload: "" };
  return { ...snapshot, snapshotPayload: canonicalJson(snapshot) };
}
