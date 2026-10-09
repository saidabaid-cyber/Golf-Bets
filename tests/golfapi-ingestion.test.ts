import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { savedGolfApiCatalogProvider } from '../lib/golfapi/catalog';
import type { GolfApiSnapshot } from '../lib/golfapi/normalize.mjs';

test('controlled ingestion and normalization offline tests execute real assertions', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', 'scripts/golfapi-ingest.test.mjs', 'scripts/golfapi-normalize.test.mjs', 'scripts/golfapi-cache-db.test.mjs'], { cwd: process.cwd(), env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /tests 22/);
  assert.match(result.stdout, /fail 0/);
});

test('server boundary reads stored snapshots and cannot trigger upstream or expose ratings as official', () => {
  const code = fs.readFileSync('lib/golfapi/source.server.ts', 'utf8');
  const projection = fs.readFileSync('lib/golfapi/catalog.ts', 'utf8');
  assert.match(code, /import 'server-only'/);
  assert.match(projection, /createCourseCatalogProvider/);
  const localReader = fs.readFileSync('lib/golfapi/local-store.server.ts', 'utf8');
  assert.match(localReader, /GOLFAPI_LOCAL_FILES_NOT_DEPLOYMENT_PERSISTENCE/);
  assert.doesNotMatch(localReader + code, /controlled-store|\.request\(/);
  assert.match(code, /isolatedPreviewDatabaseEnabled/);
  assert.doesNotMatch(code, /\bfetch\s*\(|GOLFAPI_API_KEY|NEXT_PUBLIC_GOLFAPI/);
  assert.match(projection, /ghinPostEligible: false/);
  assert.doesNotMatch(code, /\.from\(['"]golf_course_tees|\.update\(/);
});

function syntheticSnapshot(): GolfApiSnapshot {
  return {
    schemaVersion: 1, provider: 'GOLFAPI', externalCourseId: '00100', externalClubId: '00200',
    mapping: { courseId: 'existing-synthetic-course', clubId: 'existing-synthetic-club', referenceCoordinate: [-98, 19], allowedNames: ['Synthetic Club'] },
    source: { fetchedAt: '2026-10-07T00:00:00Z', coordinatesRequestKey: 'synthetic', courseRequestKey: 'synthetic-card', providerCourseUpdatedAt: null, validation: 'PROVIDER_NOT_FIELD_VERIFIED' },
    club: { name: 'Synthetic Club', city: 'Puebla', state: 'PUE', country: 'Mexico', generalLocation: [-98, 19] },
    course: { name: 'Synthetic Course', declaredHoles: 9, measure: 'y' },
    tees: [{ externalId: '0001', name: 'Synthetic White', color: 'white', lengths: [{ position: 1, originalValue: 100, originalUnit: 'yd', meters: 91.44, yards: 100 }], ratings: [{ gender: 'MEN', holeCount: 9, courseRating: 35, slope: 120, frontCourseRating: null, backCourseRating: null }] }],
    positions: [{ number: 1, lap: 1, physicalHoleId: 'synthetic-physical-1', parMen: 4, parWomen: 4, strokeIndexMen: 1, strokeIndexWomen: 1, green: { front: null, back: null, center: { id: 'synthetic-green', position: 1, type: 'GREEN', location: 'center', sideFW: 2, coordinate: [-98.001, 19.001], originalIndex: 0, accuracyMeters: null, observedAt: null, source: 'SYNTHETIC_TEST_ONLY', validation: 'NOT_REAL', teeId: null, isFlag: false } }, points: [] }],
    physicalHoles: [], coverage: { positions: 1, physicalHoles: 1, holesWithCoordinates: 1, greenFront: 0, greenCenter: 1, greenBack: 0, teePoints: 0, hazardsOrReferences: 0, acceptedPoints: 1, rejectedPoints: 0 }, issues: [], rejectedPoints: [],
  };
}

test('saved source reuses existing provider IDs and repeated reads do not call a network loader', async () => {
  const snapshot = syntheticSnapshot(); const original = structuredClone(snapshot);
  const provider = savedGolfApiCatalogProvider([snapshot]);
  const clubs = await provider.searchClubs('synthetic');
  assert.equal(clubs.ok, true); if (!clubs.ok) return;
  assert.equal(clubs.data.clubs[0].id, 'existing-synthetic-club');
  assert.equal(clubs.data.clubs[0].providerExternalId, '00200');
  const courses = await provider.getCourses('existing-synthetic-club');
  assert.equal(courses.ok, true); if (!courses.ok) return;
  assert.equal(courses.data[0].id, 'existing-synthetic-course');
  const tees = await provider.getTees('existing-synthetic-course');
  assert.equal(tees.ok, true); if (!tees.ok) return;
  assert.equal(tees.data[0].rating, undefined); assert.equal(tees.data[0].slope, undefined);
  assert.equal(tees.data[0].ghinPostEligible, false);
  const holes = await provider.getHoles('existing-synthetic-course');
  assert.equal(holes.ok, true); if (!holes.ok) return;
  assert.equal(holes.data[0].greenCenterLongitude, -98.001);
  assert.equal(holes.data[0].greenCenterLatitude, 19.001);
  assert.deepEqual(await provider.getHoles('existing-synthetic-course'), holes);
  assert.deepEqual(snapshot, original);
});

test('coordinate-only source does not invent a scorecard from missing par/index', async () => {
  const snapshot = syntheticSnapshot(); snapshot.positions[0].parMen = null; snapshot.positions[0].strokeIndexMen = null; snapshot.tees = [];
  const provider = savedGolfApiCatalogProvider([snapshot]);
  assert.equal((await provider.getHoles('existing-synthetic-course')).ok, false);
  assert.equal((await provider.getTees('existing-synthetic-course')).ok, false);
  assert.equal(snapshot.positions[0].green.center?.isFlag, false);
});

test('pending cache is private, append-only, service-only and changes no active course records', () => {
  const sql = fs.readFileSync('scripts/sql/golfapi-private-cache.pending.sql', 'utf8');
  assert.match(sql, /PENDING_CONTROLLED_DB_APPLY/);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /security invoker/);
  assert.doesNotMatch(sql, /security definer|drop table|truncate|grant [^;]+ to authenticated|update public\.(?:golf_|round|profiles)/i);
  assert.match(sql, /references public.golf_courses\(id\)/);
});
