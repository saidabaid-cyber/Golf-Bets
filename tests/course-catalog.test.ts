import assert from "node:assert/strict";
import test from "node:test";

import { buildInternalCourseCatalog, inspectInternalCourse } from "../lib/course-catalog";
import { internalCourseDataProvider, searchInternalCourses } from "../lib/golf-providers";
import type { Course } from "../lib/types";

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: "course-general",
    name: "Campo local",
    teeName: "General",
    holes: Array.from({ length: 18 }, (_, index) => ({
      number: index + 1,
      par: index % 5 === 0 ? 3 : 4,
      strokeIndex: index + 1,
      yards: 360 + index,
    })),
    ...overrides,
  };
}

test("el catálogo formal separa campo, tee, hoyos y yardajes sin mutar el registro local", () => {
  const original = course({ rating: 71.2, slope: 132, builtIn: true, updatedAt: "2026-09-01" });
  const before = structuredClone(original);
  const catalog = buildInternalCourseCatalog([original]);

  assert.equal(catalog.playableCount, 1);
  assert.equal(catalog.rejectedCount, 0);
  assert.deepEqual(catalog.courses[0], {
    id: "course-general",
    name: "Campo local",
    holesCount: 18,
    par: 68,
    active: true,
    source: "built_in",
    updatedAt: "2026-09-01",
  });
  assert.equal(catalog.tees[0].courseId, catalog.courses[0].id);
  assert.equal(catalog.tees[0].name, "General");
  assert.equal(catalog.tees[0].rating, 71.2);
  assert.equal(catalog.tees[0].slope, 132);
  assert.equal(catalog.tees[0].yardageSource, "holes");
  assert.equal(catalog.tees[0].totalYardage, original.holes.reduce((sum, hole) => sum + hole.yards!, 0));
  assert.equal(catalog.holes.length, 18);
  assert.equal(catalog.teeHoleYardages.length, 18);
  assert.deepEqual(original, before);
  assert.equal("city" in catalog.courses[0], false, "la normalización no inventa ubicación");
});

