import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGolfApiSnapshot, distancesToStoredGreen, golfApiGeoJson } from '../lib/golfapi/normalize.mjs';

// Clearly synthetic fixture, never imported into real course data.
function fixture(count = 18, physicalHoleCount = 18) {
  const points = Array.from({ length: count }, (_, index) => [1, 2, 3].map(location => ({ hole: index + 1, poi: 1, location, sideFW: 2, latitude: 19 + (index % physicalHoleCount) * .0001 + location * .00001, longitude: -98.25 })) ).flat();
  return { searchCourse: { courseID: '100', clubID: '200', clubName: 'Synthetic La Vista', city: 'Puebla', state: 'PUE', country: 'Mexico', numHoles: count }, course: { courseID: '100', clubID: '200', numHoles: count, measure: 'y', parsMen: Array(count).fill(4), indexesMen: Array.from({ length: count }, (_, index) => index + 1), tees: [{ teeID: '1', teeName: 'Synthetic white', length1: 100, courseRatingMen: '71.2', slopeMen: '130', courseRatingWomen: '', slopeWomen: '' }] }, coordinates: { courseID: '100', numCoordinates: points.length, coordinates: points }, mapping: { courseId: 'existing-synthetic-course', clubId: 'existing-synthetic-club', physicalHoleCount, allowedNames: ['Synthetic La Vista'], referenceCoordinate: [-98.25, 19] }, sources: { fetchedAt: '2026-10-07T00:00:00Z', courseRequestKey: 'test-card', coordinatesRequestKey: 'test-points' } };
}

test('existing identity retained; geographic order is longitude, latitude', () => {
  const snapshot = normalizeGolfApiSnapshot(fixture());
  assert.equal(snapshot.mapping.courseId, 'existing-synthetic-course');
  assert.deepEqual(snapshot.positions[0].green.front.coordinate, [-98.25, 19.00001]);
  assert.equal(snapshot.coverage.greenFront, 18); assert.equal(snapshot.coverage.greenCenter, 18); assert.equal(snapshot.coverage.greenBack, 18);
  assert.deepEqual(golfApiGeoJson(snapshot).features[0].geometry.coordinates, [-98.25, 19.00001]);
  assert.equal(snapshot.positions[0].green.center.isFlag, false);
});

test('raw units and category ratings preserved; empty unknowns are null', () => {
  const snapshot = normalizeGolfApiSnapshot(fixture());
  assert.equal(snapshot.tees[0].lengths[0].originalValue, 100); assert.equal(snapshot.tees[0].lengths[0].originalUnit, 'yd');
  assert.ok(Math.abs(snapshot.tees[0].lengths[0].meters - 91.44) < 1e-9);
  assert.equal(snapshot.tees[0].lengths[1].originalValue, null);
  assert.equal(snapshot.tees[0].ratings[0].gender, 'MEN'); assert.equal(snapshot.tees[0].ratings[1].courseRating, null);
  assert.equal(snapshot.tees[0].ratings[0].courseRating, 71.2); assert.equal(snapshot.tees[0].ratings[0].slope, 130);
});

test('physical nine versus 18 positions remain separate; variants not averaged', () => {
  const input = fixture(18, 9); input.coordinates.coordinates.find(row => row.hole === 10 && row.location === 2).latitude += .00001;
  const snapshot = normalizeGolfApiSnapshot(input);
  assert.equal(snapshot.physicalHoles.length, 9); assert.equal(snapshot.positions.length, 18);
  assert.equal(snapshot.positions[0].physicalHoleId, snapshot.positions[9].physicalHoleId);
  assert.equal(snapshot.positions[9].lap, 2); assert.deepEqual(snapshot.physicalHoles[0].cardPositions, [1, 10]);
  assert.notDeepEqual(snapshot.positions[0].green.center.coordinate, snapshot.positions[9].green.center.coordinate);
  assert.ok(snapshot.physicalHoles[0].greenPairDifferencesMeters.center > 1);
  assert.match(snapshot.physicalHoles[0].mappingStatus, /PENDING_FIELD/);
});

