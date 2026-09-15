import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_COUNTRIES,
  normalizeGeoSearchText,
  normalizeManualRegion,
  normalizeProfileLocation,
  profileSubdivisionsForCountry,
  searchProfileCountries,
  searchProfileSubdivisions,
  selectProfileCountry,
  selectProfileSubdivision,
  setProfileManualRegion,
  validateProfileLocation,
} from "../lib/profile-geography";

test("dataset local ISO tiene códigos únicos y subdivisiones completas MX/US/CA", () => {
  assert.equal(PROFILE_COUNTRIES.length, 249);
  assert.equal(new Set(PROFILE_COUNTRIES.map(({ code }) => code)).size, PROFILE_COUNTRIES.length);
  assert.equal(profileSubdivisionsForCountry("MX").length, 32);
  assert.equal(profileSubdivisionsForCountry("US").length, 57);
  assert.equal(profileSubdivisionsForCountry("CA").length, 13);
  for (const countryCode of ["MX", "US", "CA"]) {
    const states = profileSubdivisionsForCountry(countryCode);
    assert.equal(new Set(states.map(({ code }) => code)).size, states.length);
    assert.ok(states.every(({ code }) => code.startsWith(`${countryCode}-`)));
  }
});

test("búsqueda española ignora acentos y encuentra países Unidos/Unido", () => {
  assert.equal(normalizeGeoSearchText("  MÉX ico  "), "mex ico");
  assert.ok(searchProfileCountries("Méx").some(({ code, displayName }) => code === "MX" && displayName === "México"));
  assert.ok(searchProfileCountries("mex").some(({ code }) => code === "MX"));
  const united = searchProfileCountries("Uni", 249).map(({ code }) => code);
  for (const code of ["US", "GB", "AE"]) assert.ok(united.includes(code), code);
  assert.equal(searchProfileCountries("CA", 249).some(({ code }) => code === "CA"), true);
});

test("cambio de país elimina código y texto de región sin mutar valor previo", () => {
  const mexico = selectProfileCountry("mx");
  const withState = selectProfileSubdivision(mexico, "MX-CMX");
  assert.deepEqual(withState, {
    countryCode: "MX", country: "México", stateCode: "MX-CMX", state: "Ciudad de México",
  });
  const unitedStates = selectProfileCountry("US");
  assert.deepEqual(unitedStates, {
    countryCode: "US", country: "Estados Unidos", stateCode: "", state: "",
  });
  assert.equal(withState.stateCode, "MX-CMX");
  assert.equal(searchProfileSubdivisions("MX", "ciudad de mexico")[0]?.code, "MX-CMX");
});

test("legacy de nombre país y estado se convierte a códigos canónicos cuando son conocidos", () => {
  assert.deepEqual(normalizeProfileLocation({ country: "Mexico", state: "Nuevo León" }), {
    countryCode: "MX", country: "México", stateCode: "MX-NLE", state: "Nuevo León",
  });
  assert.deepEqual(normalizeProfileLocation({
    countryCode: "us", country: "otro", stateCode: "us-ca", state: "California",
  }), {
    countryCode: "US", country: "Estados Unidos", stateCode: "US-CA", state: "California",
  });
  assert.equal(normalizeProfileLocation({ country: "USA" }).countryCode, "US");
  assert.equal(normalizeProfileLocation({ country: "UK" }).countryCode, "GB");
});

test("texto legacy desconocido se conserva; metadata no-string no rompe normalización", () => {
  assert.deepEqual(normalizeProfileLocation({ country: "Atlantis", state: " Región Central " }), {
    countryCode: "", country: "Atlantis", stateCode: "", state: "Región Central",
  });
  assert.deepEqual(normalizeProfileLocation({
    countryCode: 99 as unknown as string,
    country: {} as unknown as string,
    stateCode: false as unknown as string,
    state: 42 as unknown as string,
  }), { countryCode: "", country: "", stateCode: "", state: "" });
});

test("región manual se normaliza para países sin dataset pero no para MX/US/CA", () => {
  assert.equal(normalizeManualRegion("  Île   de   France  "), "Île de France");
  assert.deepEqual(setProfileManualRegion(selectProfileCountry("FR"), "  Île   de   France  "), {
    countryCode: "FR", country: "Francia", stateCode: "", state: "Île de France",
  });
  assert.deepEqual(setProfileManualRegion(selectProfileCountry("MX"), "Puebla"), selectProfileCountry("MX"));
  assert.deepEqual(profileSubdivisionsForCountry("FR"), []);
});

test("validación rechaza código incompleto o código/nombre de estado inconsistentes", () => {
  assert.equal(validateProfileLocation({ countryCode: "", country: "Méx" }).valid, false);
  assert.equal(validateProfileLocation({ countryCode: "MX", country: "México", state: "Puebla" }).valid, false);
  assert.equal(validateProfileLocation({
    countryCode: "US", country: "Estados Unidos", stateCode: "US-CA", state: "Puebla",
  }).errors.state, "El estado no coincide con la selección.");
  assert.equal(validateProfileLocation(selectProfileSubdivision(selectProfileCountry("US"), "US-CA")).valid, true);
  assert.equal(validateProfileLocation(setProfileManualRegion(selectProfileCountry("FR"), "Île de France")).valid, true);
  assert.equal(validateProfileLocation(selectProfileCountry("FR"), { stateRequired: true }).valid, false);
  assert.equal(validateProfileLocation({}, { countryRequired: true }).valid, false);
  assert.equal(validateProfileLocation({}).valid, true);
});
