import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const picker = readFileSync("app/components/round-course-picker.tsx", "utf8");

test("buscar cerca suspende la búsqueda por nombre y conserva el orden por distancia", () => {
  assert.match(picker, /const \[resultMode, setResultMode\] = useState<"name" \| "nearby">\("name"\)/);
  assert.match(picker, /if \(resultMode === "nearby"\) return;/);
  assert.match(picker, /setResultMode\("nearby"\);\s*setSelectedCourseId\(""\);\s*setResults\(\[\]\)/);
  assert.match(picker, /if \(requestId !== nearbyRequestRef\.current\) return;\s*const next = mergeCourseResults\(\[\], page\.courses \?\? \[\]\)/);
});

test("escribir manualmente o negar ubicación invalida la respuesta cercana anterior", () => {
  assert.match(picker, /onChange=\{\(value\) => \{\s*\+\+nearbyRequestRef\.current;\s*setQuery\(value\);\s*setSelectedCourseId\(""\);\s*setResultMode\("name"\)/);
  assert.match(picker, /\}, \(error\) => \{\s*if \(requestId !== nearbyRequestRef\.current\) return;\s*setResultMode\("name"\);\s*setNearbyStatus\(error\.code === error\.PERMISSION_DENIED \? "denied" : "error"\)/);
  assert.match(picker, /if \(!navigator\.geolocation\) \{\s*setResultMode\("name"\);\s*setNearbyStatus\("error"\)/);
});
