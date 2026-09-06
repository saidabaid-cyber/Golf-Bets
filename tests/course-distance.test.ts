import assert from "node:assert/strict";
import test from "node:test";

import { findNearbyCourses, haversineDistanceKm, isValidGeographicPoint } from "../lib/course-distance";
import { DEFAULT_COURSES } from "../lib/golf-course-directory";
import type { Course } from "../lib/types";

function course(id: string, latitude?: number, longitude?: number): Course {
  return {
    id,
    name: `Campo ${id}`,
    teeName: "General",
    holes: Array.from({ length: 9 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
  };
}

test("Haversine calcula una distancia geodésica conocida y valida coordenadas", () => {
  assert.equal(haversineDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }), 0);
  const oneDegreeAtEquator = haversineDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
  assert.ok(oneDegreeAtEquator !== null && Math.abs(oneDegreeAtEquator - 111.195) < 0.01);
  assert.equal(haversineDistanceKm({ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 0 }), null);
  assert.equal(isValidGeographicPoint({ latitude: 19, longitude: -98 }), true);
  assert.equal(isValidGeographicPoint({ latitude: 19 }), false);
  assert.equal(isValidGeographicPoint({ latitude: Number.NaN, longitude: -98 }), false);
});

test("nearby excluye registros sin coordenadas, respeta radio/límite y ordena por distancia", () => {
  const origin = { latitude: 0, longitude: 0 };
  const close = course("close", 0, 0.1);
  const closer = course("closer", 0, 0.05);
  const outside = course("outside", 0, 2);
  const missing = course("missing");
  const partial = course("partial", 0);
  const invalid = course("invalid", 100, 0);

  assert.deepEqual(findNearbyCourses([close, closer, outside, missing, partial, invalid], origin, { radiusKm: 20, limit: 10 }).map((match) => match.course.id), ["closer", "close"]);
  assert.deepEqual(findNearbyCourses([close, closer], origin, { radiusKm: 20, limit: 1 }).map((match) => match.course.id), ["closer"]);
  assert.deepEqual(findNearbyCourses([close], { latitude: -91, longitude: 0 }), []);
});

test("el seed QA no muestra distancias inventadas para los cuatro campos", () => {
  const seeded = DEFAULT_COURSES.filter((candidate) => candidate.catalogCourseId);
  assert.ok(seeded.length >= 7);
  assert.ok(seeded.every((candidate) => candidate.latitude === undefined && candidate.longitude === undefined));
  assert.deepEqual(findNearbyCourses(DEFAULT_COURSES, { latitude: 19.04, longitude: -98.2 }), []);
});
