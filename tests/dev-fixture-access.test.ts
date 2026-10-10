import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { devFixtureAccount, devFixtureEnvironment } from '../lib/dev-fixture-access';

const env = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'integration/backyard-current', GPS_LA_VISTA_1_PILOT_ENABLED: 'true', PREVIEW_DB_REF: 'bymeopxkxapfizeeqeyb', NEXT_PUBLIC_SUPABASE_URL: 'https://bymeopxkxapfizeeqeyb.supabase.co' };
const origin = 'https://dev.thebackyard.com.mx', host = 'dev.thebackyard.com.mx';
test('fixture access requires exact DEV branch, host, origin and isolated database; account ID plus trusted metadata', () => {
  assert.equal(devFixtureEnvironment(env, origin, host), true);
  for (const key of Object.keys(env)) assert.equal(devFixtureEnvironment({ ...env, [key]: 'other' }, origin, host), false);
  assert.equal(devFixtureEnvironment(env, 'https://attacker.example', host), false);
  assert.equal(devFixtureEnvironment(env, origin, 'app.thebackyard.com.mx'), false);
  assert.equal(devFixtureAccount({ id: '73ef00d0-ab1a-4b37-a02b-4ccc3072d098', app_metadata: { qa_fixture_kind: 'PERSISTENT_DEV_QA' } }), true);
  assert.equal(devFixtureAccount({ id: '73ef00d0-ab1a-4b37-a02b-4ccc3072d098' }), false);
  assert.equal(devFixtureAccount({ id: 'outsider', app_metadata: { qa_fixture_kind: 'PERSISTENT_DEV_QA' } }), false);
});
test('password endpoint only returns Supabase-verified fixture session; denied account revokes local new session only', async () => {
  let calls = 0, localRevocations = 0;
  let user = { id: '73ef00d0-ab1a-4b37-a02b-4ccc3072d098', app_metadata: { qa_fixture_kind: 'PERSISTENT_DEV_QA' } };
  const api: Record<string, (request: Request) => Promise<Response>> = {};
  const compiled = ts.transpileModule(readFileSync('app/api/gps-pilot/qa-access/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(compiled, { exports: api, process: { env }, Response, TextEncoder,
    require(name: string) { return name.endsWith('dev-fixture-access') ? { devFixtureAccount, devFixtureEnvironment } : { getSupabasePublic: () => ({ auth: {
      signInWithPassword: async () => { calls++; return { data: { user, session: { access_token: 'TEST_TOKEN', refresh_token: 'TEST_REFRESH' } }, error: null }; },
      signOut: async (options: { scope: string }) => { assert.equal(options.scope, 'local'); localRevocations++; },
    } }) }; } });
  const request = (overrides: Record<string, string> = {}) => new Request(origin + '/api/gps-pilot/qa-access', { method: 'POST', headers: { origin, host, 'content-type': 'application/json', ...overrides }, body: JSON.stringify({ email: 'fixture@example.invalid', password: 'synthetic-test-password' }) });
  assert.equal((await api.POST(request({ origin: 'https://attacker.example' }))).status, 404); assert.equal(calls, 0);
  const accepted = await api.POST(request()); assert.equal(accepted.status, 200); assert.equal(accepted.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await accepted.json(), { access_token: 'TEST_TOKEN', refresh_token: 'TEST_REFRESH' });
  user = { id: 'outsider', app_metadata: { qa_fixture_kind: 'PERSISTENT_DEV_QA' } };
  assert.equal((await api.POST(request())).status, 403); assert.equal(localRevocations, 1);
});
