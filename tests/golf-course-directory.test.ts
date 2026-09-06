import assert from "node:assert/strict";
import test from "node:test";

import { buildInternalCourseCatalog } from "../lib/course-catalog";
import {
  buildSeedGolfCourseCatalog,
  DEFAULT_COURSES,
  golfCourseSelectionToLegacyCourse,
  INTERNAL_GOLF_COURSE_CATALOG,
} from "../lib/golf-course-directory";

test("el seed separa club, campo, tee, hoyo y yardaje con procedencia explícita", () => {
  const catalog = buildSeedGolfCourseCatalog();
  assert.equal(catalog.schemaVersion, 1);
  assert.deepEqual(catalog.clubs.map((club) => club.name), [
    "La Vista Country Club",
    "Club Campestre de Puebla",
    "Club Campestre El Cristo",
    "Cola de Lagarto",
  ]);
  assert.equal(catalog.courses.length, 4);
  assert.equal(catalog.tees.length, 7);
  assert.equal(catalog.holes.length, 72);
  assert.equal(catalog.teeHoleYardages.length, 72);
  assert.deepEqual(catalog.geoFeatures, []);
  assert.ok(catalog.clubs.every((club) => club.provider === "BACKYARD_INTERNAL" && Boolean(club.sourceUrl) && Boolean(club.verifiedAt)));
  assert.ok(catalog.courses.every((course) => course.provider === "BACKYARD_INTERNAL" && Boolean(course.sourceUrl) && course.verifiedAt === undefined));
  assert.ok(catalog.clubs.every((club) => club.latitude === undefined && club.longitude === undefined));
  assert.ok(catalog.courses.every((course) => course.latitude === undefined && course.longitude === undefined));
});

test("La Vista conserva un único campo y cuatro tees sin duplicar la tarjeta", () => {
  const laVista = INTERNAL_GOLF_COURSE_CATALOG.courses.find((course) => course.id === "course-la-vista");
  assert.ok(laVista);
  assert.equal(INTERNAL_GOLF_COURSE_CATALOG.tees.filter((tee) => tee.courseId === laVista.id).length, 4);
  assert.equal(INTERNAL_GOLF_COURSE_CATALOG.holes.filter((hole) => hole.courseId === laVista.id).length, 18);

  const blue = golfCourseSelectionToLegacyCourse(INTERNAL_GOLF_COURSE_CATALOG, "tee-la-vista-azules");
  assert.ok(blue);
  assert.equal(blue.id, "lavista-azules");
  assert.equal(blue.catalogCourseId, "course-la-vista");
  assert.equal(blue.catalogTeeId, "tee-la-vista-azules");
  assert.equal(blue.teeName, "Azules");
  assert.equal(blue.totalYards, 7_230);
  assert.equal(blue.holes[0].yards, 435);
  assert.ok((blue.localRules?.length ?? 0) > 0, "el puente conserva las reglas locales existentes");
});

test("las selecciones legacy siguen disponibles por id y el catálogo de lectura queda normalizado", () => {
  assert.deepEqual(DEFAULT_COURSES.map((course) => course.id), [
    "lavista-blancas",
    "lavista-temporal-white",
    "lavista-azules",
    "lavista-doradas",
    "lavista-rojas",
    "campestre-puebla-general",
    "el-cristo-general",
    "cola-de-lagarto-general",
  ]);
  const normalized = buildInternalCourseCatalog(DEFAULT_COURSES);
  assert.equal(normalized.playableCount, 8);
  assert.equal(normalized.rejectedCount, 0);
  assert.equal(normalized.courses.length, 5, "los cuatro tees La Vista comparten una entidad course");
  assert.equal(normalized.tees.length, 8);
  assert.equal(normalized.holes.length, 90);
  assert.equal(DEFAULT_COURSES.find((course) => course.id === "el-cristo-general")?.totalYards, 6_698);
});
