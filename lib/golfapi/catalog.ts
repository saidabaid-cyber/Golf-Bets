import { createCourseCatalogProvider, type CourseCatalogProvider } from '../course-catalog-provider';
import type { GolfCourseCatalog, GolfHoleGeoFeatureType } from '../golf-course-directory';
import type { GolfApiSnapshot } from './normalize.mjs';

function featureType(type: string, location: string): GolfHoleGeoFeatureType {
  if (type === 'GREEN') return location === 'front' ? 'GREEN_FRONT' : location === 'back' ? 'GREEN_BACK' : location === 'center' ? 'GREEN_CENTER' : 'OTHER';
  if (type.endsWith('TEE')) return 'TEE';
  if (type.endsWith('BUNKER')) return 'BUNKER';
  return type === 'WATER' || type === 'DOGLEG' ? type : 'LANDMARK';
}

/** Existing provider contract, using existing course/club IDs. This is a source
 * preview, not a Course Master merge: no official/local card is overwritten. */
export function savedGolfApiCatalogProvider(snapshots: readonly GolfApiSnapshot[]): CourseCatalogProvider {
  const catalog: GolfCourseCatalog = { schemaVersion: 1, clubs: [], courses: [], tees: [], holes: [], teeHoleYardages: [], geoFeatures: [] };
  for (const snapshot of snapshots) {
    const { courseId, clubId } = snapshot.mapping;
    const provenance = { provider: 'GOLFAPI', providerExternalId: snapshot.externalCourseId, sourceName: 'GolfAPI stored source — not an official card replacement', sourceUrl: 'https://www.golfapi.io/', verifiedAt: undefined };
    catalog.clubs.push({ id: clubId, name: snapshot.club.name, city: snapshot.club.city ?? undefined, stateRegion: snapshot.club.state ?? undefined, country: snapshot.club.country, latitude: snapshot.club.generalLocation?.[1], longitude: snapshot.club.generalLocation?.[0], active: true, ...provenance, providerExternalId: snapshot.externalClubId });
    catalog.courses.push({ id: courseId, clubId, name: snapshot.course.name ?? snapshot.club.name, holes: snapshot.course.declaredHoles, active: true, ...provenance });
    for (const position of snapshot.positions) {
      const holeId = `${courseId}:golfapi-position:${position.number}`;
      if (position.parMen !== null && position.strokeIndexMen !== null) catalog.holes.push({ id: holeId, courseId, holeNumber: position.number, par: position.parMen, strokeIndex: position.strokeIndexMen, greenFrontLatitude: position.green.front?.coordinate[1], greenFrontLongitude: position.green.front?.coordinate[0], greenCenterLatitude: position.green.center?.coordinate[1], greenCenterLongitude: position.green.center?.coordinate[0], greenBackLatitude: position.green.back?.coordinate[1], greenBackLongitude: position.green.back?.coordinate[0] });
      for (const point of position.points) catalog.geoFeatures.push({ id: point.id, holeId, type: featureType(point.type, point.location), latitude: point.coordinate[1], longitude: point.coordinate[0], ...provenance });
    }
    for (const tee of snapshot.tees) {
      const id = `${courseId}:golfapi-tee:${tee.externalId}`;
      // Ratings remain exclusively in the private source snapshot. Reusing a
      // provider rating as a current GHIN/local handicap rating is not automatic.
      catalog.tees.push({ id, courseId, legacySelectionId: id, name: tee.name ?? tee.externalId, color: tee.color ?? undefined, active: true, provider: 'GOLFAPI', providerCourseId: snapshot.externalCourseId, providerStatus: 'SOURCE_REVIEW_ONLY', ghinPostEligible: false });
      for (const length of tee.lengths) if (length.yards !== null) catalog.teeHoleYardages.push({ teeId: id, holeId: `${courseId}:golfapi-position:${length.position}`, holeNumber: length.position, yards: length.yards, meters: length.meters ?? undefined });
    }
  }
  return createCourseCatalogProvider(catalog, 'golfapi-stored-source', 'external');
}
