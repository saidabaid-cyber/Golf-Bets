import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { GPS_SAVED_COURSES, gpsCourseProjection, reviewedClubCardGps } from '../lib/golf-gps/projection';
import type { GolfApiSnapshot } from '../lib/golfapi/normalize.mjs';
import { isGpsPilotTester } from '../lib/gps-pilot-la-vista-1/access';
import { isCrossSiteRequest } from '../lib/backyard-ai/server/http-security';

// Synthetic contract fixture. These are NOT geographic measurements of Puebla.
function snapshot(index = 0): GolfApiSnapshot {
  const row = GPS_SAVED_COURSES[index];
  const physicalCount = index === 2 ? 9 : 18;
  const point = (position: number, type: string, longitude: number) => ({ id: `${position}:${type}`, position, type, coordinate: [longitude, 0], teeId: null, isFlag: false });
  return {
    schemaVersion: 1, provider: 'GOLFAPI', externalCourseId: row.externalId,
    mapping: { courseId: row.id },
    source: { providerCourseUpdatedAt: '2025-01-01', coordinatesRequestKey: 'PRIVATE_REQUEST_NOT_FOR_CLIENT', fetchedAt: 'PRIVATE_FETCH_DATE' },
    tees: [{ ratings: [{ courseRating: 72, slope: 120 }] }],
    positions: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, lap: Math.floor(i / physicalCount) + 1, physicalHoleId: `physical-${i % physicalCount + 1}`,
      green: { front: point(i + 1, 'GREEN_FRONT', .001 + i * .001), center: point(i + 1, 'GREEN_CENTER', .002 + i * .001), back: point(i + 1, 'GREEN_BACK', .003 + i * .001) },
      points: [point(i + 1, 'FRONT_TEE', .0001), point(i + 1, 'UNKNOWN_PROVIDER_POINT', .0002)] })),
    physicalHoles: Array.from({ length: physicalCount }, (_, i) => ({ id: `physical-${i + 1}`, number: i + 1, mappingStatus: physicalCount === 9 ? 'TWO_LOOP_PROVIDER_PAIR_PENDING_FIELD_REVIEW' : 'ONE_TO_ONE', greenPairDifferencesMeters: physicalCount === 9 ? { front: 2, center: 3, back: 4 } : null })),
    rejectedPoints: [{ raw: { secret: 'PRIVATE_QUARANTINED_POINT' }, reason: 'OUTSIDE_COURSE' }],
  } as unknown as GolfApiSnapshot;
}

test('GPS portable map/device/distance regressions run without upstream network', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ['--test', 'scripts/golf-gps.test.mjs'], { cwd: process.cwd(), encoding: 'utf8', env });
  assert.match(output, /(?:#|ℹ) tests \d+/); assert.match(output, /(?:#|ℹ) fail 0/);
});
test('player DTO preserves green roles and GeoJSON longitude/latitude order without private payload', () => {
  const original = snapshot(); const before = JSON.stringify(original); const dto = gpsCourseProjection(original);
  assert.deepEqual(dto.holes[0].green.front, [.001, 0]); assert.deepEqual(dto.holes[0].green.center, [.002, 0]); assert.deepEqual(dto.holes[0].green.back, [.003, 0]);
  assert.equal(dto.holes[0].references.length, 1); assert.equal(dto.holes[0].references[0].label, 'Tee delantero (sin color asignado)');
  assert.equal(dto.source.fieldVerified, false); assert.equal(dto.source.accuracyMeters, null); assert.equal(dto.source.coordinateCaptureDate, null);
  for (const value of ['PRIVATE_', 'courseRating', 'slope', 'rejectedPoints', 'externalCourseId', 'UNKNOWN_PROVIDER_POINT']) assert.equal(JSON.stringify(dto).includes(value), false);
  dto.holes[0].green.center![0] = 45; assert.equal(JSON.stringify(original), before);
});
test('Las Fuentes keeps nine physical holes, eighteen card positions and both coordinate observations', () => {
  const dto = gpsCourseProjection(snapshot(2));
  assert.equal(dto.physicalHoleCount, 9); assert.equal(dto.cardPositionCount, 18);
  assert.equal(new Set(dto.holes.map(h => h.physicalHoleId)).size, 9);
  assert.equal(dto.holes[0].physicalHoleId, dto.holes[9].physicalHoleId);
  assert.equal(dto.holes[0].lap, 1); assert.equal(dto.holes[9].lap, 2);
  assert.notDeepEqual(dto.holes[0].green.center, dto.holes[9].green.center);
  assert.equal(dto.holes[9].pairingDifferencesMeters!.center, 3);
});
test('unreviewed identity/provider/schema cannot be served as another saved course', () => {
  for (const changed of [{ ...snapshot(), provider: 'OTHER' }, { ...snapshot(), schemaVersion: 2 }, { ...snapshot(), mapping: { courseId: 'different' } }]) assert.throws(() => gpsCourseProjection(changed as GolfApiSnapshot), /GPS_UNREVIEWED_SOURCE_IDENTITY/);
  assert.equal(GPS_SAVED_COURSES.length, 4); assert.equal(GPS_SAVED_COURSES.some(c => c.name.includes('Cola')), false);
});

