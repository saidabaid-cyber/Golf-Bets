import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const picker = readFileSync("app/components/profile-location-picker.tsx", "utf8");
const css = readFileSync("app/components/profile-location-picker.module.css", "utf8");

test("País y estado usan búsquedas ancladas y se seleccionan por ISO", () => {
  assert.match(picker, /<AnchoredSearch[\s\S]*?Busca un país/);
  assert.match(picker, /searchProfileCountries\(countryQuery\)/);
  assert.match(picker, /searchProfileSubdivisions\(value\.countryCode, stateQuery\)/);
  assert.match(picker, /selectProfileCountry\(option\.code\)/);
  assert.match(picker, /selectProfileSubdivision\(value, option\.code\)/);
});

test("escribir una búsqueda no conserva códigos obsoletos en el parent", () => {
  assert.match(picker, /onChange\(\{ countryCode: "", country: query, stateCode: "", state: "" \}\)/);
  assert.match(picker, /onChange\(\{ \.\.\.value, stateCode: "", state: query \}\)/);
  assert.match(picker, /setStateQuery\(""\)/);
});

test("sin dataset de subdivisiones la región es manual, accesible y normalizable", () => {
  assert.match(picker, /subdivisions\.length === 0/);
  assert.match(picker, /htmlFor=\{manualRegionId\}/);
  assert.match(picker, /autoComplete="address-level1"/);
  assert.match(picker, /normalizeManualRegion\(value\.state\)/);
  assert.match(css, /\.root \{[\s\S]*?min-width: 0/);
  assert.match(css, /\.manualInput \{[\s\S]*?width: 100%/);
});
