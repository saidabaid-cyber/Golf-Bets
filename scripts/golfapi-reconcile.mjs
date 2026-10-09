import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GolfApiFileStore, documentedRequest } from '../lib/golfapi/controlled-store.mjs';
import { normalizeGolfApiSnapshot, golfApiGeoJson, distancesToStoredGreen } from '../lib/golfapi/normalize.mjs';

/** Offline only. Original data and reports are written to the PRIVATE folder,
 * never public/, a fixture, a commit, or the active Course Master. */
export async function reconcileSavedGolfApi(env = process.env) {
  const store = new GolfApiFileStore(env.GOLFAPI_STORE_PATH);
  const mappings = JSON.parse(await readFile(env.GOLFAPI_MAPPING_PATH, 'utf8'));
  const existing = env.GOLFAPI_EXISTING_CARDS_PATH ? JSON.parse(await readFile(env.GOLFAPI_EXISTING_CARDS_PATH, 'utf8')).rows : [];
  const searchResponse = await store.cached(documentedRequest('clubs', { country: 'Mexico', state: 'PUE' }));
  if (!searchResponse || searchResponse.httpStatus !== 200) throw Error('GOLFAPI_REGIONAL_SEARCH_CACHE_REQUIRED');
  const clubs = JSON.parse(searchResponse.bodyText).clubs;
  const summaries = [];
  const color = value => ({ blue: 'blue', azules: 'blue', white: 'white', blancas: 'white', black: 'black', negras: 'black', yellow: 'gold', gold: 'gold', doradas: 'gold', red: 'red', rojas: 'red', silver: 'silver', plateadas: 'silver' }[String(value).toLowerCase()] ?? String(value).toLowerCase());
  for (const mapping of mappings.courses) {
    const club = clubs.find(row => row.clubID === mapping.externalClubId);
    const found = club?.courses.find(row => row.courseID === mapping.externalCourseId);
    if (!found) { summaries.push({ courseId: mapping.courseId, status: 'NOT_IDENTIFIED_IN_SAVED_SEARCH', coverage: null }); continue; }
    const coordinateResponse = await store.cached(documentedRequest(`coordinates/${mapping.externalCourseId}`));
    const courseResponse = await store.cached(documentedRequest(`courses/${mapping.externalCourseId}`));
    if (!coordinateResponse || coordinateResponse.httpStatus !== 200) { summaries.push({ courseId: mapping.courseId, status: 'COORDINATES_NOT_FETCHED', coverage: null }); continue; }
    const snapshot = normalizeGolfApiSnapshot({ searchCourse: { ...club, ...found }, course: courseResponse ? JSON.parse(courseResponse.bodyText) : null, coordinates: JSON.parse(coordinateResponse.bodyText), mapping, sources: { searchRequestKey: searchResponse.requestKey, coordinatesRequestKey: coordinateResponse.requestKey, courseRequestKey: courseResponse?.requestKey ?? null, fetchedAt: coordinateResponse.fetchedAt, licenseUrl: 'https://www.golfapi.io/' } });
    const sourceVersion = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    snapshot.source.sourceVersion = sourceVersion;
    const conflicts = [];
    for (const tee of snapshot.tees) for (const local of existing.filter(row => row.course_id === mapping.courseId && color(row.tee_name) === color(tee.name))) {
      const gender = local.gender;
      const rating = gender === 'MEN' || gender === 'WOMEN' ? tee.ratings.find(row => row.gender === gender) : null;
      const yards = tee.lengths.every(row => row.yards !== null) ? tee.lengths.reduce((total, row) => total + row.yards, 0) : null;
      if (yards !== null && local.total_yards !== null && Math.abs(yards - Number(local.total_yards)) > .1) conflicts.push({ type: 'YARDAGE_DIFFERENCE', existingTeeId: local.tee_id, providerTeeId: tee.externalId, existing: Number(local.total_yards), incoming: yards, action: 'KEEP_SEPARATE_NO_OVERWRITE' });
      if (rating && (rating.courseRating !== Number(local.rating) || rating.slope !== Number(local.slope))) conflicts.push({ type: 'RATING_DIFFERENCE', existingTeeId: local.tee_id, providerTeeId: tee.externalId, existing: { rating: local.rating, slope: local.slope }, incoming: rating, action: 'KEEP_SEPARATE_NO_OVERWRITE' });
      if (!gender) conflicts.push({ type: 'EXISTING_RATING_CATEGORY_UNSPECIFIED', existingTeeId: local.tee_id, action: 'NO_AUTOMATIC_RATING_MATCH' });
    }
    await store.putNormalized(mapping.externalCourseId, snapshot);
    await writeFile(path.join(store.root, `normalized-${mapping.externalCourseId}-${sourceVersion}.json`), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    await writeFile(path.join(store.root, `points-${mapping.externalCourseId}.geojson`), JSON.stringify(golfApiGeoJson(snapshot), null, 2), { mode: 0o600 });
    await writeFile(path.join(store.root, `diff-${mapping.externalCourseId}.json`), JSON.stringify({ sourceVersion, existingCourseId: mapping.courseId, activeCourseChanges: 0, conflicts, retainedUnknowns: snapshot.issues, physicalHoles: snapshot.physicalHoles }, null, 2), { mode: 0o600 });
    // Numeric integration check from the provider's OWN green center. This is
    // an explicitly synthetic origin for QA, not phone/camera/field evidence.
    const origin = snapshot.positions[0]?.green.center?.coordinate;
    const simulation = origin ? { mode: 'SIMULATED_PROVIDER_REFERENCE_NOT_PHONE_GPS', origin, result: distancesToStoredGreen(snapshot, 1, origin) } : null;
    await writeFile(path.join(store.root, `distance-test-${mapping.externalCourseId}.json`), JSON.stringify(simulation, null, 2), { mode: 0o600 });
    summaries.push({ courseId: mapping.courseId, externalCourseId: mapping.externalCourseId, status: courseResponse ? 'CARD_AND_POINTS_SAVED' : 'POINTS_SAVED_CARD_PENDING_BUDGET', coverage: snapshot.coverage, teeCount: snapshot.tees.length, providerUpdatedAt: snapshot.source.providerCourseUpdatedAt, issues: snapshot.issues, conflictCount: conflicts.length, physicalHolePairs: snapshot.physicalHoles.filter(row => row.cardPositions.length > 1).map(row => ({ number: row.number, positions: row.cardPositions, differencesMeters: row.greenPairDifferencesMeters, status: row.mappingStatus })) });
  }
  const ledger = await store.ledger();
  const report = { stageId: ledger.stageId, requestCount: ledger.attempts.length, requestLimit: 10, providerRequestsLeft: ledger.attempts.at(-1)?.providerRequestsLeft ?? null, remoteWrites: 0, activeCourseMasterChanges: 0, summaries };
  await writeFile(path.join(store.root, 'coverage.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/golfapi-reconcile.mjs')) {
  try { console.log(JSON.stringify(await reconcileSavedGolfApi(), null, 2)); }
  catch { console.error('GOLFAPI_RECONCILIATION_FAILED_NO_NETWORK'); process.exitCode = 1; }
}