test("una tarjeta real de nueve hoyos también es jugable y deriva únicamente datos capturados", () => {
  const nine = course({
    id: "course-nine",
    holes: Array.from({ length: 9 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
  });
  const entry = inspectInternalCourse(nine);

  assert.equal(entry.playable, true);
  assert.equal(entry.course?.holesCount, 9);
  assert.equal(entry.course?.par, 36);
  assert.equal(entry.tee?.totalYardage, undefined);
  assert.equal(entry.teeHoleYardages.length, 0);
});

test("Par, numeración y Ventaja/SI inválidos nunca producen un campo seleccionable", () => {
  const broken = course({
    id: "broken-course",
    holes: Array.from({ length: 18 }, (_, index) => ({
      number: index === 17 ? 17 : index + 1,
      par: index === 3 ? 8 : 4,
      strokeIndex: index === 17 ? 17 : index + 1,
    })),
  });
  const catalog = buildInternalCourseCatalog([broken]);

  assert.equal(catalog.playableCount, 0);
  assert.equal(catalog.rejectedCount, 1);
  assert.deepEqual(catalog.courses, []);
  assert.ok(catalog.issues.some((item) => item.code === "duplicate_hole_number" && item.severity === "error"));
  assert.ok(catalog.issues.some((item) => item.code === "invalid_par" && item.severity === "error"));
  assert.ok(catalog.issues.some((item) => item.code === "duplicate_stroke_index" && item.severity === "error"));
});

test("metadatos opcionales inválidos se omiten sin inventar reemplazos ni bloquear el score", () => {
  const local = course({ rating: Number.NaN, slope: -4, totalYards: 0 });
  local.holes[0] = { ...local.holes[0], yards: -1 };
  const entry = inspectInternalCourse(local);

  assert.equal(entry.playable, true);
  assert.equal(entry.tee?.rating, undefined);
  assert.equal(entry.tee?.slope, undefined);
  assert.equal(entry.tee?.totalYardage, undefined);
  assert.equal(entry.teeHoleYardages.length, 17);
  assert.ok(entry.issues.some((item) => item.code === "invalid_yardage" && item.severity === "warning"));
  assert.ok(entry.issues.some((item) => item.code === "invalid_rating" && item.severity === "warning"));
  assert.ok(entry.issues.some((item) => item.code === "invalid_slope" && item.severity === "warning"));
  assert.ok(entry.issues.some((item) => item.code === "invalid_total_yardage" && item.severity === "warning"));
});

test("un yardaje declarado conserva su fuente y una diferencia queda auditada", () => {
  const local = course({ totalYards: 7_000 });
  const entry = inspectInternalCourse(local);

  assert.equal(entry.playable, true);
  assert.equal(entry.tee?.totalYardage, 7_000);
  assert.equal(entry.tee?.yardageSource, "declared");
  assert.ok(entry.issues.some((item) => item.code === "total_yardage_mismatch" && item.severity === "warning"));
});

test("IDs duplicados se aíslan para evitar una selección ambigua", () => {
  const first = course();
  const duplicate = course({ name: "Otro campo" });
  const catalog = buildInternalCourseCatalog([first, duplicate]);

  assert.equal(catalog.playableCount, 0);
  assert.equal(catalog.rejectedCount, 2);
  assert.equal(catalog.entries[0].playable, false);
  assert.equal(catalog.entries[1].playable, false);
  assert.ok(catalog.entries[0].issues.some((item) => item.code === "duplicate_id"));
  assert.ok(catalog.entries[1].issues.some((item) => item.code === "duplicate_id"));
});

test("el provider interno devuelve búsqueda y catálogo validados sin consultar una red", async () => {
  const mexico = course({ id: "mexico-blue", name: "Club México", teeName: "Azules", clubName: "Club de Golf México", city: "Ciudad de México" });
  const other = course({ id: "other-white", name: "Otro campo", teeName: "Blancas" });
  const invalid = course({ id: "unsafe", name: "México incompleto", holes: [] });

  const direct = searchInternalCourses({ courses: [other, invalid, mexico], query: "mexico azules" });
  assert.deepEqual(direct.courses, [mexico]);
  assert.equal(direct.total, 1);
  assert.equal(direct.rejected, 1);
  assert.equal(direct.catalog.playableCount, 1);
  assert.equal(direct.catalog.tees[0].name, "Azules");

  const result = await internalCourseDataProvider.search({ courses: [mexico, other], limit: 1 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.courses[0], mexico, "la selección conserva el snapshot local autoritativo");
  assert.equal(result.data.hasMore, true);
  assert.equal(result.data.catalog.playableCount, 1);
  assert.equal(internalCourseDataProvider.capabilities.structured_catalog, true);
  assert.equal(internalCourseDataProvider.capabilities.remote_catalog, false);

  const firstPage = await internalCourseDataProvider.searchCourses({ courses: [mexico, other], limit: 1 });
  assert.equal(firstPage.ok, true);
  if (!firstPage.ok) return;
  assert.equal(firstPage.data.nextCursor, "mexico-blue");
  const secondPage = await internalCourseDataProvider.searchCourses({ courses: [mexico, other], limit: 1, cursor: firstPage.data.nextCursor });
  assert.equal(secondPage.ok, true);
  if (!secondPage.ok) return;
  assert.deepEqual(secondPage.data.courses.map((item) => item.id), ["other-white"]);
  assert.equal(secondPage.data.hasMore, false);

  const details = await internalCourseDataProvider.getCourse({ courses: [mexico, other], courseId: "mexico-blue" });
  const tees = await internalCourseDataProvider.getTees({ courses: [mexico, other], courseId: "mexico-blue" });
  const holes = await internalCourseDataProvider.getHoles({ courses: [mexico, other], courseId: "mexico-blue" });
  const features = await internalCourseDataProvider.getGeoFeatures({ courses: [mexico, other], courseId: "mexico-blue", holeNumber: 1 });
  assert.equal(details.ok && details.data.name, "Club México");
  assert.equal(tees.ok && tees.data.length, 1);
  assert.equal(holes.ok && holes.data.length, 18);
  assert.deepEqual(features.ok && features.data, []);

  const missing = await internalCourseDataProvider.getCourse({ courses: [mexico], courseId: "missing" });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "not_found");

  const nearby = await internalCourseDataProvider.nearbyCourses({
    courses: [{ ...mexico, latitude: 19, longitude: -98 }, { ...other, latitude: 20, longitude: -98 }],
    origin: { latitude: 19, longitude: -98 },
    radiusKm: 10,
  });
  assert.equal(nearby.ok, true);
  if (nearby.ok) assert.deepEqual(nearby.data.matches.map((match) => match.course.id), ["mexico-blue"]);
});
