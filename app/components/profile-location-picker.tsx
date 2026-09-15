"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  normalizeManualRegion,
  profileCountryByCode,
  profileCountryFlagEmoji,
  profileSubdivisionsForCountry,
  searchProfileCountries,
  searchProfileSubdivisions,
  selectProfileCountry,
  selectProfileSubdivision,
  type ProfileGeoOption,
  type ProfileLocationValue,
} from "../../lib/profile-geography";
import styles from "./profile-location-picker.module.css";

type GeoComboboxProps = {
  label: string;
  value: string;
  placeholder: string;
  options: readonly ProfileGeoOption[];
  selectedCode: string;
  countryOptions?: boolean;
  status: string;
  error?: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onQuery: (query: string) => void;
  onSelect: (option: ProfileGeoOption) => void;
};

function CountryFlag({ code }: { code: string }) {
  if (code === "MX") return <svg
    className={styles.mexicoFlag}
    data-country-flag="MX"
    viewBox="0 0 30 18"
    aria-hidden="true"
    focusable="false"
  >
    <rect width="10" height="18" fill="#12653e" />
    <rect x="10" width="10" height="18" fill="#fff" />
    <rect x="20" width="10" height="18" fill="#c13b3c" />
    <circle cx="15" cy="9" r="2.7" fill="#9a7650" />
    <path d="M12.8 10.4q2.2 3 4.4 0M13.5 7.9q1.5-2 3 0" fill="none" stroke="#365c3d" strokeWidth=".8" />
  </svg>;
  return <span aria-hidden="true">{profileCountryFlagEmoji(code)}</span>;
}

