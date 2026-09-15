import { PROFILE_COUNTRY_ROWS } from "./profile-geography-data";
import { PROFILE_SUBDIVISION_ROWS } from "./profile-geography-subdivisions";

export type ProfileLocationValue = {
  countryCode: string;
  country: string;
  stateCode: string;
  state: string;
};

export type ProfileGeoOption = { code: string; displayName: string };

export const EMPTY_PROFILE_LOCATION: ProfileLocationValue = {
  countryCode: "",
  country: "",
  stateCode: "",
  state: "",
};

export const PROFILE_COUNTRIES: readonly ProfileGeoOption[] = PROFILE_COUNTRY_ROWS.map(
  ([code, displayName]) => ({ code, displayName }),
);

const countryByCode = new Map(PROFILE_COUNTRIES.map((country) => [country.code, country]));
const subdivisionByCountry = new Map<string, readonly ProfileGeoOption[]>(
  Object.entries(PROFILE_SUBDIVISION_ROWS).map(([countryCode, rows]) => [
    countryCode,
    rows.map(([code, displayName]) => ({ code, displayName })),
  ]),
);

function safeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeGeoSearchText(value: string): string {
  return safeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeManualRegion(value: string): string {
  return safeText(value).normalize("NFC").trim().replace(/\s+/g, " ").slice(0, 100);
}

export function profileCountryByCode(countryCode: string): ProfileGeoOption | undefined {
  return countryByCode.get(safeText(countryCode).trim().toUpperCase());
}

export function profileCountryFlagEmoji(countryCode: string): string {
  const country = profileCountryByCode(countryCode);
  if (!country) return "";
  return [...country.code].map(
    (letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65),
  ).join("");
}

export function profileSubdivisionsForCountry(countryCode: string): readonly ProfileGeoOption[] {
  return subdivisionByCountry.get(safeText(countryCode).trim().toUpperCase()) ?? [];
}

export function profileSubdivisionByCode(countryCode: string, stateCode: string): ProfileGeoOption | undefined {
  return profileSubdivisionsForCountry(countryCode).find(
    (subdivision) => subdivision.code === safeText(stateCode).trim().toUpperCase(),
  );
}

const POPULAR_COUNTRY_CODES = ["MX", "US", "CA", "GB", "ES", "AR", "CO"] as const;

const COUNTRY_SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  MX: ["mejico"],
  US: ["usa", "eeuu", "ee uu", "estados unidos de america", "united states"],
  GB: ["uk", "united kingdom", "gran bretana"],
  AE: ["eau", "uae", "emiratos arabes unidos", "united arab emirates"],
};

function countrySearchTerms(country: ProfileGeoOption): string[] {
  return [
    normalizeGeoSearchText(country.displayName),
    normalizeGeoSearchText(country.code),
    ...(COUNTRY_SEARCH_ALIASES[country.code] ?? []).map(normalizeGeoSearchText),
  ];
}

export function searchProfileCountries(query: string, limit = 12): ProfileGeoOption[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  const needle = normalizeGeoSearchText(query);
  if (!needle) {
    return POPULAR_COUNTRY_CODES.map((code) => countryByCode.get(code))
      .filter((country): country is ProfileGeoOption => Boolean(country))
      .slice(0, safeLimit);
  }
  return PROFILE_COUNTRIES.filter(
    (country) => countrySearchTerms(country).some((term) => term.includes(needle)),
  ).sort((a, b) => {
    const aStarts = countrySearchTerms(a).some((term) => term.startsWith(needle)) ? 0 : 1;
    const bStarts = countrySearchTerms(b).some((term) => term.startsWith(needle)) ? 0 : 1;
    return aStarts - bStarts || a.displayName.localeCompare(b.displayName, "es");
  }).slice(0, safeLimit);
}

export function searchProfileSubdivisions(countryCode: string, query: string, limit = 12): ProfileGeoOption[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  const needle = normalizeGeoSearchText(query);
  const subdivisions = profileSubdivisionsForCountry(countryCode);
  if (!needle) return subdivisions.slice(0, safeLimit);
  return subdivisions.filter(
    (subdivision) => normalizeGeoSearchText(subdivision.displayName).includes(needle)
      || normalizeGeoSearchText(subdivision.code).includes(needle),
  ).sort((a, b) => a.displayName.localeCompare(b.displayName, "es")).slice(0, safeLimit);
}

const COUNTRY_NAME_ALIASES: Readonly<Record<string, string>> = {
  "estados unidos de america": "US",
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  "u s a": "US",
  eeuu: "US",
  "ee uu": "US",
  "united kingdom": "GB",
  uk: "GB",
  "gran bretana": "GB",
  canada: "CA",
  mexico: "MX",
  mejico: "MX",
  uae: "AE",
  eau: "AE",
  "united arab emirates": "AE",
};

