import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { isolatedPreviewDatabaseEnabled } from '../lib/preview-database';

const compile = (filename: string) => ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
test('offline import integrity, idempotence, conflict and narrow rollback regressions', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const output = execFileSync(process.execPath, ['--test', 'scripts/golfapi-private-import.test.mjs'], { encoding: 'utf8', env });
  assert.match(output, /(?:#|ℹ) tests 5/); assert.match(output, /(?:#|ℹ) fail 0/);
});
test('existing account session feeds GPS identically with and without GHIN; guests use existing login action', () => {
  const reader = Symbol('real-reader'), openAccess = () => undefined;
  for (const linked of [true, false]) {
    const identity = { mode: 'authenticated', userId: 'synthetic-user', accessToken: 'SYNTHETIC_TOKEN', ghinLinkStatus: linked ? 'linked' : 'unlinked' };
    const exports: any = {};
    runInNewContext(compile('app/components/golf-gps/golf-gps-account-reader.tsx'), { exports, require(id: string) {
      if (id === 'react/jsx-runtime') return { jsx: (type: unknown, props: object, key: string) => ({ type, props, key }), jsxs: (type: unknown, props: object) => ({ type, props }) };
      if (id === '../account-provider') return { useBackyardAccount: () => ({ identity, openAccess }) };
      if (id === './golf-gps-reader') return { GolfGpsReader: reader };
      throw Error('GPS must not import another auth or GHIN dependency');
    } });
    const result = exports.GolfGpsAccountReader({ initialCourseId: 'course-la-vista', initialPosition: 2 });
    assert.equal(result.type, reader); assert.equal(result.props.token, identity.accessToken); assert.equal(result.props.initialPosition, 2);
    identity.mode = 'guest'; const guest = exports.GolfGpsAccountReader({}); assert.equal(guest.type, 'section'); assert.equal(guest.props.children[1].props.onClick, openAccess);
  }
});
test('persistent source refuses wrong deployment binding and malformed IDs before any RPC', async () => {
  const exports: any = {}; let calls = 0;
  runInNewContext(compile('lib/golfapi/source.server.ts'), { exports, process: { env: {} }, require(id: string) {
    if (id === 'server-only') return {};
    if (id.endsWith('/preview-database')) return { isolatedPreviewDatabaseEnabled };
    if (id === './catalog') return { savedGolfApiCatalogProvider: () => { throw Error('not used'); } };
    throw Error('Unexpected network/secret/GHIN dependency');
  } });
  const db = { rpc: async () => { calls++; return { data: null, error: null }; } };
  const binding = { PREVIEW_DB_REF: 'bymeopxkxapfizeeqeyb', NEXT_PUBLIC_SUPABASE_URL: 'https://bymeopxkxapfizeeqeyb.supabase.co', VERCEL_ENV: 'preview', VERCEL: '1' };
  for (const env of [{ ...binding, VERCEL_ENV: 'production' }, { ...binding, NEXT_PUBLIC_SUPABASE_URL: 'https://zhqmlpljloumldaczcfp.supabase.co' }]) assert.throws(() => exports.devGolfApiSnapshotStore(db, env), /ISOLATED_DEV_BINDING_REQUIRED/);
  const store = exports.devGolfApiSnapshotStore(db, binding);
  await assert.rejects(() => store.readNormalized('../outside'), /COURSE_ID_INVALID/); assert.equal(calls, 0);
  await assert.rejects(() => store.readNormalized('01213326512553886'), /SAVED_SNAPSHOT_UNAVAILABLE/); assert.equal(calls, 1);
});
test('real reader/view cannot silently select a QA map or fake device and key is a build-time browser variable', () => {
  const source = ['app/components/golf-gps/golf-gps-reader.tsx', 'app/components/golf-gps/golf-gps-account-reader.tsx', 'app/components/golf-gps/golf-gps-view.tsx'].map(p => readFileSync(p, 'utf8')).join('\n');
  assert.doesNotMatch(source, /import[^\n]*(?:simulation-map|local-qa|ghin|golfapi\/controlled-store)/i);
  assert.match(source, /process\.env\.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY/); assert.match(source, /locationAdapter \?\? browserLocationAdapter\(\)/); assert.match(source, /mapFactory \?\? googleMapsFactory/);
});
test('real reader reads privately once per token; course/hole changes keep real adapters and signout hides prior data', async () => {
  const exports: any = {}, states: any[] = [], effects: any[] = []; let cursor = 0, reads = 0;
  const body = { schemaVersion: 1, courses: [{ id: 'stored' }], unavailable: [], mapsEnabled: true }, view = Symbol('real-view');
  runInNewContext(compile('app/components/golf-gps/golf-gps-reader.tsx'), { exports, AbortController, window: { setTimeout: () => 1, clearTimeout: () => undefined }, fetch: async (url: string, options: any) => {
    reads++; assert.equal(url, '/api/golf-gps/courses'); assert.equal(options.headers.authorization, 'Bearer SYNTHETIC_TOKEN'); assert.equal(options.cache, 'no-store'); return { ok: true, json: async () => body };
  }, require(id: string) {
    if (id === 'react/jsx-runtime') return { Fragment: 'fragment', jsx: (type: unknown, props: object) => ({ type, props }), jsxs: (type: unknown, props: object) => ({ type, props }) };
    if (id === 'react') return { useState(initial: unknown) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (next: any) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; }, useEffect(fn: () => any, deps: any[]) { const i = cursor++; const old = effects[i]; if (old && deps.every((d, n) => d === old.deps[n])) return; old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; } };
    if (id === './golf-gps-view') return { GolfGpsView: view };
    if (id === './golf-gps.module.css') return { root: 'gps-root' };
    throw Error('Unexpected real reader dependency');
  } });
  function render(props: any) { cursor = 0; return exports.GolfGpsReader(props); }
  render({ token: 'SYNTHETIC_TOKEN' }); for (let i = 0; i < 5; i++) await Promise.resolve();
  const result = render({ token: 'SYNTHETIC_TOKEN', initialCourseId: 'stored', initialPosition: 10 });
  const renderedView = result; assert.equal(renderedView.type, view); assert.equal(renderedView.props.initialPosition, 10);
  assert.equal(reads, 1); assert.equal(renderedView.props.simulation, undefined); assert.equal(renderedView.props.mapFactory, undefined); assert.equal(renderedView.props.locationAdapter, undefined);
  const unmapped = render({ token: 'SYNTHETIC_TOKEN', mappingUnavailable: true });
  assert.equal(unmapped.type, 'section'); assert.equal(reads, 1);
  assert.equal(render({ token: null }).type, 'section'); assert.equal(reads, 1);
});