const reviewedAlias = { id:'course-la-vista-club-current',club_id:'club-la-vista',holes:18,is_provisional:false,
 catalog_metadata:{dataVersion:'la-vista-club-current-2026-09-28',ghin_provider_alias_v1:{status:'CONFIRMED',provider:'GHIN',club_id:'club-la-vista',canonical_course_id:'course-la-vista',provider_course_id:'23233',provider_facility_id:'19886',source_data_version:'la-vista-club-current-2026-09-28',evidence:'OWNED_SESSION_LIVE_COURSE_AND_GOLD_18_HOLE_GEOMETRY'}}};
test('current club card reuses only persisted reviewed physical identity, never temporary or mismatched cards',()=>{
 const original=gpsCourseProjection(snapshot()),before=JSON.stringify(original);
 const alias=reviewedClubCardGps([original],reviewedAlias)!;
 assert.equal(alias.id,'course-la-vista-club-current');assert.equal(alias.holes,original.holes);assert.equal(JSON.stringify(original),before);
 for(const patch of [{id:'course-la-vista-temporary-par-70'},{id:'course-la-vista-temporary-par-69'},{is_provisional:true},{holes:9},{club_id:'other'}, {catalog_metadata:{...reviewedAlias.catalog_metadata,dataVersion:'changed'}},{catalog_metadata:{...reviewedAlias.catalog_metadata,ghin_provider_alias_v1:{...reviewedAlias.catalog_metadata.ghin_provider_alias_v1,status:'PENDING'}}}]) assert.equal(reviewedClubCardGps([original],{...reviewedAlias,...patch}),null);
 assert.equal(reviewedClubCardGps([],reviewedAlias),null);
});

