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
