import { distanceMeters, toYards, validCoordinate, readingState } from '../gps-pilot-la-vista-1/geodesic.mjs';

export function liveReading(location, now = Date.now()) {
  if (!location?.active || location.status === 'SUSPENDED' || location.status === 'STOPPED') return null;
  const reading = location.reading;
  return reading && readingState({ ...reading, synthetic: false }, now) === 'LIVE_REPORTED' ? reading : null;
}
export function measuredDistance(origin, destination) {
  if (!validCoordinate(origin) || !validCoordinate(destination)) return null;
  try { const meters = distanceMeters(origin, destination); return { meters, yards: toYards(meters) }; } catch { return null; }
}
export function gpsMeasurements(hole, location, target, now = Date.now()) {
  const reading = liveReading(location, now);
  return { front: reading ? measuredDistance(reading.wgs84, hole?.green.front) : null,
    center: reading ? measuredDistance(reading.wgs84, hole?.green.center) : null,
    back: reading ? measuredDistance(reading.wgs84, hole?.green.back) : null,
    playerTarget: reading ? measuredDistance(reading.wgs84, target) : null,
    targetCenter: measuredDistance(target, hole?.green.center), simulated: !!location?.simulated };
}
export function holePoints(hole) {
  return [...Object.values(hole?.green ?? {}), ...(hole?.references ?? []).map(point => point.coordinate)].filter(validCoordinate);
}
export function displayDistance(distance, unit) { return distance ? Math.round(unit === 'm' ? distance.meters : distance.yards).toLocaleString('es-MX') : '—'; }
export { validCoordinate };

/** Camera extent, never a published tee/path. Missing tee geometry gets a
 * green view with 65 m of context on each side. This is not a hole trajectory.
 * Device movement never changes this extent; locating the player is explicit.
 */
export function holeViewport(hole) {
  const points = holePoints(hole); if (!points.length) return null;
  const full = (hole.references ?? []).some(row => row.kind.endsWith('TEE'));
  const center = hole.green.center ?? points[0];
  const radius = full ? 25 : 65;
  const latPadding = radius / 111320, lngPadding = latPadding / Math.cos(center[1] * Math.PI / 180);
  const extent = [...points, [center[0]-lngPadding,center[1]-latPadding], [center[0]+lngPadding,center[1]+latPadding]];
  return { west: Math.min(...extent.map(p=>p[0])), east: Math.max(...extent.map(p=>p[0])), south: Math.min(...extent.map(p=>p[1])), north: Math.max(...extent.map(p=>p[1])), coverage: full ? 'TEE_AND_GREEN' : 'GREEN_CONTEXT_ONLY' };
}
