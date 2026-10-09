import test from 'node:test';
import assert from 'node:assert/strict';
import { gpsMeasurements, measuredDistance, displayDistance } from '../lib/golf-gps/model.mjs';
import { GpsLocationSession } from '../lib/golf-gps/location.mjs';
import { GpsMapSession } from '../lib/golf-gps/map-session.mjs';
import { MapTapGuard } from '../lib/golf-gps/touch.mjs';
import { googleMapGate, loadGoogleMaps, googleMapsFactory } from '../lib/golf-gps/google-maps.mjs';

const hole = { position: 1, green: { front: [0, 0], center: [1, 0], back: [2, 0] }, references: [] }; // Synthetic mathematical fixture, not Puebla.
const state = (now = 100000) => ({ active: true, status: 'LIVE_REPORTED', permission: 'granted', reading: { wgs84: [0, 0], accuracyMeters: 8, timestamp: now, synthetic: true }, simulated: true });
test('independent WGS84 distance and exact m/yd conversion', () => { const d = measuredDistance([0, 0], [1, 0]); assert.ok(Math.abs(d.meters - 111319.490793) < .001); assert.equal(d.yards * .9144, d.meters); assert.equal(displayDistance({ meters: 91.44, yards: 100 }, 'yd'), '100'); });
test('front/center/back and movable target produce two local distance legs', () => { const m = gpsMeasurements(hole, state(), [.5, 0], 100000); assert.equal(m.front.meters, 0); assert.ok(Math.abs(m.playerTarget.meters - m.targetCenter.meters) < .001); assert.equal(m.simulated, true); });
test('stale, low accuracy, denied, stopped or missing inputs never fabricate a player distance', () => {
  for (const input of [null, { ...state(), active: false }, { ...state(), reading: { ...state().reading, timestamp: 80000 } }, { ...state(), reading: { ...state().reading, accuracyMeters: 80 } }, { ...state(), reading: { ...state().reading, wgs84: [400, 100] } }]) assert.equal(gpsMeasurements(hole, input, [.5, 0], 100000).center, null);
  assert.equal(measuredDistance(null, [1, 0]), null); assert.equal(gpsMeasurements(hole, null, [.5, 0]).playerTarget, null); assert.ok(gpsMeasurements(hole, null, [.5, 0]).targetCenter.meters > 0);
});
test('missing front/back stay missing; center is not a flag', () => { const m = gpsMeasurements({ ...hole, green: { front: null, center: [1, 0], back: null } }, state(), null, 100000); assert.equal(m.front, null); assert.equal(m.back, null); assert.equal(m.playerTarget, null); });

