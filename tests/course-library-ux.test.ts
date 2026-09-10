import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const courseLibrary = readFileSync("app/components/course-library.tsx", "utf8");
const page = readFileSync("app/page.tsx", "utf8");

test("la biblioteca pide ubicación únicamente desde la acción Cerca de mí", () => {
  const handlerStart = courseLibrary.indexOf("function requestNearbyCourses()");
  const geolocationStart = courseLibrary.indexOf("navigator.geolocation.getCurrentPosition");
  assert.ok(handlerStart >= 0 && geolocationStart > handlerStart);
  assert.doesNotMatch(courseLibrary.slice(0, handlerStart), /getCurrentPosition/);
  assert.match(courseLibrary, /onClick=\{requestNearbyCourses\}>Cerca de mí/);
  assert.match(courseLibrary, /No compartiste tu ubicación/);
  assert.match(courseLibrary, /Este dispositivo no ofrece ubicación/);
  assert.match(courseLibrary, /No pudimos obtener tu ubicación/);
  assert.match(courseLibrary, /No mostramos distancias inventadas/);
  assert.match(courseLibrary, /Buscar manualmente/);
});

test("la búsqueda usa debounce, estados accesibles y paginación sin cargar el catálogo global en UI", () => {
  assert.match(courseLibrary, /setTimeout\(\(\) => setDebouncedQuery\(query\.trim\(\)\), 280\)/);
  assert.match(courseLibrary, /internalCourseDataProvider\.searchCourses/);
  assert.match(courseLibrary, /aria-live="polite"/);
  assert.match(courseLibrary, /role="alert"/);
  assert.match(courseLibrary, /Cargar más campos/);
  assert.match(courseLibrary, /groupSelections\(visibleCourses\)/);
  assert.match(courseLibrary, /className="betaCourseTeeSelect"/);
  assert.match(courseLibrary, /Mis campos · \{manualCourseCount\}/);
  assert.match(courseLibrary, /filter === "mine" && course\.builtIn === true/);
  assert.match(courseLibrary, /Aún no tienes campos propios/);
  assert.match(courseLibrary, /onToggleFavorite\(chosen\.id\)/, "favoritos conserva el id exacto de la selección\/tee");
});

test("Nueva Ronda separa Campo de Tees por jugador sin cambiar selectRoundCourse", () => {
  assert.match(page, /value=\{courseSelected \? course\.name : ""\}/);
  assert.match(page, /courseNameOptions\.find\(\(candidate\) => candidate\.name === (?:e|event)\.target\.value\)/);
  assert.match(page, /option key=\{option\.name\} value=\{option\.name\}>\{option\.name\}/);
  assert.doesNotMatch(page, /<option[^>]+>\{option\.name\} · \{option\.teeName\}/);
  assert.match(page, /<b>TEES<\/b>/);
  assert.match(page, /updatePlayerTeeAssignment/);
  assert.match(page, /function selectRoundCourse\(nextCourse: Course, returnToSetup = false\)/);
});