test('physical mapping conflicts remain visible instead of silently deduplicating unrelated greens', () => {
  const input = fixture(18, 9); input.coordinates.coordinates.find(row => row.hole === 10 && row.location === 2).latitude += .001;
  const snapshot = normalizeGolfApiSnapshot(input); assert.equal(snapshot.physicalHoles[0].mappingStatus, 'TWO_LOOP_MAPPING_CONFLICT');
  assert.ok(snapshot.issues.includes('PHYSICAL_GREEN_PAIR_CONFLICT:1'));
});

test('bad coordinates, inverted order, out-of-region and invalid hole quarantined', () => {
  const input = fixture();
  input.coordinates.coordinates.push({ poi: 1, location: 2, hole: 19, latitude: 19, longitude: -98.25 }, { poi: 1, location: 2, hole: 1, latitude: -98.25, longitude: 19 }, { poi: 1, location: 2, hole: 1, latitude: 20, longitude: -98 });
  input.coordinates.numCoordinates = input.coordinates.coordinates.length;
  const snapshot = normalizeGolfApiSnapshot(input); assert.equal(snapshot.rejectedPoints.length, 3); assert.equal(snapshot.coverage.acceptedPoints, 54);
});

test('response IDs and Mexico/Puebla identity cannot be conflated with homonyms', () => {
  const input = fixture(); input.coordinates.courseID = '123'; assert.throws(() => normalizeGolfApiSnapshot(input), /CROSS_COURSE/);
  const homonym = fixture(); homonym.searchCourse.country = 'Japan'; assert.throws(() => normalizeGolfApiSnapshot(homonym), /IDENTITY_MISMATCH/);
});

test('conflicting green coordinates suppress ambiguous operational target', () => {
  const input = fixture(); input.coordinates.coordinates.push({ ...input.coordinates.coordinates[1], latitude: 19.001 }); input.coordinates.numCoordinates++;
  const snapshot = normalizeGolfApiSnapshot(input); assert.equal(snapshot.positions[0].green.center, null);
  assert.ok(snapshot.issues.includes('CONFLICTING_GREEN_POINT:1:center'));
});

test('missing scorecard never filled from another source; no invented tee or flag', () => {
  const input = fixture(); input.course = null;
  const snapshot = normalizeGolfApiSnapshot(input); assert.equal(snapshot.positions[0].parMen, null); assert.deepEqual(snapshot.tees, []);
  assert.equal(snapshot.positions[0].green.center.teeId, null); assert.equal(snapshot.positions[0].green.center.accuracyMeters, null);
  assert.ok(snapshot.issues.includes('FULL_SCORECARD_NOT_FETCHED_REQUEST_BUDGET'));
});

test('independent equatorial distance reference, yards conversion, missing green stays null', () => {
  // Test only: separate mathematical snapshot, explicitly not Puebla geometry.
  const snapshot = normalizeGolfApiSnapshot(fixture());
  snapshot.positions[0].green.front = null;
  snapshot.positions[0].green.center.coordinate = [1, 0]; snapshot.positions[0].green.back = null;
  const result = distancesToStoredGreen(snapshot, 1, [0, 0]);
  assert.equal(result.front, null); assert.equal(result.back, null);
  assert.ok(Math.abs(result.center.meters - 111319.490793) < .001);
  assert.ok(Math.abs(result.center.yards * .9144 - result.center.meters) < 1e-6);
  assert.equal(result.center.fieldVerified, false); assert.equal(result.center.isFlag, false);
});

test('source values not mutated by normalizer or local distances', () => {
  const input = fixture(); const before = structuredClone(input);
  const snapshot = normalizeGolfApiSnapshot(input); distancesToStoredGreen(snapshot, 1, [-98.25, 19]);
  assert.deepEqual(input, before); assert.equal(snapshot.source.coordinateCaptureDate, null);
});