function locationHarness(t, options = {}) {
  let now = 100000, watchCalls = 0, clears = 0, tick, success, error, changed = 0; const watches = new Set();
  const doc = new EventTarget(); doc.hidden = false;
  const adapter = { secure: true, simulated: true, geolocation: { watchPosition(s, e) { success = s; error = e; const id = ++watchCalls; watches.add(id); return id; }, clearWatch(id) { watches.delete(id); clears++; } }, ...options };
  const session = new GpsLocationSession(adapter, () => changed++, { now: () => now, document: doc, setInterval: cb => { tick = cb; return 1; }, clearInterval: () => { tick = null; } });
  t.after(() => session.dispose());
  return { session, doc, watches, counts: () => ({ watchCalls, clears, changed }), move: (accuracy = 8, timestamp = now) => success({ coords: { latitude: 0, longitude: 0, accuracy }, timestamp }), error: code => error({ code }), age: delta => { now += delta; tick?.(); }, tickExists: () => !!tick };
}
test('location start repeated has one watcher; stop/dispose clear it', t => { const h = locationHarness(t); h.session.start(); h.session.start(); assert.equal(h.counts().watchCalls, 1); h.move(); assert.equal(h.session.snapshot().status, 'LIVE_REPORTED'); h.session.stop(); assert.equal(h.watches.size, 0); assert.equal(h.session.snapshot().status, 'STOPPED'); h.session.dispose(); assert.equal(h.tickExists(), false); });
test('denial clears capture and does not retry', t => { const h = locationHarness(t); h.session.start(); h.error(1); assert.equal(h.session.snapshot().status, 'DENIED'); assert.equal(h.watches.size, 0); h.session.start(); assert.equal(h.counts().watchCalls, 1); });
test('timeout/unavailable remain recoverable from the existing watcher', t => { const h = locationHarness(t); h.session.start(); h.error(3); assert.equal(h.session.snapshot().status, 'TIMEOUT'); h.error(2); assert.equal(h.session.snapshot().status, 'UNAVAILABLE'); h.move(); assert.equal(h.session.snapshot().status, 'LIVE_REPORTED'); assert.equal(h.counts().watchCalls, 1); });
test('stale and poor precision are recalculated without new geolocation calls', t => { const h = locationHarness(t); h.session.start(); h.move(80); assert.equal(h.session.snapshot().status, 'LOW_ACCURACY'); h.move(); h.age(16000); assert.equal(h.session.snapshot().status, 'STALE'); assert.equal(h.counts().watchCalls, 1); });
test('background pauses; foreground gets a fresh reading rather than recycling an old one', t => { const h = locationHarness(t); h.session.start(); h.move(); h.doc.hidden = true; h.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(h.watches.size, 0); assert.equal(h.session.snapshot().status, 'SUSPENDED'); h.doc.hidden = false; h.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(h.session.snapshot().reading, null); assert.equal(h.counts().watchCalls, 2); h.move(); assert.equal(h.session.snapshot().status, 'LIVE_REPORTED'); });
test('no HTTPS or device geolocation reports explicit unavailability', t => { const insecure = locationHarness(t, { secure: false }); insecure.session.start(); assert.equal(insecure.session.snapshot().status, 'HTTPS_REQUIRED'); const missing = locationHarness(t, { geolocation: undefined }); missing.session.start(); assert.equal(missing.session.snapshot().status, 'UNAVAILABLE'); });
test('late geolocation callback after disposal cannot emit', t => { const h = locationHarness(t); h.session.start(); h.session.dispose(); const before = h.counts().changed; h.move(); assert.equal(h.counts().changed, before); });

test('timer cleanup preserves the browser/runtime receiver', () => {
  let cleared = 0;
  const runtime = { now: () => 100000, setInterval: () => 44, clearInterval(id) { assert.equal(this, runtime); assert.equal(id, 44); cleared++; } };
  const session = new GpsLocationSession({ secure: true }, () => {}, runtime);
  session.dispose(); assert.equal(cleared, 1);
});