function findCountryByName(name: string): ProfileGeoOption | undefined {
  const needle = normalizeGeoSearchText(name);
  const alias = COUNTRY_NAME_ALIASES[needle];
  if (alias) return countryByCode.get(alias);
  return PROFILE_COUNTRIES.find(
    (country) => normalizeGeoSearchText(country.displayName) === needle,
  );
}

function findSubdivisionByName(countryCode: string, name: string): ProfileGeoOption | undefined {
  const needle = normalizeGeoSearchText(name);
  return profileSubdivisionsForCountry(countryCode).find(
    (subdivision) => normalizeGeoSearchText(subdivision.displayName) === needle,
  );
}

export function normalizeProfileLocation(value: Partial<ProfileLocationValue> | null | undefined): ProfileLocationValue {
  if (!value) return { ...EMPTY_PROFILE_LOCATION };
  const rawCountryCode = safeText(value.countryCode).trim().toUpperCase().slice(0, 10);
  const rawCountry = safeText(value.country).normalize("NFC").trim().replace(/\s+/g, " ").slice(0, 120);
  const rawState = normalizeManualRegion(value.state ?? "");
  const rawStateCode = safeText(value.stateCode).trim().toUpperCase().slice(0, 16);
  const country = profileCountryByCode(rawCountryCode) ?? findCountryByName(rawCountry);
  // Do not erase an older free-text country when another profile field is edited.
  // The picker still requires a canonical ISO selection before saving a new location.
  if (!country) {
    return { countryCode: rawCountryCode, country: rawCountry, stateCode: rawStateCode, state: rawState };
  }
  const subdivision = profileSubdivisionByCode(country.code, rawStateCode)
    ?? findSubdivisionByName(country.code, rawState);
  return {
    countryCode: country.code,
    country: country.displayName,
    stateCode: subdivision?.code ?? "",
    state: subdivision?.displayName ?? rawState,
  };
}

export function selectProfileCountry(countryCode: string): ProfileLocationValue {
  const country = profileCountryByCode(countryCode);
  return country
    ? { countryCode: country.code, country: country.displayName, stateCode: "", state: "" }
    : { ...EMPTY_PROFILE_LOCATION };
}

export function selectProfileSubdivision(value: ProfileLocationValue, stateCode: string): ProfileLocationValue {
  const country = profileCountryByCode(value.countryCode);
  const subdivision = country && profileSubdivisionByCode(country.code, stateCode);
  return {
    ...normalizeProfileLocation(value),
    stateCode: subdivision?.code ?? "",
    state: subdivision?.displayName ?? "",
  };
}

export function setProfileManualRegion(value: ProfileLocationValue, state: string): ProfileLocationValue {
  const country = profileCountryByCode(value.countryCode);
  if (!country || profileSubdivisionsForCountry(country.code).length) {
    return { ...normalizeProfileLocation(value), stateCode: "", state: "" };
  }
  return { countryCode: country.code, country: country.displayName, stateCode: "", state: normalizeManualRegion(state) };
}

export type ProfileLocationValidation = {
  valid: boolean;
  errors: { country?: string; state?: string };
};

export function validateProfileLocation(
  value: Partial<ProfileLocationValue>,
  options: { countryRequired?: boolean; stateRequired?: boolean } = {},
): ProfileLocationValidation {
  const errors: ProfileLocationValidation["errors"] = {};
  const countryCode = safeText(value.countryCode).trim().toUpperCase();
  const country = profileCountryByCode(countryCode);
  if (!country && (options.countryRequired || countryCode || safeText(value.country).trim())) {
    errors.country = "Selecciona un país de la lista.";
  }
  if (country) {
    const subdivisions = profileSubdivisionsForCountry(country.code);
    const stateCode = safeText(value.stateCode).trim().toUpperCase();
    const state = normalizeManualRegion(value.state ?? "");
    if (subdivisions.length) {
      const selected = profileSubdivisionByCode(country.code, stateCode);
      if (!selected && (options.stateRequired || stateCode || state)) {
        errors.state = "Selecciona un estado o provincia de la lista.";
      } else if (selected && state && normalizeGeoSearchText(state) !== normalizeGeoSearchText(selected.displayName)) {
        errors.state = "El estado no coincide con la selección.";
      }
    } else if ((options.stateRequired && !state) || stateCode) {
      errors.state = "Escribe tu estado, provincia o región.";
    }
  } else if (options.stateRequired && !errors.country) {
    errors.country = "Selecciona un país antes de la región.";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}
