import type { Course } from "./types";

export type CourseGeographicPoint = {
  latitude: number;
  longitude: number;
};

export type NearbyCourseMatch = {
  course: Course;
  distanceKm: number;
};

export function isValidGeographicPoint(value: unknown): value is CourseGeographicPoint {
  if (!value || typeof value !== "object") return false;
  const latitude = Reflect.get(value, "latitude");
  const longitude = Reflect.get(value, "longitude");
  return typeof latitude === "number"
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && typeof longitude === "number"
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180;
}

function radians(degrees: number) {
  return degrees * (Math.PI / 180);
}

/** Great-circle distance. No map, routing or external provider is consulted. */
export function haversineDistanceKm(origin: CourseGeographicPoint, target: CourseGeographicPoint) {
  if (!isValidGeographicPoint(origin) || !isValidGeographicPoint(target)) return null;
  const earthRadiusKm = 6_371.0088;
  const latitudeDelta = radians(target.latitude - origin.latitude);
  const longitudeDelta = radians(target.longitude - origin.longitude);
  const originLatitude = radians(origin.latitude);
  const targetLatitude = radians(target.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(targetLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
}

function boundedLimit(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.trunc(value as number))) : 25;
}

function boundedRadius(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(1, Math.min(500, value as number)) : 100;
}

export function findNearbyCourses(
  courses: readonly Course[],
  origin: CourseGeographicPoint,
  options: { limit?: number; radiusKm?: number } = {},
) {
  if (!isValidGeographicPoint(origin)) return [];
  const radiusKm = boundedRadius(options.radiusKm);
  const matches = courses.flatMap((course): NearbyCourseMatch[] => {
    const point = { latitude: course.latitude, longitude: course.longitude };
    if (!isValidGeographicPoint(point)) return [];
    const distanceKm = haversineDistanceKm(origin, point);
    return distanceKm !== null && distanceKm <= radiusKm ? [{ course, distanceKm }] : [];
  });
  return matches
    .sort((left, right) => left.distanceKm - right.distanceKm
      || left.course.name.localeCompare(right.course.name, "es-MX")
      || left.course.id.localeCompare(right.course.id))
    .slice(0, boundedLimit(options.limit));
}
