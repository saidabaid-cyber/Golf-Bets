export type CourseLocationEvidence = {
  clubId: string;
  clubName: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  sourceAuthority: string;
  sourceUrl: string;
  coordinateEvidenceUrl?: string;
  confidence: "PRIMARY" | "PRIMARY_SUPPORTED" | "GOVERNMENT_SUPPORTED" | "OPEN_DATA_EXACT" | "SECONDARY_CORROBORATED" | "SECONDARY_EXACT";
  operationalStatus: "OPERATION_CONFIRMED" | "OPERATION_REPORTED_SECONDARY";
  pointKind: "club_course_property";
};

export type CourseLocationEvidenceSet = {
  version: string;
  projectRef: string;
  provider: string;
  verifiedAt: string;
  verifiedLocations: CourseLocationEvidence[];
  pendingLocations: Array<{ clubId: string; clubName: string; status: string; reason: string; sourceUrl: string }>;
};

export type CourseAuditSource = {
  clubs: Array<{
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
    locationEvidence: Record<string, unknown> | null;
  }>;
  courses: unknown[];
  tees: unknown[];
};

const MEXICO_BOUNDS = { minLatitude: 14, maxLatitude: 33, minLongitude: -118, maxLongitude: -86 } as const;

export function validateMexicoCourseLocationEvidence(source: CourseAuditSource, evidence: CourseLocationEvidenceSet) {
  const errors: string[] = [];
  if (evidence.projectRef !== "bymeopxkxapfizeeqeyb") errors.push("QA_PROJECT_REF_MISMATCH");
  if (evidence.provider !== "OWNER_CATALOG_REVIEW") errors.push("PROVIDER_MISMATCH");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.verifiedAt)) errors.push("INVALID_VERIFIED_AT");

  const sourceById = new Map(source.clubs.map((club) => [club.id, club]));
  const seen = new Set<string>();
  for (const record of evidence.verifiedLocations) {
    if (seen.has(record.clubId)) errors.push(`DUPLICATE_EVIDENCE_ID:${record.clubId}`);
    seen.add(record.clubId);
    const current = sourceById.get(record.clubId);
    if (!current) errors.push(`UNKNOWN_CLUB_ID:${record.clubId}`);
    else if (current.name !== record.clubName) errors.push(`CLUB_IDENTITY_MISMATCH:${record.clubId}`);
    if (!Number.isFinite(record.latitude) || record.latitude < MEXICO_BOUNDS.minLatitude || record.latitude > MEXICO_BOUNDS.maxLatitude) errors.push(`INVALID_MEXICO_LATITUDE:${record.clubId}`);
    if (!Number.isFinite(record.longitude) || record.longitude < MEXICO_BOUNDS.minLongitude || record.longitude > MEXICO_BOUNDS.maxLongitude) errors.push(`INVALID_MEXICO_LONGITUDE:${record.clubId}`);
    if (record.latitude === 0 || record.longitude === 0) errors.push(`ZERO_COORDINATE:${record.clubId}`);
    if (!/^https?:\/\//.test(record.sourceUrl)) errors.push(`INVALID_SOURCE_URL:${record.clubId}`);
    if (!record.sourceAuthority.trim()) errors.push(`MISSING_SOURCE_AUTHORITY:${record.clubId}`);
    if (record.pointKind !== "club_course_property") errors.push(`NON_PROPERTY_POINT:${record.clubId}`);
  }
  for (const record of evidence.pendingLocations) {
    if (seen.has(record.clubId)) errors.push(`VERIFIED_AND_PENDING:${record.clubId}`);
    seen.add(record.clubId);
    if (!sourceById.has(record.clubId)) errors.push(`UNKNOWN_PENDING_CLUB_ID:${record.clubId}`);
    if (!record.reason.trim()) errors.push(`MISSING_PENDING_REASON:${record.clubId}`);
  }
  return { valid: errors.length === 0, errors, reviewed: seen.size };
}

export function mergeMexicoCourseLocations(source: CourseAuditSource, evidence: CourseLocationEvidenceSet) {
  const validation = validateMexicoCourseLocationEvidence(source, evidence);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  const evidenceById = new Map(evidence.verifiedLocations.map((record) => [record.clubId, record]));
  return {
    ...structuredClone(source),
    clubs: source.clubs.map((club) => {
      const location = evidenceById.get(club.id);
      if (!location) return structuredClone(club);
      if (club.latitude !== null || club.longitude !== null || club.locationEvidence !== null) {
        throw new Error(`LOCATION_ALREADY_SET:${club.id}`);
      }
      return {
        ...structuredClone(club),
        latitude: location.latitude,
        longitude: location.longitude,
        locationEvidence: {
          club: location.clubName,
          latitude: location.latitude,
          longitude: location.longitude,
          authority: location.sourceAuthority,
          sourceUrl: location.sourceUrl,
          ...(location.coordinateEvidenceUrl ? { coordinateEvidenceUrl: location.coordinateEvidenceUrl } : {}),
          verifiedAt: evidence.verifiedAt,
          pointKind: location.pointKind,
          confidence: location.confidence,
          operationalStatus: location.operationalStatus,
          evidenceVersion: evidence.version,
        },
      };
    }),
  };
}

export function courseGeoCoverage(source: CourseAuditSource) {
  const geolocated = source.clubs.filter((club) => club.latitude !== null && club.longitude !== null && club.locationEvidence !== null).length;
  return { clubs: source.clubs.length, geolocated, pending: source.clubs.length - geolocated };
}
