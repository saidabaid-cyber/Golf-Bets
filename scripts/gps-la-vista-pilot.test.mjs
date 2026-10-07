import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { distanceMeters, toYards } from '../lib/gps-pilot-la-vista-1/geodesic.mjs';
import { pilotDistance, pilotHostEnabled, PilotLocation } from '../lib/gps-pilot-la-vista-1/pilot.mjs';
const target = JSON.parse(fs.readFileSync(new URL('../lib/gps-pilot-la-vista-1/target.json', import.meta.url)));
const now = 1800000000000;
const reading = { wgs84: [-98.257, 19.009], timestamp: now, accuracyMeters: 8, synthetic: false };
function fixture(options = {}) {
  let success, failure, calls = 0, cleared = [], geoOptions;
  const permission = { state: 'prompt', onchange: null };
  const adapter = { secure: true, geolocation: {
    watchPosition(s, f, o) { success = s; failure = f; geoOptions = o; return ++calls; },
    clearWatch(id) { cleared.push(id); },
  }, permissions: { query: async () => permission }, ...options };
  const states = []; const session = new PilotLocation(adapter, s => states.push(s), () => now);
  return { session, states, adapter, permission, get calls() { return calls; },
    get cleared() { return cleared; }, get geoOptions() { return geoOptions; },
    receive(lon = -98.257, lat = 19.009, timestamp = now, accuracy = 8) {
      success({ coords: { longitude: lon, latitude: lat, accuracy }, timestamp });
    }, error(code) { failure({ code }); } };
}
test('independent WGS84 equator reference: 1 degree = 111319.490793 m', () => {
  assert.ok(Math.abs(distanceMeters([0, 0], [1, 0]) - 111319.49079327357) < .001);
});
test('independent WGS84 meridian reference: latitude 0 to 1 = 110574.388558 m', () => {
  assert.ok(Math.abs(distanceMeters([0, 0], [0, 1]) - 110574.38855779878) < .001);
});
test('coincident positions genuinely return zero', () => assert.equal(distanceMeters(target.coordinates, target.coordinates), 0));
test('yards exact conversion, not card yardage', () => assert.equal(toYards(91.44), 100));
test('invalid coordinate rejected, not zero', () => assert.throws(() => distanceMeters([181, 20], target.coordinates)));
test('candidate exported lon/lat, source pixel retained, no flag or verified status', () => {
  assert.ok(target.coordinates[0] < -98 && target.coordinates[1] > 19);
  assert.deepEqual(target.source.utmMeters, [578137, 2102304]);
  assert.deepEqual(target.source.cropPixelCenter, [155, 631]);
  assert.equal(target.isFlag, false); assert.equal(target.fieldVerifiedAt, null);
});
test('provisional pilot distance is never operational or field-verified', () => {
  const r = pilotDistance(reading, target, now);
  assert.equal(r.status, 'PROVISIONAL_DIRECT_DISTANCE'); assert.equal(r.targetFieldVerified, false);
  assert.ok(r.meters > 300 && r.meters < 330);
});
test('simulated input is explicitly labelled', () => assert.equal(pilotDistance({ ...reading, synthetic: true }, target, now).status, 'SIMULATED_PROVISIONAL_DISTANCE'));
test('expired input clears distance even in simulation', () => {
  for (const synthetic of [false, true]) assert.deepEqual(pilotDistance({ ...reading, synthetic, timestamp: now - 15001 }, target, now), { status: 'STALE', meters: null, yards: null });
});
test('low accuracy is clear and does not produce yardage', () => assert.equal(pilotDistance({ ...reading, accuracyMeters: 31 }, target, now).meters, null));
test('future, unavailable and malformed readings rejected', () => {
  assert.equal(pilotDistance({ ...reading, timestamp: now + 1001 }, target, now).status, 'INVALID_TIME');
  assert.equal(pilotDistance(null, target, now).meters, null);
  assert.equal(pilotDistance({ ...reading, wgs84: [19, -98] }, target, now).meters, null);
});
test('unrelated or accidentally verified target cannot enter provisional pilot', () => {
  assert.equal(pilotDistance(reading, { ...target, candidate: false }, now).status, 'INVALID_PROVISIONAL_TARGET');
  assert.equal(pilotDistance(reading, { ...target, fieldVerifiedAt: '2026-10-06' }, now).meters, null);
});
test('location never starts before action; permission query passive', async () => {
  const f = fixture(); await f.session.initializePermission(); assert.equal(f.calls, 0);
});
test('one watcher: repeated start replaces and stops previous watcher', () => {
  const f = fixture(); f.session.start(); f.session.start();
  assert.equal(f.calls, 2); assert.deepEqual(f.cleared, [1]); f.session.dispose(); assert.deepEqual(f.cleared, [1, 2]);
});
test('device longitude/latitude order and accuracy preserved', () => {
  const f = fixture(); f.session.start(); f.receive();
  assert.deepEqual(f.session.reading.wgs84, [-98.257, 19.009]);
  assert.equal(f.session.reading.synthetic, false); assert.equal(f.session.reading.accuracyMeters, 8);
  assert.deepEqual(f.geoOptions, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
});
test('denied permission stops watcher, no silent retries', () => {
  const f = fixture(); f.session.start(); f.error(1);
  assert.equal(f.session.status, 'DENIED'); assert.equal(f.session.watchId, null);
  f.session.start(); assert.equal(f.calls, 1);
});
test('timeout and no signal invalidate previous position', () => {
  for (const code of [2, 3]) { const f = fixture(); f.session.start(); f.receive(); f.error(code);
    assert.equal(f.session.reading, null); assert.equal(f.session.status, code === 2 ? 'UNAVAILABLE' : 'TIMEOUT'); }
});
test('signal recovers through current watch without retry requests', () => {
  const f = fixture(); f.session.start(); f.error(3); f.receive();
  assert.equal(f.session.status, 'LIVE_REPORTED'); assert.equal(f.calls, 1);
});
test('revocation stops capture and clears listeners on dispose', async () => {
  const f = fixture(); await f.session.initializePermission(); f.session.start();
  f.permission.state = 'denied'; f.permission.onchange(); assert.equal(f.session.watchId, null);
  f.session.dispose(); assert.equal(f.permission.onchange, null);
});
test('no permission listener can appear after async disposal', async () => {
  let resolve; const p = { state: 'prompt', onchange: null };
  const f = fixture({ permissions: { query: () => new Promise(r => { resolve = r; }) } });
  const pending = f.session.initializePermission(); f.session.dispose(); resolve(p); await pending;
  assert.equal(p.onchange, null);
});
test('callbacks after pause/unmount are discarded', () => {
  const f = fixture(); f.session.start(); f.session.stop('PAUSED'); f.receive();
  assert.equal(f.session.reading, null); assert.equal(f.session.status, 'PAUSED');
  f.session.dispose(); const n = f.states.length; f.error(3); assert.equal(f.states.length, n);
});
test('simulated adapter remains labelled in every reading', () => {
  const f = fixture({ simulated: true }); f.session.start(); f.receive(); assert.equal(f.session.reading.synthetic, true);
});
test('missing secure context or geolocation does not try a watch', () => {
  const f = fixture({ secure: false }); f.session.start(); assert.equal(f.calls, 0);
  assert.equal(f.session.status, 'HTTPS_REQUIRED');
});
test('DEV-only flag guard denies all other environments and defaults off', () => {
  const base = { enabled: 'true', branch: 'integration/backyard-current', deploymentEnvironment: 'preview', host: 'dev.thebackyard.com.mx' };
  assert.equal(pilotHostEnabled(base), true);
  for (const change of [{ enabled: undefined }, { branch: 'main' }, { deploymentEnvironment: 'production' }, { host: 'app.thebackyard.com.mx' }, { host: 'beta.thebackyard.com.mx' }, { host: 'anything.vercel.app' }]) assert.equal(pilotHostEnabled({ ...base, ...change }), false);
});
test('integration has no Mapbox, remote SDK, persistence, upload, or new dependency', () => {
  const view = fs.readFileSync(new URL('../lib/gps-pilot-la-vista-1/view.mjs', import.meta.url), 'utf8');
  const core = fs.readFileSync(new URL('../lib/gps-pilot-la-vista-1/pilot.mjs', import.meta.url), 'utf8');
  assert.equal(/fetch\(|XMLHttpRequest|WebSocket|localStorage|mapboxgl|api\.mapbox|access_token/.test(view + core), false);
});
