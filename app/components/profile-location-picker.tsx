"use client";

import { useEffect, useId, useState } from "react";
import { AnchoredSearch, AnchoredSearchOption } from "./anchored-search";
import {
  normalizeManualRegion,
  profileCountryByCode,
  profileSubdivisionsForCountry,
  searchProfileCountries,
  searchProfileSubdivisions,
  selectProfileCountry,
  selectProfileSubdivision,
  type ProfileLocationValue,
} from "../../lib/profile-geography";
import styles from "./profile-location-picker.module.css";

export function ProfileLocationPicker({
  value,
  onChange,
  countryError,
  stateError,
  countryRequired = false,
  stateRequired = false,
}: {
  value: ProfileLocationValue;
  onChange: (next: ProfileLocationValue) => void;
  countryError?: string;
  stateError?: string;
  countryRequired?: boolean;
  stateRequired?: boolean;
}) {
  const [countryQuery, setCountryQuery] = useState(value.country);
  const [stateQuery, setStateQuery] = useState(value.state);
  const [countryOpen, setCountryOpen] = useState(false);
  const [stateOpen, setStateOpen] = useState(false);
  const manualRegionId = useId();
  const selectedCountry = profileCountryByCode(value.countryCode);
  const subdivisions = profileSubdivisionsForCountry(value.countryCode);

  useEffect(() => {
    setCountryQuery(value.country);
  }, [value.countryCode, value.country]);

  useEffect(() => {
    setStateOpen(false);
  }, [value.countryCode]); // Changing country always clears the old subdivision.

  useEffect(() => {
    setStateQuery(value.state);
  }, [value.stateCode, value.state]);

  const countryOptions = countryOpen ? searchProfileCountries(countryQuery) : [];
  const stateOptions = stateOpen ? searchProfileSubdivisions(value.countryCode, stateQuery) : [];

  return <div className={styles.root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setCountryOpen(false);
      setStateOpen(false);
    }
  }} onKeyDown={(event) => {
    if (event.key === "Escape") {
      setCountryOpen(false);
      setStateOpen(false);
    }
  }}>
    <div className={styles.field}>
      <AnchoredSearch
        label={countryRequired ? "País *" : "País"}
        value={countryQuery}
        placeholder="Busca un país"
        expanded={countryOpen}
        onFocus={() => { setCountryOpen(true); setStateOpen(false); }}
        invalid={Boolean(countryError)}
        status={countryError
          ? <span className={styles.error}>{countryError}</span>
          : selectedCountry ? <span>ISO {selectedCountry.code}</span> : "Selecciona un país de la lista."}
        onChange={(query) => {
          setCountryQuery(query);
          setCountryOpen(true);
          setStateOpen(false);
          onChange({ countryCode: "", country: query, stateCode: "", state: "" });
        }}
      >
        {countryOptions.length
          ? countryOptions.map((option) => <AnchoredSearchOption
            key={option.code}
            label={`${option.displayName}, ${option.code}`}
            selected={option.code === value.countryCode}
            onSelect={() => {
              const next = selectProfileCountry(option.code);
              setCountryQuery(next.country);
              setStateQuery("");
              setCountryOpen(false);
              onChange(next);
            }}
          ><b>{option.displayName}</b><small>{option.code}</small></AnchoredSearchOption>)
          : <span className={styles.noResults}>No se encontraron países.</span>}
      </AnchoredSearch>
    </div>

    {selectedCountry && subdivisions.length > 0 && <div className={styles.field}>
      <AnchoredSearch
        label={stateRequired ? "Estado / provincia *" : "Estado / provincia"}
        value={stateQuery}
        placeholder="Busca un estado o provincia"
        expanded={stateOpen}
        onFocus={() => { setStateOpen(true); setCountryOpen(false); }}
        invalid={Boolean(stateError)}
        status={stateError
          ? <span className={styles.error}>{stateError}</span>
          : value.stateCode ? <span>ISO {value.stateCode}</span> : "Selecciona una opción de la lista."}
        onChange={(query) => {
          setStateQuery(query);
          setStateOpen(true);
          onChange({ ...value, stateCode: "", state: query });
        }}
      >
        {stateOptions.length
          ? stateOptions.map((option) => <AnchoredSearchOption
            key={option.code}
            label={`${option.displayName}, ${option.code}`}
            selected={option.code === value.stateCode}
            onSelect={() => {
              const next = selectProfileSubdivision(value, option.code);
              setStateQuery(next.state);
              setStateOpen(false);
              onChange(next);
            }}
          ><b>{option.displayName}</b><small>{option.code}</small></AnchoredSearchOption>)
          : <span className={styles.noResults}>No se encontraron estados.</span>}
      </AnchoredSearch>
    </div>}

    {selectedCountry && subdivisions.length === 0 && <div className={styles.field}>
      <label className={styles.label} htmlFor={manualRegionId}>
        {stateRequired ? "Estado / provincia / región *" : "Estado / provincia / región"}
      </label>
      <input
        id={manualRegionId}
        className={styles.manualInput}
        type="text"
        maxLength={100}
        autoComplete="address-level1"
        value={value.state}
        aria-invalid={Boolean(stateError) || undefined}
        placeholder="Escribe tu región"
        onChange={(event) => onChange({ ...value, stateCode: "", state: event.target.value })}
        onBlur={() => {
          const state = normalizeManualRegion(value.state);
          if (state !== value.state) onChange({ ...value, stateCode: "", state });
        }}
      />
      <span className={stateError ? styles.error : styles.hint}>
        {stateError || "Este país no tiene una lista local; escribe tu estado, provincia o región."}
      </span>
    </div>}

    {!selectedCountry && value.state && <p className={styles.legacyHint}>
      La región anterior se conserva. Selecciona un país para actualizarla.
    </p>}
  </div>;
}
