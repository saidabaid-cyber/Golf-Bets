import { validCoordinate } from './geodesic.mjs';

// Source GRS80 UTM, zone 14 north. Geographic WGS84 -> ITRF92 is an
// approximate identity transfer, NOT a surveyed datum/epoch transformation.
// It is the same operation used by the provisional target, with its unknown
// absolute uncertainty retained. PDF panel coordinates never enter this path.
export function projectSourceUtm(coordinates) {
  if (!validCoordinate(coordinates)) return null;
  const [longitude, latitude] = coordinates;
  if (latitude < 0 || latitude > 84 || Math.abs(longitude + 99) > 6) return null;
  const a = 6378137, f = 1 / 298.257222101, e = f * (2 - f), k = .9996;
  const lon = longitude * Math.PI / 180, lat = latitude * Math.PI / 180;
  const ep = e / (1 - e), s = Math.sin(lat), c = Math.cos(lat), t = Math.tan(lat);
  const n = a / Math.sqrt(1 - e * s * s), tt = t * t, cc = ep * c * c;
  const aa = c * (lon + 99 * Math.PI / 180);
  const m = a * ((1 - e / 4 - 3 * e ** 2 / 64 - 5 * e ** 3 / 256) * lat
    - (3 * e / 8 + 3 * e ** 2 / 32 + 45 * e ** 3 / 1024) * Math.sin(2 * lat)
    + (15 * e ** 2 / 256 + 45 * e ** 3 / 1024) * Math.sin(4 * lat)
    - 35 * e ** 3 / 3072 * Math.sin(6 * lat));
  return {
    meters: [500000 + k * n * (aa + (1 - tt + cc) * aa ** 3 / 6
      + (5 - 18 * tt + tt ** 2 + 72 * cc - 58 * ep) * aa ** 5 / 120),
    k * (m + n * t * (aa ** 2 / 2 + (5 - tt + 9 * cc + 4 * cc ** 2) * aa ** 4 / 24
      + (61 - 58 * tt + tt ** 2 + 600 * cc - 330 * ep) * aa ** 6 / 720))],
    gridScale: k * (1 + (1 + cc) * aa ** 2 / 2 + (5 - 4 * tt + 42 * cc + 13 * cc ** 2 - 28 * ep) * aa ** 4 / 24),
  };
}

export function validImageReference(ref) {
  return ref?.projection === 'UTM_14N_GRS80' && ref?.status === 'PROVISIONAL_NOT_FIELD_VERIFIED'
    && ref.fieldVerifiedAt === null && ref.width > 0 && ref.height > 0
    && [ref.width, ref.height, ...(ref.pixelCenterNW || []), ...(ref.pixelSizeMeters || [])].every(Number.isFinite)
    && ref.pixelCenterNW?.length === 2 && ref.pixelSizeMeters?.length === 2
    && ref.pixelSizeMeters.every(v => v > 0);
}

export function sourceUtmToPixel(meters, ref) {
  if (!validImageReference(ref) || meters?.length !== 2 || !meters.every(Number.isFinite)) return null;
  // Geo/world file describes pixel CENTRES; SVG image coordinates start at
  // the outside edge, so the NW centre is [0.5,0.5], not [0,0].
  return [(meters[0] - ref.pixelCenterNW[0]) / ref.pixelSizeMeters[0] + .5,
    (ref.pixelCenterNW[1] - meters[1]) / ref.pixelSizeMeters[1] + .5];
}

export function geographicToPixel(coordinates, ref) {
  const projection = projectSourceUtm(coordinates);
  return projection ? sourceUtmToPixel(projection.meters, ref) : null;
}

export function insideImage(pixel, ref) {
  return validImageReference(ref) && pixel?.length === 2 && pixel.every(Number.isFinite)
    && pixel[0] >= 0 && pixel[0] <= ref.width && pixel[1] >= 0 && pixel[1] <= ref.height;
}

export function accuracyPixelRadius(coordinates, accuracyMeters, ref) {
  const projection = projectSourceUtm(coordinates);
  if (!projection || !validImageReference(ref) || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) return null;
  return ref.pixelSizeMeters.map(size => accuracyMeters * projection.gridScale / size);
}

// Camera uses image pixels, shared by raster AND all overlays. Resizing the
// SVG scales them together; pan/zoom never changes geographical coordinates.
export function fullImageCamera(ref) { return { x: 0, y: 0, width: ref.width, height: ref.height }; }
export function clampCamera(camera, ref) {
  const width = Math.min(ref.width, Math.max(ref.width / 6, camera.width));
  const height = width * ref.height / ref.width;
  return { x: Math.min(ref.width - width, Math.max(0, camera.x)),
    y: Math.min(ref.height - height, Math.max(0, camera.y)), width, height };
}
export function zoomCamera(camera, factor, anchor, ref) {
  const width = Math.min(ref.width, Math.max(ref.width / 6, camera.width / factor));
  const height = width * ref.height / ref.width;
  const rx = (anchor[0] - camera.x) / camera.width, ry = (anchor[1] - camera.y) / camera.height;
  return clampCamera({ x: anchor[0] - rx * width, y: anchor[1] - ry * height, width, height }, ref);
}
export function imageToScreen(pixel, camera, viewport) {
  return [(pixel[0] - camera.x) * viewport.width / camera.width,
    (pixel[1] - camera.y) * viewport.height / camera.height];
}