function GeoCombobox({
  label, value, placeholder, options, selectedCode, countryOptions = false,
  status, error, open, onOpen, onClose, onQuery, onSelect,
}: GeoComboboxProps) {
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  const updatePosition = useCallback(function placePopover() {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewTop = viewport?.offsetTop ?? 0;
    const viewLeft = viewport?.offsetLeft ?? 0;
    const viewHeight = viewport?.height ?? window.innerHeight;
    const viewWidth = viewport?.width ?? window.innerWidth;
    const viewBottom = viewTop + viewHeight;
    // On mobile the virtual keyboard can shrink the visual viewport after focus.
    // Move the field, not the whole page, into view before positioning the list.
    if (rect.bottom > viewBottom - 58 || rect.top < viewTop + 8) {
      input.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      const moved = input.getBoundingClientRect();
      if (Math.abs(moved.top - rect.top) > 2) {
        window.requestAnimationFrame(placePopover);
        return;
      }
    }
    const placed = input.getBoundingClientRect();
    const below = Math.max(0, viewBottom - placed.bottom - 8);
    const above = Math.max(0, placed.top - viewTop - 8);
    const flip = below < 130 && above > below;
    const available = flip ? above : below;
    const maxHeight = Math.max(48, Math.min(360, available));
    const width = Math.min(placed.width, viewWidth - 16);
    const left = Math.max(viewLeft + 8, Math.min(placed.left, viewLeft + viewWidth - width - 8));
    const top = flip ? Math.max(viewTop + 4, placed.top - maxHeight - 4) : placed.bottom + 4;
    setPosition({ top, left, width, maxHeight });
  }, []);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      setActiveIndex(-1);
      return;
    }
    const frame = window.requestAnimationFrame(updatePosition);
    const viewport = window.visualViewport;
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!inputRef.current?.contains(target) && !popoverRef.current?.contains(target)) onClose();
    };
    document.addEventListener("pointerdown", handlePointer, true);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    viewport?.addEventListener("resize", updatePosition);
    viewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointer, true);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      viewport?.removeEventListener("resize", updatePosition);
      viewport?.removeEventListener("scroll", updatePosition);
    };
  }, [open, onClose, updatePosition]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [value]);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      document.getElementById(`${listId}-option-${activeIndex}`)?.scrollIntoView({
        block: "nearest", inline: "nearest", behavior: "auto",
      });
    }
  }, [activeIndex, listId, open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (open) { event.preventDefault(); onClose(); }
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) onOpen();
      if (!options.length) return;
      setActiveIndex((previous) =>
        event.key === "ArrowDown"
          ? (previous + 1) % options.length
          : (previous < 0 ? options.length - 1 : (previous - 1 + options.length) % options.length),
      );
    } else if (event.key === "Enter" && open && activeIndex >= 0 && options[activeIndex]) {
      event.preventDefault();
      onSelect(options[activeIndex]);
    }
  };

  return <div className={styles.field}>
    <label className={styles.label} htmlFor={inputId}>{label}</label>
    <div className={styles.inputShell}>
      {countryOptions && selectedCode && <span className={styles.flag} aria-hidden="true">
        <CountryFlag code={selectedCode} />
      </span>}
      <input
        ref={inputRef}
        id={inputId}
        className={countryOptions && selectedCode ? styles.inputWithFlag : styles.input}
        type="text"
        autoComplete={countryOptions ? "country-name" : "address-level1"}
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
        aria-invalid={Boolean(error) || undefined}
        onFocus={() => { onOpen(); window.requestAnimationFrame(updatePosition); }}
        onClick={() => { onOpen(); window.requestAnimationFrame(updatePosition); }}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          // WebKit touch taps can report relatedTarget=null before click. Keep
          // the list mounted; the document pointerdown listener closes it only
          // when the gesture starts outside the input and popover.
          if (!event.relatedTarget) return;
          window.requestAnimationFrame(() => {
            if (!popoverRef.current?.contains(event.relatedTarget as Node)
              && document.activeElement !== inputRef.current) onClose();
          });
        }}
      />
    </div>
    <span className={error ? styles.error : styles.hint}>{error || status}</span>
    {open && position && createPortal(
      <div
        ref={popoverRef}
        id={listId}
        className={styles.popover}
        role="listbox"
        aria-label={label}
        style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
      >
        {options.length ? options.map((option, index) => <button
          key={option.code}
          id={`${listId}-option-${index}`}
          className={countryOptions ? styles.optionWithFlag : styles.option}
          type="button"
          role="option"
          aria-selected={option.code === selectedCode}
          data-active={index === activeIndex || undefined}
          onPointerDown={(event) => {
            // Mouse keeps focus on the combobox. Touch must retain native list
            // scrolling; select on click only after a tap, never at drag start.
            if (event.pointerType === "mouse") event.preventDefault();
          }}
          onClick={() => onSelect(option)}
        >
          {countryOptions && <span className={styles.optionFlag} aria-hidden="true"><CountryFlag code={option.code} /></span>}
          <b>{option.displayName}</b><small>{option.code}</small>
        </button>) : <span className={styles.noResults}>
          {countryOptions ? "No se encontraron países." : "No se encontraron estados."}
        </span>}
      </div>, document.body,
    )}
  </div>;
}

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

  useEffect(() => { setCountryQuery(value.country); }, [value.countryCode, value.country]);
  useEffect(() => { setStateQuery(value.state); }, [value.stateCode, value.state]);

  return <div className={styles.root}>
    <GeoCombobox
      label={countryRequired ? "País *" : "País"}
      value={countryQuery}
      placeholder="Busca un país"
      options={countryOpen ? searchProfileCountries(countryQuery) : []}
      selectedCode={value.countryCode}
      countryOptions
      status={selectedCountry ? `ISO ${selectedCountry.code}` : "Selecciona un país de la lista."}
      error={countryError}
      open={countryOpen}
      onOpen={() => { setCountryOpen(true); setStateOpen(false); }}
      onClose={() => setCountryOpen(false)}
      onQuery={(query) => {
        setCountryQuery(query);
        setCountryOpen(true);
        setStateOpen(false);
        onChange({ countryCode: "", country: query, stateCode: "", state: "" });
      }}
      onSelect={(option) => {
        const next = selectProfileCountry(option.code);
        setCountryQuery(next.country);
        setStateQuery("");
        setCountryOpen(false);
        setStateOpen(false);
        onChange(next);
      }}
    />

    {selectedCountry && subdivisions.length > 0 && <GeoCombobox
      label={stateRequired ? "Estado / provincia *" : "Estado / provincia"}
      value={stateQuery}
      placeholder="Busca un estado o provincia"
      options={stateOpen ? searchProfileSubdivisions(value.countryCode, stateQuery, subdivisions.length) : []}
      selectedCode={value.stateCode}
      status={value.stateCode ? `ISO ${value.stateCode}` : "Selecciona una opción de la lista."}
      error={stateError}
      open={stateOpen}
      onOpen={() => { setStateOpen(true); setCountryOpen(false); }}
      onClose={() => setStateOpen(false)}
      onQuery={(query) => {
        setStateQuery(query);
        setStateOpen(true);
        onChange({ ...value, stateCode: "", state: query });
      }}
      onSelect={(option) => {
        const next = selectProfileSubdivision(value, option.code);
        setStateQuery(next.state);
        setStateOpen(false);
        onChange(next);
      }}
    />}

    {selectedCountry && subdivisions.length === 0 && <div className={styles.field}>
      <label className={styles.label} htmlFor={manualRegionId}>
        {stateRequired ? "Estado / provincia / región *" : "Estado / provincia / región"}
      </label>
      <input
        id={manualRegionId}
        className={styles.input}
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
