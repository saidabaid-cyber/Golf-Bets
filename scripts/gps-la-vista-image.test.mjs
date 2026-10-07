import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { accuracyPixelRadius, clampCamera, fullImageCamera, geographicToPixel, imageToScreen,
  insideImage, projectSourceUtm, sourceUtmToPixel, validImageReference, zoomCamera } from '../lib/gps-pilot-la-vista-1/image-geometry.mjs';

const ref = JSON.parse(fs.readFileSync(new URL('../lib/gps-pilot-la-vista-1/image-reference.json', import.meta.url)));
const target = JSON.parse(fs.readFileSync(new URL('../lib/gps-pilot-la-vista-1/target.json', import.meta.url)));
const near = (actual, expected, tolerance = .001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('source frame projection recovers existing independent target UTM and original pixel', () => {
  const projected = projectSourceUtm(target.coordinates);
  near(projected.meters[0], target.source.utmMeters[0]); near(projected.meters[1], target.source.utmMeters[1]);
  const pixel = geographicToPixel(target.coordinates, ref);
  near(pixel[0], 95.5); near(pixel[1], 71.5);
  near(pixel[0] - .5 + ref.sourceOriginalPixelBox[0], target.source.originalPixelCenter[0]);
  near(pixel[1] - .5 + ref.sourceOriginalPixelBox[1], target.source.originalPixelCenter[1]);
});
test('independent UTM central meridian has false easting 500000, equator northing 0', () => {
  const projection = projectSourceUtm([-99, 0]); near(projection.meters[0], 500000); near(projection.meters[1], 0);
  near(projection.gridScale, .9996, 1e-10);
});
test('longitude/latitude inversion, malformed and incompatible projection fail closed', () => {
  for (const point of [[19, -98], [Infinity, 19], [-180, 19], [null, 19], [-98, -1]]) assert.equal(projectSourceUtm(point), null);
  assert.equal(validImageReference({ ...ref, projection: 'PDF_POINTS' }), false);
  assert.equal(geographicToPixel(target.coordinates, { ...ref, fieldVerifiedAt: '2026-10-06' }), null);
});
test('pixel-centre convention and crop axes preserve geometry without half-pixel shifts', () => {
  assert.deepEqual(sourceUtmToPixel(ref.pixelCenterNW, ref), [.5, .5]);
  assert.deepEqual(sourceUtmToPixel([ref.pixelCenterNW[0] + 100, ref.pixelCenterNW[1] - 150], ref), [100.5, 150.5]);
});
test('outside coverage is never clamped into a fake location marker', () => {
  for (const p of [[-1, 10], [10, -1], [ref.width + .1, 2], [2, ref.height + .1], null]) assert.equal(insideImage(p, ref), false);
  assert.equal(insideImage(geographicToPixel(target.coordinates, ref), ref), true);
  const far = geographicToPixel([-98.32, 19.05], ref); assert.equal(insideImage(far, ref), false); assert.ok(far[0] < 0);
});
test('reported accuracy is represented in projected metres; it is not source absolute accuracy', () => {
  const radius = accuracyPixelRadius(target.coordinates, 8, ref); near(radius[0], 8, .01); near(radius[1], 8, .01);
  assert.equal(accuracyPixelRadius(target.coordinates, -1, ref), null); assert.equal(ref.absoluteAccuracyMeters, null);
});
test('target alignment follows the same camera as the image at both iPhone sizes', () => {
  const pixel = geographicToPixel(target.coordinates, ref), camera = fullImageCamera(ref);
  for (const width of [360, 400]) {
    const viewport = { width, height: width * ref.height / ref.width };
    const screen = imageToScreen(pixel, camera, viewport);
    near(screen[0], pixel[0] * width / ref.width); near(screen[1], pixel[1] * width / ref.width);
    const anchor = [ref.width / 2, ref.height / 2], zoomed = zoomCamera(camera, 2, anchor, ref);
    near(imageToScreen(anchor, camera, viewport)[0], imageToScreen(anchor, zoomed, viewport)[0]);
    near(imageToScreen(anchor, camera, viewport)[1], imageToScreen(anchor, zoomed, viewport)[1]);
    const shifted = clampCamera({ ...zoomed, x: zoomed.x + 15, y: zoomed.y + 20 }, ref);
    const a = imageToScreen(pixel, zoomed, viewport), b = imageToScreen(pixel, shifted, viewport);
    near(a[0] - b[0], 15 * width / zoomed.width); near(a[1] - b[1], 20 * viewport.height / zoomed.height);
  }
});
test('zoom, pan and reset keep the original aspect and cannot expose blank image regions', () => {
  const full = fullImageCamera(ref);
  const high = zoomCamera(full, 100, [200, 200], ref); near(high.width, ref.width / 6);
  const camera = clampCamera({ ...high, x: -10000, y: 10000 }, ref);
  assert.equal(camera.x, 0); near(camera.y + camera.height, ref.height);
  near(camera.width / camera.height, ref.width / ref.height);
  assert.deepEqual(zoomCamera(camera, .001, [100, 100], ref), full);
});
test('mobile image is reproducible, small and correctly attributed; target remains untouched', () => {
  const image = fs.readFileSync(new URL('../public/gps-pilot-la-vista-1/hole-2010.webp', import.meta.url));
  assert.equal(crypto.createHash('sha256').update(image).digest('hex'), ref.imageSha256);
  assert.ok(image.length < 100000); assert.match(ref.attribution, /INEGI/);
  assert.equal(target.fieldVerifiedAt, null); assert.equal(target.isFlag, false);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../lib/gps-pilot-la-vista-1/target.json', import.meta.url))).digest('hex'),
    '842d05b496a221e17f101c7de218d2b52254e0314cefe88e3497826bc446819c');
});
test('renderer contains no provider, telemetry, location storage or background requests', () => {
  const files = ['view.mjs', 'image-view.mjs', 'image-geometry.mjs', 'pilot.mjs'];
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../lib/gps-pilot-la-vista-1/${file}`, import.meta.url), 'utf8');
    assert.equal(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|mapboxgl|api\.mapbox|import\s*\([^)]*https:/.test(source), false, file);
  }
});

