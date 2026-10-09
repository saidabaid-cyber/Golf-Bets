// Pure ingestion normalization. No network, map renderer, account data or
// mutation of the active Course Master. Provider points are not surveyed flags.
import { distanceMeters, toYards, validCoordinate } from '../gps-pilot-la-vista-1/geodesic.mjs';

const POI = { 1: 'GREEN', 2: 'GREEN_BUNKER', 3: 'FAIRWAY_BUNKER', 4: 'WATER', 5: 'TREES', 6: '100_MARKER', 7: '150_MARKER', 8: '200_MARKER', 9: 'DOGLEG', 10: 'ROAD', 11: 'FRONT_TEE', 12: 'BACK_TEE' };
const LOCATION = { 1: 'front', 2: 'center', 3: 'back' };
const numeric = value => (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const ranged = (value, low, high) => { const number = numeric(value); return number !== null && number >= low && number <= high ? number : null; };
const integer = (value, low, high) => { const number = ranged(value, low, high); return Number.isInteger(number) ? number : null; };
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const updatedAt = value => { const seconds = numeric(value); return seconds !== null && seconds > 0 && seconds < 1e11 ? new Date(seconds * 1000).toISOString() : null; };

function pointFromFields(input) {
  const latitude = ranged(input.latitude, -90, 90), longitude = ranged(input.longitude, -180, 180);
  return latitude !== null && longitude !== null && (latitude !== 0 || longitude !== 0) ? [longitude, latitude] : null;
}
function rating(tee, gender, holes) {
  const suffix = gender === 'MEN' ? 'Men' : 'Women';
  return { gender, holeCount: holes, courseRating: ranged(tee[`courseRating${suffix}`], 1, 100), slope: integer(tee[`slope${suffix}`], 55, 155), frontCourseRating: ranged(tee[`courseRating${suffix}Front9`], 1, 100), backCourseRating: ranged(tee[`courseRating${suffix}Back9`], 1, 100), frontSlope: integer(tee[`slope${suffix}Front9`], 55, 155), backSlope: integer(tee[`slope${suffix}Back9`], 55, 155), status: 'PROVIDER_REPORTED_NOT_GHIN_VERIFIED' };
}
function lengths(tee, count, measure) {
  return Array.from({ length: count }, (_, index) => {
    const originalValue = ranged(tee[`length${index + 1}`], 1, 2000);
    const meters = originalValue === null ? null : measure === 'y' ? originalValue * 0.9144 : measure === 'm' ? originalValue : null;
    return { position: index + 1, originalValue, originalUnit: measure === 'y' ? 'yd' : measure === 'm' ? 'm' : null, meters, yards: meters === null ? null : toYards(meters) };
  });
}

/** Mapping is an explicit, reviewed link to EXISTING IDs, never a generated
 * duplicate catalog entry. Search identity and geographical containment are
 * independent checks; proximity alone cannot identify a club or a hole. */
export function normalizeGolfApiSnapshot({ searchCourse, course = null, coordinates, mapping, sources }) {
  if (!mapping?.courseId || !mapping?.clubId || !/^\d+$/.test(searchCourse?.courseID ?? '')) throw Error('GOLFAPI_REVIEWED_MAPPING_REQUIRED');
  const externalCourseId = searchCourse.courseID, externalClubId = searchCourse.clubID;
  if (coordinates?.courseID !== externalCourseId || (course && (course.courseID !== externalCourseId || course.clubID !== externalClubId))) throw Error('GOLFAPI_CROSS_COURSE_RESPONSE');
  if (String(searchCourse.country).toLowerCase() !== 'mexico' || String(searchCourse.state).toLowerCase() !== 'pue' || !mapping.allowedNames.some(name => String(searchCourse.clubName).toLowerCase().trim() === name.toLowerCase())) throw Error('GOLFAPI_IDENTITY_MISMATCH');
  const count = integer(course?.numHoles ?? searchCourse.numHoles, 1, 36);
  if (count !== 9 && count !== 18) throw Error('GOLFAPI_HOLE_COUNT_UNSUPPORTED');
  if (!validCoordinate(mapping.referenceCoordinate)) throw Error('GOLFAPI_REFERENCE_LOCATION_REQUIRED');
  const clubLocation = course ? pointFromFields(course) : null;
  if (clubLocation && distanceMeters(clubLocation, mapping.referenceCoordinate) > 5000) throw Error('GOLFAPI_GENERAL_LOCATION_MISMATCH');
  const measure = text(course?.measure), issues = [];
  const tees = (course?.tees ?? []).map(tee => ({ externalId: String(tee.teeID), name: text(tee.teeName), color: text(tee.teeColor), lengths: lengths(tee, count, measure), ratings: [rating(tee, 'MEN', count), rating(tee, 'WOMEN', count)], holeOverrides: Array.from({ length: count }, (_, index) => ({ position: index + 1, parMen: integer(tee.pars?.[index], 3, 6), parWomen: integer(tee.parsWomen?.[index], 3, 6), strokeIndexMen: integer(tee.indexes?.[index], 1, 18), strokeIndexWomen: integer(tee.indexesWomen?.[index], 1, 18) })), source: sources.courseRequestKey }));
  const positions = Array.from({ length: count }, (_, index) => ({ number: index + 1, lap: mapping.physicalHoleCount === 9 && count === 18 ? (index < 9 ? 1 : 2) : 1, physicalHoleId: null, parMen: integer(course?.parsMen?.[index], 3, 6), parWomen: integer(course?.parsWomen?.[index], 3, 6), strokeIndexMen: integer(course?.indexesMen?.[index], 1, 18), strokeIndexWomen: integer(course?.indexesWomen?.[index], 1, 18), green: { front: null, center: null, back: null }, points: [] }));
  const rejectedPoints = [], seen = new Set();
  for (const [index, input] of (coordinates?.coordinates ?? []).entries()) {
    const number = integer(input.hole, 1, count), coordinate = pointFromFields(input);
    const type = POI[numeric(input.poi)] ?? 'UNKNOWN', location = LOCATION[numeric(input.location)] ?? 'unknown';
    if (!number || !coordinate || distanceMeters(mapping.referenceCoordinate, coordinate) > 5000) {
      rejectedPoints.push({ originalIndex: index, reason: !number ? 'INVALID_HOLE_NUMBER' : !coordinate ? 'INVALID_COORDINATE' : 'OUTSIDE_COURSE_REGION', raw: input }); continue;
    }
    const key = `${number}:${input.poi}:${input.location}:${input.sideFW}:${coordinate.join(',')}`;
    if (seen.has(key)) issues.push(`DUPLICATE_PROVIDER_POINT:${index}`); seen.add(key);
    const point = { id: `golfapi:${externalCourseId}:point:${index}`, position: number, type, location, sideFW: numeric(input.sideFW), coordinate, originalIndex: index, rawCodes: { poi: input.poi, location: input.location, sideFW: input.sideFW }, accuracyMeters: null, observedAt: null, source: sources.coordinatesRequestKey, validation: 'PROVIDER_REPORTED_NOT_FIELD_VERIFIED', teeId: null, isFlag: false };
    positions[number - 1].points.push(point);
    if (type === 'GREEN' && location !== 'unknown') {
      const current = positions[number - 1].green[location];
      if (current && current.coordinate.join(',') !== coordinate.join(',')) {
        issues.push(`CONFLICTING_GREEN_POINT:${number}:${location}`);
        positions[number - 1].green[location] = null;
      } else if (!issues.includes(`CONFLICTING_GREEN_POINT:${number}:${location}`)) positions[number - 1].green[location] = point;
    }
  }
  if (Number(coordinates.numCoordinates) !== coordinates.coordinates.length) issues.push('COORDINATE_COUNT_MISMATCH');
  const physicalCount = mapping.physicalHoleCount ?? count;
  const physicalHoles = Array.from({ length: physicalCount }, (_, index) => ({ id: `${mapping.courseId}:physical:${index + 1}`, number: index + 1, cardPositions: [], mappingStatus: 'PROVIDER_NUMBERED_NOT_FIELD_VERIFIED', greenPairDifferencesMeters: null }));
  if (physicalCount === 9 && count === 18) {
    for (let index = 0; index < 9; index++) {
      const first = positions[index], second = positions[index + 9];
      const differences = Object.fromEntries(['front', 'center', 'back'].map(role => [role, first.green[role] && second.green[role] ? distanceMeters(first.green[role].coordinate, second.green[role].coordinate) : null]));
      // Preserve TWO source observations, not a fabricated averaged green.
      // Repeated labels plus user-confirmed 9 physical holes support a candidate
      // two-loop association; differing coordinates still require review.
      physicalHoles[index].cardPositions = [first.number, second.number];
      physicalHoles[index].greenPairDifferencesMeters = differences;
      physicalHoles[index].mappingStatus = Object.values(differences).every(value => value !== null && value <= 15) ? 'TWO_LOOP_PROVIDER_PAIR_PENDING_FIELD_REVIEW' : 'TWO_LOOP_MAPPING_CONFLICT';
      if (physicalHoles[index].mappingStatus === 'TWO_LOOP_MAPPING_CONFLICT') issues.push(`PHYSICAL_GREEN_PAIR_CONFLICT:${index + 1}`);
      first.physicalHoleId = physicalHoles[index].id; second.physicalHoleId = physicalHoles[index].id;
    }
    issues.push('LAS_FUENTES_9_PHYSICAL_18_CARD_POSITIONS_COORDINATE_VARIANTS_RETAINED');
  } else positions.forEach((position, index) => { position.physicalHoleId = physicalHoles[index].id; physicalHoles[index].cardPositions = [position.number]; });
  if (!course) issues.push('FULL_SCORECARD_NOT_FETCHED_REQUEST_BUDGET');
  if (!positions.some(position => position.points.some(point => ['FRONT_TEE', 'BACK_TEE'].includes(point.type)))) issues.push('TEE_COORDINATES_NOT_PROVIDED');
  issues.push('PROVIDER_GPS_ACCURACY_AND_CAPTURE_DATE_UNKNOWN', 'CRS_ASSUMED_LONGITUDE_LATITUDE_DATUM_NOT_DOCUMENTED');
  const coverage = { positions: count, physicalHoles: physicalCount, holesWithCoordinates: positions.filter(position => position.points.length).length, greenFront: positions.filter(position => position.green.front).length, greenCenter: positions.filter(position => position.green.center).length, greenBack: positions.filter(position => position.green.back).length, teePoints: positions.flatMap(position => position.points).filter(point => ['FRONT_TEE', 'BACK_TEE'].includes(point.type)).length, hazardsOrReferences: positions.flatMap(position => position.points).filter(point => !['GREEN', 'FRONT_TEE', 'BACK_TEE'].includes(point.type)).length, acceptedPoints: positions.reduce((total, position) => total + position.points.length, 0), rejectedPoints: rejectedPoints.length };
  return { schemaVersion: 1, provider: 'GOLFAPI', apiVersion: '2.3', externalCourseId, externalClubId, mapping, source: { ...sources, providerCourseUpdatedAt: updatedAt(course?.timestampUpdated ?? searchCourse.timestampUpdated), accuracyMeters: null, coordinateCaptureDate: null, validation: 'PROVIDER_REPORTED_NOT_FIELD_VERIFIED', redistributable: false }, club: { name: course?.clubName ?? searchCourse.clubName, city: course?.city ?? searchCourse.city, state: course?.state ?? searchCourse.state, country: course?.country ?? searchCourse.country, address: course?.address ?? searchCourse.address, generalLocation: clubLocation }, course: { name: text(course?.courseName ?? searchCourse.courseName), declaredHoles: count, measure, oldCourseIDs: course?.oldCourseIDs ?? [] }, tees, positions, physicalHoles, coverage, rejectedPoints, issues };
}

/** Static provider-labelled references. Front/back do not dynamically rotate
 * with the player's approach, and center is explicitly NOT a daily flag. */
export function distancesToStoredGreen(snapshot, positionNumber, playerCoordinate) {
  const position = snapshot.positions.find(row => row.number === positionNumber);
  if (!position || !validCoordinate(playerCoordinate)) throw Error('GOLFAPI_DISTANCE_INPUT_INVALID');
  return Object.fromEntries(['front', 'center', 'back'].map(role => {
    const point = position.green[role];
    const meters = point ? distanceMeters(playerCoordinate, point.coordinate) : null;
    return [role, meters === null ? null : { meters, yards: toYards(meters), reference: `PROVIDER_FIXED_GREEN_${role.toUpperCase()}`, fieldVerified: false, isFlag: false }];
  }));
}

export function golfApiGeoJson(snapshot) {
  return { type: 'FeatureCollection', features: snapshot.positions.flatMap(position => position.points.map(point => ({ type: 'Feature', id: point.id, geometry: { type: 'Point', coordinates: [...point.coordinate] }, properties: { ...point, coordinate: undefined, courseId: snapshot.mapping.courseId, externalCourseId: snapshot.externalCourseId, physicalHoleId: position.physicalHoleId, lap: position.lap, isFlag: false } }))) };
}