test('map instance reused for GPS, target, units and hole changes', async () => {
  let creates = 0, updates = 0, fits = 0, destroys = 0; const session = new GpsMapSession(async () => { creates++; return { update() { updates++; }, fitHole() { fits++; }, centerPlayer() {}, destroy() { destroys++; } }; }, () => {});
  await session.open({}, {}); for (let i = 0; i < 100; i++) session.update({ holeKey: 'same', hole, target: [i * .001, 0], unit: i % 2 ? 'm' : 'yd' });
  session.update({ holeKey: 'next', hole }); await session.open({}, {}); assert.equal(creates, 1); assert.equal(fits, 2); assert.equal(updates, 101); session.dispose(); assert.equal(destroys, 1);
});
test('closing before SDK resolution prevents active map retention', async () => { let resolve, destroys = 0; const session = new GpsMapSession(() => new Promise(done => { resolve = done; }), () => {}); const opened = session.open({}, {}); await Promise.resolve(); session.dispose(); resolve({ destroy() { destroys++; } }); await opened; assert.equal(destroys, 1); assert.equal(session.surface, null); });
test('map factory failure is reported once without retry loops', async () => { let calls = 0; const statuses = []; const s = new GpsMapSession(async () => { calls++; throw Object.assign(Error('bad'), { code: 'MAP_NETWORK_ERROR' }); }, status => statuses.push(status)); await s.open({}, {}); assert.equal(calls, 1); assert.deepEqual(statuses, ['LOADING', 'MAP_NETWORK_ERROR']); s.dispose(); });

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.style = {}; this.attributes = {}; this.clientWidth = 390; this.clientHeight = 380; }
  append(child) { child.parent = this; this.children.push(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  replaceChildren() { this.children = []; }
  addEventListener(name, callback) { this.events[name] = callback; }
  removeEventListener(name) { delete this.events[name]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  setPointerCapture() {}
}
function mockBrowser() {
  const scripts = [], mapsCreated = [], timers = new Map(); let id = 0;
  const projection = { fromLatLngToDivPixel: value => ({ x: value.lng() * 10, y: value.lat() * -10 }), fromDivPixelToLatLng: value => ({ lng: () => value.x / 10, lat: () => value.y / -10 }) };
  class LatLng { constructor(value) { this.value = value; } lat() { return this.value.lat; } lng() { return this.value.lng; } }
  class MapDouble { constructor(element, options) { this.element = element; this.options = options; this.events = {}; mapsCreated.push(this); } addListener(name, callback) { this.events[name] = callback; return { remove: () => delete this.events[name] }; } setOptions(value) { Object.assign(this.options, value); } fitBounds(bounds) { this.bounds = bounds; } panTo(point) { this.center = point; } }
  class Overlay { setMap(map) { if (!map) { this.onRemove?.(); return; } this.map = map; this.onAdd?.(); this.draw?.(); } getPanes() { return { overlayMouseTarget: this.map.element }; } getProjection() { return projection; } static preventMapHitsAndGesturesFrom() {} }
  class Shape { constructor(options) { this.map = options.map; } setMap(map) { this.map = map; } setCenter(center) { this.center = center; } setRadius(radius) { this.radius = radius; } setPath(path) { this.path = path; } }
  class Bounds { constructor() { this.points = []; } extend(p) { this.points.push(p); } getCenter() { return new LatLng(this.points[0]); } }
  const sdk = { Map: MapDouble, OverlayView: Overlay, Circle: Shape, Polyline: Shape, LatLng, LatLngBounds: Bounds, Point: class { constructor(x, y) { this.x = x; this.y = y; } }, event: { clearInstanceListeners(map) { map.events = {}; } } };
  const runtime = { location: { origin: 'https://dev.thebackyard.com.mx' }, navigator: { onLine: true }, setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: n => timers.delete(n), document: { createElement: tag => new Element(tag), querySelector: () => null, head: { append: script => scripts.push(script) } } };
  return { runtime, sdk, scripts, mapsCreated, timers };
}
test('Google loader rejects flags, localhost, missing key and offline without creating scripts', async () => {
  const b = mockBrowser(); for (const [options, origin, online, code] of [[{ enabled: false, apiKey: 'synthetic' }, 'https://dev.thebackyard.com.mx', true, 'MAP_DISABLED'], [{ enabled: true, apiKey: 'synthetic' }, 'http://localhost:3217', true, 'MAP_ORIGIN_NOT_ALLOWED'], [{ enabled: true, apiKey: '' }, 'https://dev.thebackyard.com.mx', true, 'MAP_KEY_MISSING'], [{ enabled: true, apiKey: 'synthetic' }, 'https://dev.thebackyard.com.mx', false, 'MAP_OFFLINE']]) { b.runtime.location.origin = origin; b.runtime.navigator.onLine = online; await assert.rejects(() => loadGoogleMaps(options, b.runtime), error => error.code === code); }
  assert.equal(b.scripts.length, 0); assert.equal(googleMapGate({ enabled: true, apiKey: 'synthetic', origin: 'https://dev.thebackyard.com.mx' }), null);
});
test('Google SDK loads once; uses only Maps JS and quarterly channel, no extra APIs', async () => { const b = mockBrowser(); const first = loadGoogleMaps({ enabled: true, apiKey: 'SYNTHETIC_NOT_REAL' }, b.runtime); const second = loadGoogleMaps({ enabled: true, apiKey: 'SYNTHETIC_NOT_REAL' }, b.runtime); assert.equal(b.scripts.length, 1); const url = new URL(b.scripts[0].src); assert.equal(url.pathname, '/maps/api/js'); assert.equal(url.searchParams.get('v'), 'quarterly'); assert.equal(url.searchParams.has('libraries'), false); b.runtime.google = { maps: b.sdk }; b.runtime.__backyardGpsGoogleReady(); assert.equal(await first, b.sdk); assert.equal(await second, b.sdk); });
test('Google network failure sticks; reopening cannot spend through automatic retries', async () => { const b = mockBrowser(); const first = loadGoogleMaps({ enabled: true, apiKey: 'SYNTHETIC' }, b.runtime); b.scripts[0].onerror(); await assert.rejects(() => first, /MAP_NETWORK_ERROR/); await assert.rejects(() => loadGoogleMaps({ enabled: true, apiKey: 'SYNTHETIC' }, b.runtime), /MAP_NETWORK_ERROR/); assert.equal(b.scripts.length, 1); });
test('Google late auth/quota errors notify the surface and cannot leak credentials in error text', async () => { const b = mockBrowser(); const pending = loadGoogleMaps({ enabled: true, apiKey: 'SYNTHETIC_SECRET' }, b.runtime); b.runtime.gm_authFailure(); await assert.rejects(() => pending, error => error.code === 'MAP_AUTH_OR_QUOTA_ERROR' && !error.message.includes('SYNTHETIC_SECRET')); assert.equal(b.scripts.length, 1); });
test('Google adapter draws points/accuracy/lines, moves target and cleans overlays without rebuilding map', async () => {
  const b = mockBrowser(); b.runtime.google = { maps: b.sdk }; const element = new Element('div'), targets = [], errors = [];
  const scene = { holeKey: 'synthetic:1', hole, player: state().reading, target: [.5, 0], unit: 'yd', playerTargetLabel: '10', targetCenterLabel: '20' };
  const surface = await googleMapsFactory({ enabled: true, apiKey: 'SYNTHETIC' }, b.runtime)(element, { onTarget: point => targets.push(point), onError: code => errors.push(code) }, undefined, scene);
  surface.update(scene); surface.fitHole(scene); assert.equal(b.mapsCreated.length, 1); assert.deepEqual(b.mapsCreated[0].options.center, { lat: 0, lng: 1 }); assert.equal(b.mapsCreated[0].options.mapTypeId, 'satellite');
  b.mapsCreated[0].events.click({ latLng: { lng: () => .3, lat: () => .4 } }); assert.deepEqual(targets[0], [.3, .4]);
  const target = element.children.find(c => c.attributes['aria-label']?.startsWith('Objetivo'));
  target.events.pointerdown({ clientX: 0, clientY: 0, pointerId: 1, preventDefault() {}, stopPropagation() {} }); target.events.pointermove({ pointerId: 1, clientX: 10, clientY: 20, preventDefault() {}, stopPropagation() {} }); target.events.pointerup({ pointerId: 1, stopPropagation() {} }); assert.deepEqual(targets.at(-1), [1.5, -2]); assert.equal(b.mapsCreated[0].options.draggable, true);
  for (let i = 0; i < 50; i++) surface.update({ ...scene, unit: 'm' }); assert.equal(b.mapsCreated.length, 1); assert.equal(b.scripts.length, 0); surface.destroy(); assert.equal(element.children.length, 0); assert.equal(Object.keys(b.mapsCreated[0].events).length, 0); assert.equal(errors.length, 0);
});
test('Google cancellation after SDK load does not create a hidden map', async () => { const b = mockBrowser(); b.runtime.google = { maps: b.sdk }; const controller = new AbortController(); controller.abort(); await assert.rejects(() => googleMapsFactory({ enabled: true, apiKey: 'SYNTHETIC' }, b.runtime)(new Element('div'), {}, controller.signal, { hole }), /MAP_CANCELED/); assert.equal(b.mapsCreated.length, 0); });

test('target release outside the overlay and unpressed hover cannot keep moving a dragged target',async()=>{
 const b=mockBrowser(),events={};b.runtime.google={maps:b.sdk};
 b.runtime.addEventListener=(name,fn)=>events[name]=fn;b.runtime.removeEventListener=name=>delete events[name];
 const element=new Element('div'),points=[];
 const scene={holeKey:'synthetic',hole,target:[.5,0],unit:'yd',targetCenterLabel:'20'};
 const surface=await googleMapsFactory({enabled:true,apiKey:'SYNTHETIC'},b.runtime)(element,{onTarget:p=>points.push(p)},undefined,scene);surface.update(scene);
 const target=element.children.find(c=>c.attributes['aria-label']?.startsWith('Objetivo'));
 const pointer={pointerId:1,pointerType:'mouse',buttons:1,clientX:0,clientY:0,preventDefault(){},stopPropagation(){}};
 target.events.pointerdown(pointer);events.pointerup({pointerId:1});assert.equal(b.mapsCreated[0].options.draggable,true);
 target.events.pointermove({...pointer,clientX:50,buttons:0});assert.equal(points.length,0);
 target.events.pointerdown(pointer);target.events.pointermove({...pointer,clientX:70,buttons:0});assert.equal(points.length,0);assert.equal(b.mapsCreated[0].options.draggable,true);
 target.events.pointerdown(pointer);surface.update({...scene,target:null});assert.equal(b.mapsCreated[0].options.draggable,true);assert.deepEqual(Object.keys(events),[]);
 surface.destroy();assert.deepEqual(Object.keys(events),[]);
});

test('auth failure after SDK readiness prevents another map and another script', async () => {
  const b = mockBrowser(); const loaded = loadGoogleMaps({ enabled: true, apiKey: 'SYNTHETIC' }, b.runtime);
  b.runtime.google = { maps: b.sdk }; b.runtime.__backyardGpsGoogleReady(); await loaded;
  b.runtime.gm_authFailure();
  await assert.rejects(() => googleMapsFactory({ enabled: true, apiKey: 'SYNTHETIC' }, b.runtime)(new Element('div'), {}, undefined, { hole }), /MAP_AUTH_OR_QUOTA_ERROR/);
  assert.equal(b.scripts.length, 1); assert.equal(b.mapsCreated.length, 0);
});


test('touch tap can target; pan, pinch, cancel and marker drag cannot target', () => {
  let time = 1000; const guard = new MapTapGuard(() => time);
  const pointer = (id, x = 0, y = 0) => ({ pointerId: id, clientX: x, clientY: y });
  guard.down(pointer(1)); guard.up(pointer(1)); assert.equal(guard.allow(), true);
  guard.down(pointer(1)); guard.move(pointer(1, 50)); guard.up(pointer(1, 50)); assert.equal(guard.allow(), false);
  time += 800; guard.down(pointer(1)); guard.down(pointer(2)); guard.up(pointer(1)); guard.up(pointer(2)); assert.equal(guard.allow(), false);
  time += 800; guard.down(pointer(1), true); guard.up(pointer(1)); assert.equal(guard.allow(), false);
  time += 800; guard.down(pointer(1)); guard.up(pointer(1), true); assert.equal(guard.allow(), false);
  time += 800; guard.down(pointer(1)); guard.up(pointer(1)); assert.equal(guard.allow(), true);
});
test('resizing/reopening a retained map never creates a second factory or recenters exploration', async () => {
  let factories=0, fits=0, resizes=0, destroyed=0;
  const session=new GpsMapSession(async()=>{factories++;return {update(){},fitHole(){fits++;},centerPlayer(){},resize(){resizes++;},destroy(){destroyed++;}};},()=>{});
  session.update({holeKey:'one',hole}); await session.open({},{}); const initialFits=fits;
  session.resize(); await session.open({},{}); session.update({holeKey:'one',hole,unit:'m'});
  assert.equal(factories,1);assert.equal(fits,initialFits);assert.equal(resizes,1);
  session.dispose();assert.equal(destroyed,1);
});


test('hole viewport fits saved extent; missing tees use a context view without invented geometry',async()=>{
 const {holeViewport,measuredDistance}=await import('../lib/golf-gps/model.mjs');
 const hole={green:{front:[-98.25,19],center:[-98.25,19.0001],back:[-98.25,19.0002]},references:[]};
 const original=JSON.stringify(hole),base=holeViewport(hole);
 assert.equal(base.coverage,'GREEN_CONTEXT_ONLY');assert.ok(measuredDistance([base.west,19],[base.east,19]).meters>500);
 assert.deepEqual(holeViewport(hole,{wgs84:[-99,20]}),base); // Home doesn't force a zoom out.
 const near=holeViewport(hole,{wgs84:[-98.25,18.996]});assert.ok(near.south<base.south);
 assert.equal(JSON.stringify(hole),original);assert.equal(holeViewport({green:{},references:[]}),null);
 const withTee=holeViewport({...hole,references:[{kind:'FRONT_TEE',coordinate:[-98.25,18.996]}]});assert.equal(withTee.coverage,'TEE_AND_GREEN');assert.ok(withTee.south<=18.996);
});
