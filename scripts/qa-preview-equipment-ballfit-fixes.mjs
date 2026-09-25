import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { profileCloudQaConfig } from './qa-preview-profile-cloud.mjs';
import { credentialBoundFetch, deploymentMutationBoundFetch, verifyPreviewBundleBinding, verifyPreviewDeploymentIdentity } from './qa-preview-statistics.mjs';

// Run through the QA credential wrapper. This runner creates ONE synthetic
// account and retains it: no deletion of QA/owner/production data is performed.
const config = profileCloudQaConfig(process.env);
assert.equal(config.projectRef, 'bymeopxkxapfizeeqeyb');
assert.equal(new URL(config.supabaseOrigin).hostname, 'bymeopxkxapfizeeqeyb.supabase.co');
const rawAppFetch = credentialBoundFetch(config.previewOrigin);
const databaseFetch = credentialBoundFetch(config.supabaseOrigin);
await verifyPreviewBundleBinding(config, rawAppFetch, databaseFetch);
const appFetch = deploymentMutationBoundFetch(config, rawAppFetch);
const require = createRequire(import.meta.url);
const eq = require('../.test-dist/lib/golf-equipment.js');
const fit = require('../.test-dist/lib/ball-fitting.js');
const transport = require('../.test-dist/lib/ball-fitting-api.js');
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: databaseFetch } };
const admin = createClient(config.supabaseOrigin, config.secretKey, options);
const runId = randomUUID(), passed = [], sources = [];
const fixture = { id: randomUUID(), email: `qa-bagfit-${runId}@example.invalid`, password: `Qa!${randomBytes(28).toString('hex')}` };
let client, token, record, stage = 'CREATE_SYNTHETIC_ACCOUNT', failure = null;
function checked(result, label) { if (result.error) throw Error(`${label}:${result.error.code || result.error.status || 'unknown'}`); return result.data; }
async function login() {
  client = createClient(config.supabaseOrigin, config.publicKey, options);
  const result = checked(await client.auth.signInWithPassword({ email: fixture.email, password: fixture.password }), 'QA login');
  assert.equal(result.user.id, fixture.id); token = result.session.access_token;
  writeFileSync('.qa-artifacts/equipment-fixes-auth.private.json', JSON.stringify({ cookies: [], origins: [{ origin: config.previewOrigin, localStorage: [{ name: 'sb-bymeopxkxapfizeeqeyb-auth-token', value: JSON.stringify(result.session) }] }] }));
}
async function app(path, method = 'GET', body) {
  const response = await appFetch(config.previewOrigin + path, { method, cache: 'no-store', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(config.bypass ? { 'x-vercel-protection-bypass': config.bypass } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  assert.equal(response.status, 200, `${path}: HTTP${response.status} ${data.code || ''}`);
  return data;
}
async function save(profile) {
  record = (await app('/api/equipment', 'PUT', { profile, expectedVersion: record?.version ?? null, mutationId: randomUUID(), deviceId: `qa-bagfit-${runId}` })).data;
  assert.deepEqual(record.profile, profile);
  assert.deepEqual((await app('/api/equipment')).data.profile, profile);
}
try {
  await verifyPreviewDeploymentIdentity(config, rawAppFetch);
  assert.equal(checked(await admin.auth.admin.createUser({ id: fixture.id, email: fixture.email, password: fixture.password, email_confirm: true, app_metadata: { qa_run_id: runId }, user_metadata: { display_name: 'Synthetic QA Bag Fit', given_name: 'Synthetic QA', family_name: 'Bag Fit' } }), 'create').user.id, fixture.id);
  writeFileSync('.qa-artifacts/equipment-fixes-fixture.private.json', JSON.stringify({ ...fixture, runId, preview: config.previewOrigin, ref: config.projectRef }));
  await login();
  stage = 'LIVE_SHAFT_CATALOG';
  const brands = await app('/api/catalog/equipment?type=SHAFT&facet=brands&usage=WOOD&includeArchived=true&limit=50');
  assert.ok(brands.items.some(item => item.brand === 'Fujikura'));
  const models = await app('/api/catalog/equipment?type=SHAFT&q=Fujikura%20Ventus%20Blue%206S&usage=WOOD&includeArchived=true&limit=50');
  const shaft = models.items.find(item => item.brand === 'Fujikura' && item.weightOptions.length && item.flexOptions.length && item.sourceUrl);
  assert.ok(shaft); passed.push('LIVE_SHAFT_BRAND_MODEL_SEARCH', 'REAL_SHAFT_SPECIFICATIONS_AND_SOURCE');
  sources.push({ id: shaft.id, sourceUrl: shaft.sourceUrl, verifiedAt: shaft.verifiedAt });
  let now = new Date().toISOString();
  let profile = eq.createEmptyEquipmentProfile(fixture.id, now);
  profile = eq.upsertPlayerClub(profile, { id: randomUUID(), userId: fixture.id, category: 'DRIVER', customBrand: 'Synthetic QA manual club', customModel: 'QA Driver', shaftId: shaft.id, customShaftBrand: shaft.brand, customShaftModel: shaft.model, customShaft: `${shaft.brand} ${shaft.model}`, shaftWeightGrams: shaft.weightOptions[0], shaftFlexLabel: shaft.flexOptions[0], handedness: 'RH', isCurrent: true, createdAt: now, updatedAt: now }, now);
  assert.ok(profile); await save(profile); passed.push('CATALOG_SHAFT_LINK_AND_CLOUD_READBACK');
  await client.auth.signOut(); await login();
  assert.deepEqual((await app('/api/equipment')).data.profile.clubs, profile.clubs);
  const pinned = await app(`/api/catalog/equipment?type=SHAFT&ids=${encodeURIComponent(shaft.id)}&q=nonmatching-query&includeArchived=true`);
  assert.ok(pinned.items.some(item => item.id === shaft.id)); passed.push('SHAFT_FRESH_SESSION_AND_EDIT_PINNED_READBACK');
  const canonicalProfileBefore = checked(await client.from('profiles').select('*').eq('id', fixture.id).single(), 'profile before');
  for (const source of ['MANUAL', 'BACKYARD', 'UNKNOWN']) {
    stage = `FIT_${source}`;
    const input = fit.normalizeBallFitInput({ userId: fixture.id, handicap: source === 'UNKNOWN' ? null : source === 'MANUAL' ? 21.3 : 7.2,
      handicapSource: source, experience: source === 'UNKNOWN' ? 'STARTING' : 'REGULAR', typicalScore: 82, driverDistanceYards: 245, swingSpeedBand: 'UNKNOWN',
      feelPreference: 'SOFT', trajectoryPreference: 'MID', priorities: ['WEDGE_SPIN'], wantsGreensideSpin: 'YES' });
    assert.ok(input);
    const response = transport.normalizeBallFitApiSuccess(await app('/api/ball-fitting', 'POST', { input: transport.createBallFitTransportInput(input) }));
    assert.ok(response); assert.equal(response.result.recommendations.length, 3); assert.equal(response.scope.complete, true);
    const summary = fit.toEquipmentBallFitSummary(response.result, randomUUID(), new Date().toISOString(), input);
    assert.ok(summary); profile = eq.setLastBallFit(profile, summary); await save(profile);
    assert.equal(record.profile.lastBallFit.input.handicapSource, source);
    assert.equal(record.profile.lastBallFit.input.handicap, input.handicap);
    if (source === 'UNKNOWN') assert.ok(response.result.warnings.some(w => w.includes('sin estimar un índice')));
    await client.auth.signOut(); await login();
    const reloaded = (await app('/api/equipment')).data.profile;
    assert.equal(reloaded.lastBallFit.input.handicapSource, source);
    assert.equal(reloaded.lastBallFit.input.handicap, input.handicap);
    assert.equal(reloaded.lastBallFit.input.typicalScore, 82);
    assert.equal(reloaded.lastBallFit.input.driverDistanceYards, 245);
    assert.equal(reloaded.lastBallFit.input.swingSpeedBand, 'UNKNOWN');
    assert.deepEqual(checked(await client.from('profiles').select('*').eq('id', fixture.id).single(), 'profile after'), canonicalProfileBefore);
    passed.push(`FIT_${source}_REAL_API`, `FIT_${source}_CLOUD_FRESH_SESSION`, `FIT_${source}_NO_PROFILE_OVERWRITE`, `FIT_${source}_SCORE_DISTANCE_UNKNOWN_SPEED_READBACK`);
  }
  await verifyPreviewDeploymentIdentity(config, rawAppFetch);
} catch (error) { failure = { stage, message: String(error.message).slice(0, 300) }; }
const report = { runId, preview: config.previewOrigin, ref: config.projectRef, retainedSyntheticAccountId: fixture.id,
  passed, sources, failure, cleanup: 'RETAINED_NO_DELETE_AUTHORIZATION',
  qualification: 'Real Preview catalog/recommendation/equipment APIs and fresh Auth sessions. BACKYARD input is an explicit synthetic fitting snapshot, not a claimed GHIN provider result. Browser and physical keyboard QA reported separately.' };
writeFileSync('.qa-artifacts/equipment-ballfit-fixes-cloud.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
