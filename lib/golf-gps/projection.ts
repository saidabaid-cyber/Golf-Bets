import type { GolfApiSnapshot } from '../golfapi/normalize.mjs';
import type { GpsCourse } from './types';

// Only these reviewed existing identities may be served. Cola remains absent.
export const GPS_SAVED_COURSES = [
  { externalId: '01213326512553886', id: 'course-la-vista', name: 'La Vista Country Club' },
  { externalId: '0121254756996467', id: 'course-campestre-puebla', name: 'Club Campestre de Puebla' },
  { externalId: '0121235348037759', id: 'review-course-24458', name: 'Club de Golf Las Fuentes' },
  { externalId: '0121165709980130', id: 'course-el-cristo', name: 'El Cristo' },
] as const;
const labels: Record<string, string> = { FRONT_TEE: 'Tee delantero (sin color asignado)', BACK_TEE: 'Tee posterior (sin color asignado)', GREEN_BUNKER: 'Referencia de bunker del green', FAIRWAY_BUNKER: 'Referencia de bunker', WATER: 'Referencia de agua', DOGLEG: 'Referencia de dogleg', TREES: 'Referencia de árboles', ROAD: 'Referencia de camino', '100_MARKER': 'Referencia 100', '150_MARKER': 'Referencia 150', '200_MARKER': 'Referencia 200' };

/** Existing, server-persisted physical identity evidence, not matching by name,
 * total par or yardage. Never grants a temporary layout an inferred GPS map. */
export function reviewedClubCardGps(courses: GpsCourse[], row: Record<string, any> | null): GpsCourse | null {
  const metadata = row?.catalog_metadata, alias = metadata?.ghin_provider_alias_v1;
  const version = 'la-vista-club-current-2026-09-28';
  const canonical = courses.find(course => course.id === 'course-la-vista');
  if (!canonical || canonical.holes.length !== 18 || row?.id !== 'course-la-vista-club-current'
    || row.club_id !== 'club-la-vista' || row.holes !== 18 || row.is_provisional !== false
    || metadata?.dataVersion !== version || alias?.source_data_version !== version
    || alias.status !== 'CONFIRMED' || alias.provider !== 'GHIN' || alias.club_id !== 'club-la-vista'
    || alias.canonical_course_id !== canonical.id || alias.provider_course_id !== '23233'
    || alias.provider_facility_id !== '19886' || alias.evidence !== 'OWNED_SESSION_LIVE_COURSE_AND_GOLD_18_HOLE_GEOMETRY') return null;
  return { ...canonical, id: row.id, name: 'La Vista · Tarjeta actual del club', source: { ...canonical.source, mappingEvidence: 'Correspondencia física del recorrido aprobada el 6 de octubre de 2026; tarjeta del club conservada.' } };
}

/** Player DTO only. Raw responses, ratings, tee cards, private IDs/paths,
 * rejected points, request keys and API credentials never cross this boundary. */
export function gpsCourseProjection(snapshot: GolfApiSnapshot): GpsCourse {
  const identity = GPS_SAVED_COURSES.find(row => row.externalId === snapshot.externalCourseId && row.id === snapshot.mapping.courseId);
  if (!identity || snapshot.provider !== 'GOLFAPI' || snapshot.schemaVersion !== 1) throw Error('GPS_UNREVIEWED_SOURCE_IDENTITY');
  return {
    id: identity.id, name: identity.name, physicalHoleCount: snapshot.physicalHoles.length, cardPositionCount: snapshot.positions.length,
    holes: snapshot.positions.map(position => {
      const physical = snapshot.physicalHoles.find(hole => hole.id === position.physicalHoleId);
      return { position: position.number, lap: position.lap, physicalHoleId: position.physicalHoleId, physicalNumber: physical?.number ?? null,
        green: { front: position.green.front ? [...position.green.front.coordinate] : null, center: position.green.center ? [...position.green.center.coordinate] : null, back: position.green.back ? [...position.green.back.coordinate] : null },
        references: position.points.filter(point => Boolean(labels[point.type])).map(point => ({ label: labels[point.type], kind: point.type, coordinate: [...point.coordinate] })),
        pairingStatus: physical?.mappingStatus ?? 'UNKNOWN', pairingDifferencesMeters: physical?.greenPairDifferencesMeters ? { ...physical.greenPairDifferencesMeters } : null };
    }),
    source: { provider: 'GOLFAPI', recordUpdatedAt: snapshot.source.providerCourseUpdatedAt, fieldVerified: false, accuracyMeters: null, coordinateCaptureDate: null },
  };
}
