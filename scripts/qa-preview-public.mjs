// Read-only Preview/Supabase checks. Never logs keys, cookies or response rows.
// PREVIEW_QA_ACCESS_URL may hold a temporary authorized Vercel share URL.
import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] || 'https://golf-bets-git-codex-dev-saha8.vercel.app').origin;
const expectedProject = 'https://zhqmlpljloumldaczcfp.supabase.co';
const cookies = new Map();
async function previewFetch(path) {
  let url = new URL(path, origin);
  for (let redirects = 0; redirects < 8; redirects++) {
    assert.equal(url.origin, origin, 'Preview access redirected outside the authorized origin');
    const response = await fetch(url, { redirect: 'manual', headers: { cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; ') }, signal: AbortSignal.timeout(30_000) });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]; const i = pair.indexOf('=');
      cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    if (response.status >= 300 && response.status < 400) { url = new URL(response.headers.get('location'), url); continue; }
    return response;
  }
  throw new Error('Too many Preview redirects');
}

try {
  const page = await previewFetch(process.env.PREVIEW_QA_ACCESS_URL || '/');
  assert.equal(page.status, 200, 'Preview unavailable');
  const html = await page.text();
  const assets = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]))].filter(p => p.startsWith('/_next/'));
  let publicKey; let configuredUrl; let secretCount = 0;
  for (const path of assets) {
    const source = await (await previewFetch(path)).text();
    configuredUrl ||= source.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
    publicKey ||= source.match(/sb_publishable_[A-Za-z0-9_-]{15,}/)?.[0];
    secretCount += (source.match(/sb_secret_[A-Za-z0-9_-]{15,}/g) || []).length;
    for (const jwt of source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
      try { const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()); if (claims.role === 'service_role') secretCount++; if (claims.role === 'anon') publicKey ||= jwt; } catch { /* Not a JWT. */ }
    }
  }
  console.log(JSON.stringify({ check: 'browser-bundle', assets: assets.length, configuredProject: configuredUrl, publicKeyPresent: Boolean(publicKey), secretCount }));
  assert.equal(secretCount, 0, 'Server secret found in client bundle');
  assert.equal(configuredUrl, expectedProject, 'Unexpected Supabase project');
  assert.ok(publicKey, 'No Supabase public key in the Preview build');
  for (const id of ['official-guide-part-1', 'committee-procedures-part-2', 'clarifications-july-2026']) {
    const response = await previewFetch(`/api/rules/documents/${id}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    console.log(JSON.stringify({ check: 'internal-pdf', id, status: response.status, sourceStatus: response.headers.get('x-rules-source-status'), contentType: response.headers.get('content-type'), bytes: bytes.length, pdfSignature: Buffer.from(bytes.slice(0,5)).toString() === '%PDF-' }));
  }
  const features = await previewFetch('/api/features');
  console.log(JSON.stringify({ check: 'preview-features', status: features.status, flags: await features.json() }));
  for (const path of ['/api/cloud/sync', '/api/cloud/rounds']) {
    const response = await previewFetch(path);
    console.log(JSON.stringify({ check: 'unauthenticated-api', path, status: response.status }));
    assert.equal(response.status, 401, 'An absent session must not be reported as missing cloud configuration');
  }
  async function supabaseRead(path, options = {}) {
    const response = await fetch(`${expectedProject}${path}`, { ...options, headers: { apikey: publicKey, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000) });
    const data = await response.json().catch(() => null);
    return { response, data };
  }
  const { response: settingsResponse, data: settings } = await supabaseRead('/auth/v1/settings');
  console.log(JSON.stringify({ check: 'auth-settings', status: settingsResponse.status, email: settings?.external?.email, google: settings?.external?.google, apple: settings?.external?.apple, signupDisabled: settings?.disable_signup, emailAutoconfirm: settings?.mailer_autoconfirm }));
  for (const table of ['profiles', 'rounds_cloud', 'round_scores_cloud', 'players', 'frequent_groups_cloud', 'personal_rivals_cloud', 'user_cloud_state', 'user_preferences', 'cloud_deletions', 'legal_acceptances', 'tournament_access', 'polla_join_attempts', 'tournament_leaderboard_events']) {
    const { response, data } = await supabaseRead(`/rest/v1/${table}?select=*&limit=1`);
    const rows = Array.isArray(data) ? data.length : null;
    console.log(JSON.stringify({ check: 'anon-read', table, status: response.status, rows, errorCode: data?.code }));
    if (table !== 'tournament_leaderboard_events') assert.ok(!rows, `Anonymous rows exposed in ${table}`);
  }
  for (const [table, columns] of [
    ['profiles', 'id,onboarding_completed_at,version,updated_by_device'],
    ['round_scores_cloud', 'round_player_id,hole,version,updated_by_device'],
    ['account_data_migrations', 'user_id,last_attempt_at,last_error_code'],
    ['user_devices', 'user_id,device_id,last_sync_at'],
    ['cloud_record_versions', 'owner_id,entity_type,local_id,version'],
  ]) {
    const { response, data } = await supabaseRead(`/rest/v1/${table}?select=${columns}&limit=1`);
    console.log(JSON.stringify({ check: 'schema-shape', table, status: response.status, errorCode: data?.code }));
  }
  for (const [fn, body] of [['resolve_polla_access', { p_token: 'qa-not-a-real-token' }], ['is_polla_admin', { p_tournament_id: '00000000-0000-0000-0000-000000000000' }]]) {
    const { response, data } = await supabaseRead(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });
    console.log(JSON.stringify({ check: 'anon-rpc', fn, status: response.status, errorCode: data?.code }));
    assert.ok(response.status >= 400, `${fn} callable anonymously`);
  }
} catch (error) {
  // Do not print underlying network errors that might contain request headers.
  console.error(error instanceof assert.AssertionError ? error.message : 'QA request failed; inspect access/configuration without logging credentials.');
  process.exitCode = 1;
}
