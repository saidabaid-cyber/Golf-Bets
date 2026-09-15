import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const picker = readFileSync("app/components/profile-location-picker.tsx", "utf8");
const css = readFileSync("app/components/profile-location-picker.module.css", "utf8");

test("País y estado usan el mismo combobox portal y se seleccionan por ISO", () => {
  assert.match(picker, /<GeoCombobox[\s\S]*?Busca un país/);
  assert.match(picker, /searchProfileCountries\(countryQuery\)/);
  assert.match(picker, /searchProfileSubdivisions\(value\.countryCode, stateQuery, subdivisions\.length\)/);
  assert.match(picker, /selectProfileCountry\(option\.code\)/);
  assert.match(picker, /selectProfileSubdivision\(value, option\.code\)/);
  assert.match(picker, /createPortal\([\s\S]*?document\.body/);
  assert.match(css, /\.popover \{[\s\S]*?position: fixed;[\s\S]*?z-index: 1200/);
  assert.match(picker, /data-country-flag="MX"/);
  assert.match(css, /\.mexicoFlag \{[\s\S]*?width: 27px/);
});

test("tap WebKit, teclado y teclado móvil no desmontan el resultado antes de seleccionarlo", () => {
  assert.match(picker, /if \(!event\.relatedTarget\) return;/);
  assert.match(picker, /if \(event\.pointerType === "mouse"\) event\.preventDefault\(\)/);
  assert.match(picker, /onClick=\{\(\) => onSelect\(option\)\}/);
  assert.match(picker, /Touch must retain native list[\s\S]*?scrolling; select on click only/);
  assert.match(picker, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(picker, /event\.key === "Enter"/);
  assert.match(picker, /role="combobox"/);
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /role="option"/);
  assert.match(picker, /visualViewport/);
  assert.match(picker, /scrollIntoView/);
  assert.match(css, /\.input,[\s\S]*?font-size: 16px/);
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
  assert.match(css, /\.input,[\s\S]*?\.inputWithFlag \{[\s\S]*?width: 100%/);
});