const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<object>;
const pilot = nativeImport(pathToFileURL(resolve('lib/gps-pilot-la-vista-1/pilot.mjs')).href);
const routeSource = readFileSync('app/api/golf-gps/courses/route.ts', 'utf8');
const routeJs = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const savedSourceJs = ts.transpileModule(readFileSync('lib/golf-gps/saved-courses.server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const tester = '11111111-1111-4111-8111-111111111111', outsider = '22222222-2222-4222-8222-222222222222';
type Access = { ok: boolean; userId?: string; status?: number; error?: string; code?: string };
async function route(options: { account?: Access; admin?: Access; env?: Record<string, string>; missing?: number[]; database?: boolean } = {}) {
  let authCalls = 0, adminCalls = 0, dbCalls = 0; const reads: string[] = [];
  const exports: any = {}, modules = await pilot;
  const savedExports: any = {};
  runInNewContext(savedSourceJs,{exports:savedExports,Date,Promise,require(specifier:string){
    if(specifier==='server-only')return {};
    if(specifier.endsWith('/projection'))return {GPS_SAVED_COURSES,gpsCourseProjection,reviewedClubCardGps};
    if(specifier.endsWith('source.server'))return {devGolfApiSnapshotStore:()=>({readNormalized:async(id:string)=>{reads.push(id);const index=GPS_SAVED_COURSES.findIndex(c=>c.externalId===id);if(options.missing?.includes(index))throw Error('PRIVATE_STORAGE_ERROR');return snapshot(index);}})};
    throw Error('Unexpected storage dependency');
  }});

  runInNewContext(routeJs, { exports, Promise, process: { env: { GOLF_GPS_ENABLED: 'true', GOLF_GPS_MAPS_ENABLED: 'false', GPS_LA_VISTA_1_PILOT_USER_IDS: tester, VERCEL_GIT_COMMIT_REF: 'integration/backyard-current', VERCEL_ENV: 'preview', ...options.env } }, require(specifier: string) {
    if (specifier === 'next/server') return { NextResponse: { json: (body: unknown, config: object) => ({ body, ...config }) } };
    if (specifier.endsWith('server-auth')) return { authenticatedRequest: async () => { authCalls++; return options.account ?? { ok: true, userId: outsider }; } };
    if (specifier.endsWith('admin-mode.server')) return { requireAdminMode: async (_: unknown, module: string) => { assert.equal(module, 'courses'); adminCalls++; return options.admin ?? { ok: false, status: 403, code: 'ADMIN_PERMISSION_DENIED' }; } };
    if (specifier.endsWith('supabase/server')) return { getSupabaseAdmin: () => { dbCalls++; return options.database === false ? null : {}; } };
    if (specifier.endsWith('http-security')) return { isCrossSiteRequest };
    if (specifier.endsWith('/access')) return { isGpsPilotTester };
    if (specifier.endsWith('pilot.mjs')) return modules;
    if (specifier.endsWith('saved-courses.server')) return savedExports;
    if (specifier.endsWith('source.server')) return { devGolfApiSnapshotStore: () => ({ readNormalized: async (id: string) => { reads.push(id); const index = GPS_SAVED_COURSES.findIndex(c => c.externalId === id); if (options.missing?.includes(index)) throw Error('PRIVATE_STORAGE_ERROR'); return snapshot(index); } }) };
    throw Error('Unexpected dependency; no upstream client allowed');
  } });
  return { get: exports.GET as (request: object) => Promise<any>, counts: () => ({ authCalls, adminCalls, dbCalls }), reads };
}
const request = (host = 'dev.thebackyard.com.mx', extra: Record<string, string> = {}) => ({ url: `https://${host}/api/golf-gps/courses`, headers: new Headers({ host, ...extra }) });
test('disabled feature and protected/non-canonical deployments do not read session or storage', async () => {
  for (const [env, host] of [[{ GOLF_GPS_ENABLED: '' }, 'dev.thebackyard.com.mx'], [{ VERCEL_ENV: 'production' }, 'dev.thebackyard.com.mx'], [{ VERCEL_GIT_COMMIT_REF: 'main' }, 'dev.thebackyard.com.mx'], [{}, 'app.thebackyard.com.mx'], [{}, 'beta.thebackyard.com.mx'], [{}, 'preview.vercel.app']] as const) {
    const r = await route({ env }); assert.equal((await r.get(request(host))).status, 404); assert.deepEqual(r.counts(), { authCalls: 0, adminCalls: 0, dbCalls: 0 });
  }
});
test('anonymous, lifecycle-denied and non-entitled accounts cannot read private data', async () => {
  for (const [account, status] of [[{ ok: false, status: 401, code: 'AUTH_REQUIRED' }, 401], [{ ok: false, status: 403, userId: tester, code: 'ACCOUNT_DEACTIVATED' }, 403], [{ ok: true, userId: outsider }, 403]] as const) {
    const r = await route({ account }); const response = await r.get(request()); assert.equal(response.status, status); assert.equal(response.body.courses, undefined); assert.equal(r.counts().dbCalls, 0);
  }
});
test('tester gets a private minimal DTO through cached reads without global admin elevation', async () => {
  const r = await route({ account: { ok: true, userId: tester } }); const response = await r.get(request());
  assert.equal(response.status, 200); assert.equal(response.body.courses.length, 4); assert.equal(response.body.mapsEnabled, false);
  assert.equal(response.headers['cache-control'], 'private, no-store'); assert.equal(r.counts().adminCalls, 0);
  assert.deepEqual(r.reads, GPS_SAVED_COURSES.map(c => c.externalId)); assert.equal(JSON.stringify(response.body).includes('PRIVATE_'), false);
});
test('existing server-confirmed course admin remains supported and temporary access errors are not denial', async () => {
  const granted = await route({ admin: { ok: true } }); assert.equal((await granted.get(request())).status, 200);
  const unavailable = await route({ admin: { ok: false, status: 503, code: 'ADMIN_ACCESS_UNAVAILABLE' } }); assert.equal((await unavailable.get(request())).status, 503); assert.equal(unavailable.counts().dbCalls, 0);
});
test('query/headers cannot forge pilot entitlement and cross-site attempts stop before session/storage', async () => {
  const r = await route(); assert.equal((await r.get({ ...request(), url: request().url + `?userId=${tester}&role=ADMIN` })).status, 403); assert.equal(r.counts().dbCalls, 0);
  for (const extra of [{ origin: 'https://other.example' }, { 'sec-fetch-site': 'cross-site' }] as Array<Record<string, string>>) { const cross = await route({ account: { ok: true, userId: tester } }); assert.equal((await cross.get(request(undefined, extra))).status, 403); assert.equal(cross.counts().authCalls, 0); }
});
test('partial cached availability stays useful; unavailable storage is an explicit controlled-import pending', async () => {
  const partial = await route({ account: { ok: true, userId: tester }, missing: [3] }); const response = await partial.get(request()); assert.equal(response.status, 200); assert.equal(response.body.courses.length, 3); assert.deepEqual(Array.from(response.body.unavailable), ['course-el-cristo']);
  const empty = await route({ account: { ok: true, userId: tester }, missing: [0, 1, 2, 3] }); const noRows = await empty.get(request()); assert.equal(noRows.status, 503); assert.equal(noRows.body.code, 'PENDING_CONTROLLED_DB_APPLY'); assert.equal(JSON.stringify(noRows.body).includes('PRIVATE_STORAGE_ERROR'), false);
});

test('two authorized accounts read the same persisted course versions without an upstream client', async()=>{
  const first=await route({account:{ok:true,userId:tester}});
  const second=await route({account:{ok:true,userId:outsider},admin:{ok:true,userId:outsider}});
  const a=await first.get(request()),b=await second.get(request());
  assert.equal(a.status,200);assert.equal(b.status,200);assert.deepEqual(a.body.courses,b.body.courses);
  assert.deepEqual(first.reads,second.reads);assert.equal(first.counts().dbCalls,second.counts().dbCalls);
});


test('concurrent authorized readers coalesce the same private stored version; no upstream requests',async()=>{
 const reads:string[]=[],exports:any={};let aliasReads=0;
 let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
 runInNewContext(savedSourceJs,{exports,Date,Promise,require(name:string){
  if(name==='server-only')return {};
  if(name.endsWith('/projection'))return {GPS_SAVED_COURSES,gpsCourseProjection,reviewedClubCardGps};
  if(name.endsWith('source.server'))return {devGolfApiSnapshotStore:()=>({readNormalized:async(id:string)=>{reads.push(id);await hold;return snapshot(GPS_SAVED_COURSES.findIndex(c=>c.externalId===id));}})};
  throw Error('No provider client may be imported');
 }});
 const database={from(table:string){assert.equal(table,'golf_courses');return{select(){return{eq(_key:string,id:string){assert.equal(id,'course-la-vista-club-current');return{async maybeSingle(){aliasReads++;return{data:reviewedAlias,error:null};}};}};}};}};
 const a=exports.readSavedGpsCourses(database),b=exports.readSavedGpsCourses(database);
 assert.equal(a,b);assert.equal(reads.length,4);release();
 const first=await a,second=await b;assert.equal(first,second);assert.equal(first.courses.length,5);assert.equal(aliasReads,1);
 assert.equal(await exports.readSavedGpsCourses(database),first);assert.equal(reads.length,4);assert.equal(aliasReads,1);
});
