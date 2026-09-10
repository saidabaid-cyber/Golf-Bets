"use client";

import { useMemo, useState, type FormEvent } from "react";
import type {
  ClubCategory,
  ClubHandedness,
  GolfBallCatalog,
  GolfClubCatalog,
  GolfShaftCatalog,
  PlayerBall,
  PlayerClub,
  PlayerClubDistance,
  ShaftFlex,
} from "../../lib/golf-equipment";
import { resolveCatalogShaftSelection } from "../../lib/equipment-editor-selection";
import styles from "./equipment.module.css";
import { useEquipmentCatalogSearch } from "./use-equipment-catalog-search";
import { useModalDialog } from "./use-modal-dialog";

export const CLUB_CATEGORY_LABELS: Record<ClubCategory, string> = {
  DRIVER: "Driver",
  MINI_DRIVER: "Mini Driver",
  FAIRWAY_WOOD: "Maderas",
  HYBRID: "Híbridos",
  UTILITY_IRON: "Utility / Driving Iron",
  IRON_SET: "Hierros",
  WEDGE: "Wedges",
  PUTTER: "Putter",
};

export const CLUB_CATEGORY_ICONS: Record<ClubCategory, string> = {
  DRIVER: "D",
  MINI_DRIVER: "MD",
  FAIRWAY_WOOD: "W",
  HYBRID: "H",
  UTILITY_IRON: "U",
  IRON_SET: "I",
  WEDGE: "°",
  PUTTER: "P",
};

const FLEX_LABELS: Record<ShaftFlex, string> = {
  LADIES: "Ladies",
  SENIOR: "Senior",
  REGULAR: "Regular",
  STIFF: "Stiff",
  X_STIFF: "X-Stiff",
  TX: "TX",
  OTHER: "Otro",
};

export const CUSTOM_IRON_COMPOSITION = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "P", "PW", "AW", "GW", "UW", "SW", "LW", "46°", "48°", "50°", "52°", "54°", "56°", "58°", "60°"] as const;
const IRON_SET_PACKAGES = [
  { label: "4–P", clubs: ["4", "5", "6", "7", "8", "9", "P"] },
  { label: "4–AW", clubs: ["4", "5", "6", "7", "8", "9", "P", "AW"] },
  { label: "5–P", clubs: ["5", "6", "7", "8", "9", "P"] },
  { label: "5–AW", clubs: ["5", "6", "7", "8", "9", "P", "AW"] },
] as const;

function uid(prefix: string) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function numberOrNull(value: string, minimum: number, maximum: number): number | null | undefined {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function yearOrNull(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2200 ? parsed : undefined;
}

function sameBrand(left: string, right: string) {
  return left.localeCompare(right, "en-US", { sensitivity: "base" }) === 0;
}

function sameIdentityText(left: string | null | undefined, right: string | null | undefined) {
  return (left || "").trim().localeCompare((right || "").trim(), "en-US", { sensitivity: "base" }) === 0;
}

type ClubEditorProps = {
  userId: string;
  catalog: readonly GolfClubCatalog[];
  shafts: readonly GolfShaftCatalog[];
  existing?: PlayerClub | null;
  onCancel: () => void;
  onSave: (club: PlayerClub) => void;
};

export function ClubEditor({ userId, catalog, shafts, existing, onCancel, onSave }: ClubEditorProps) {
  const dialogRef = useModalDialog(true, onCancel);
  const existingCatalog = existing?.catalogClubId ? catalog.find((club) => club.id === existing.catalogClubId) : null;
  const [category, setCategory] = useState<ClubCategory>(existing?.category || "DRIVER");
  const [manual, setManual] = useState(Boolean(existing && !existing.catalogClubId));
  const [brand, setBrand] = useState(existingCatalog?.brand || existing?.customBrand || "");
  const [catalogClubId, setCatalogClubId] = useState(existing?.catalogClubId || existingCatalog?.id || "");
  const [customModel, setCustomModel] = useState(existing?.customModel || "");
  const [generation, setGeneration] = useState(existing?.generation || existingCatalog?.generation || "");
  const [year, setYear] = useState(existing?.year ? String(existing.year) : existingCatalog?.year ? String(existingCatalog.year) : "");
  const [loft, setLoft] = useState(existing?.loft === null || existing?.loft === undefined ? "" : String(existing.loft));
  const [handedness, setHandedness] = useState<ClubHandedness>(existing?.handedness || "RH");
  const existingShaft = existing?.shaftId ? shafts.find((shaft) => shaft.id === existing.shaftId) : null;
  const [shaftManual, setShaftManual] = useState(Boolean(
    existing && !existing.shaftId && (existing.customShaftBrand || existing.customShaftModel || existing.customShaft),
  ));
  const [shaftId, setShaftId] = useState(existing?.shaftId || existingShaft?.id || "");
  const [customShaftBrand, setCustomShaftBrand] = useState(existing?.customShaftBrand || "");
  const [customShaftModel, setCustomShaftModel] = useState(existing?.customShaftModel || existing?.customShaft || "");
  const [flex, setFlex] = useState<ShaftFlex | "">(existing?.flex || "");
  const [shaftWeight, setShaftWeight] = useState(existing?.shaftWeightGrams === null || existing?.shaftWeightGrams === undefined ? "" : String(existing.shaftWeightGrams));
  const [length, setLength] = useState(existing?.lengthInches === null || existing?.lengthInches === undefined ? "" : String(existing.lengthInches));
  const [lie, setLie] = useState(existing?.lieDegrees === null || existing?.lieDegrees === undefined ? "" : String(existing.lieDegrees));
  const [grip, setGrip] = useState(existing?.grip || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [composition, setComposition] = useState(existing?.setComposition || []);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [shaftQuery, setShaftQuery] = useState("");
  const [message, setMessage] = useState("");

  const categoryCatalog = useMemo(() => catalog.filter((club) => club.category === category && (club.active || club.id === existingCatalog?.id)), [catalog, category, existingCatalog?.id]);
  const pinnedClubIds = useMemo(() => catalogClubId ? [catalogClubId] : [], [catalogClubId]);
  const catalogSearch = useEquipmentCatalogSearch({ kind: "CLUB", query: catalogQuery, category, fallback: categoryCatalog, pinnedIds: pinnedClubIds });
  const selectableCatalog = useMemo(() => {
    const byId = new Map(catalogSearch.items.map((club) => [club.id, club]));
    if (existingCatalog?.category === category) byId.set(existingCatalog.id, existingCatalog);
    return [...byId.values()];
  }, [catalogSearch.items, category, existingCatalog]);
  const selectedCatalogClub = selectableCatalog.find((club) => club.id === catalogClubId)
    || catalog.find((club) => club.id === catalogClubId)
    || null;
  const effectiveBrand = brand || selectedCatalogClub?.brand || "";
  const brands = useMemo(() => [...new Set(selectableCatalog.map((club) => club.brand))].sort((a, b) => a.localeCompare(b, "es-MX")), [selectableCatalog]);
  const models = selectableCatalog.filter((club) => sameBrand(club.brand, effectiveBrand));
  const shaftFallback = useMemo(() => shafts.filter((shaft) => shaft.active || shaft.id === existingShaft?.id), [existingShaft?.id, shafts]);
  const pinnedShaftIds = useMemo(() => shaftId ? [shaftId] : [], [shaftId]);
  const shaftSearch = useEquipmentCatalogSearch({ kind: "SHAFT", query: shaftQuery, fallback: shaftFallback, pinnedIds: pinnedShaftIds });
  const activeShafts = useMemo(() => {
    const byId = new Map(shaftSearch.items.map((shaft) => [shaft.id, shaft]));
    if (existingShaft) byId.set(existingShaft.id, existingShaft);
    return [...byId.values()];
  }, [existingShaft, shaftSearch.items]);
  const selectedShaft = resolveCatalogShaftSelection(shaftId, activeShafts, existingShaft);
  const selectedVariant = selectedCatalogClub?.variants.find((variant) => Math.abs(variant.loft - Number(loft)) < 0.001) || null;
  const availableHands = selectedVariant?.handedness || selectedCatalogClub?.handedness || (["RH", "LH"] as ClubHandedness[]);

  function chooseCategory(value: ClubCategory) {
    setCategory(value);
    setBrand("");
    setCatalogClubId("");
    setCustomModel("");
    setGeneration("");
    setYear("");
    setLoft("");
    setCatalogQuery("");
    if (value !== "IRON_SET") setComposition([]);
  }

  function chooseModel(id: string) {
    setCatalogClubId(id);
    const selected = selectableCatalog.find((club) => club.id === id) || catalog.find((club) => club.id === id);
    if (selected) {
      setGeneration(selected.generation || "");
      setYear(selected.year ? String(selected.year) : "");
      setLoft(selected.lofts.length === 1 ? String(selected.lofts[0]) : "");
      if (!selected.handedness.includes(handedness)) setHandedness(selected.handedness[0] || "RH");
    }
  }

  function changeLoft(value: string) {
    setLoft(value);
    const selected = selectableCatalog.find((club) => club.id === catalogClubId) || catalog.find((club) => club.id === catalogClubId);
    const variant = selected?.variants.find((item) => Math.abs(item.loft - Number(value)) < 0.001);
    if (variant && !variant.handedness.includes(handedness)) setHandedness(variant.handedness[0] || "RH");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const selectedClub = selectableCatalog.find((club) => club.id === catalogClubId) || catalog.find((club) => club.id === catalogClubId);
    const cleanBrand = effectiveBrand.trim();
    const cleanModel = customModel.trim();
    const catalogModel = selectedClub?.model || (catalogClubId === existing?.catalogClubId ? existing?.customModel : null);
    if (manual ? (!cleanBrand || !cleanModel) : (!catalogClubId || !cleanBrand || !catalogModel)) {
      setMessage(manual ? "Escribe marca y modelo para guardar este bastón." : "Selecciona una marca y un modelo del catálogo.");
      return;
    }
    const parsedYear = yearOrNull(year);
    const parsedLoft = numberOrNull(loft, 0, 90);
    const parsedWeight = numberOrNull(shaftWeight, 1, 300);
    const parsedLength = numberOrNull(length, 10, 60);
    const parsedLie = numberOrNull(lie, 30, 90);
    if (parsedYear === undefined || parsedLoft === undefined || parsedWeight === undefined || parsedLength === undefined || parsedLie === undefined) {
      setMessage("Revisa año, loft, peso, longitud y lie. Puedes dejarlos vacíos si no los conoces.");
      return;
    }
    if (selectedClub && !selectedClub.handedness.includes(handedness)) {
      setMessage("La mano elegida no está verificada para este modelo. Usa ‘Mi bastón no aparece’ para guardar una configuración manual.");
      return;
    }
    const verifiedVariant = selectedClub?.variants.find((variant) => parsedLoft !== null && Math.abs(variant.loft - parsedLoft) < 0.001);
    if (verifiedVariant && !verifiedVariant.handedness.includes(handedness)) {
      setMessage(`El loft ${parsedLoft}° no aparece en mano ${handedness} en la ficha verificada. Puedes elegir otra variante o capturarlo manualmente.`);
      return;
    }
    const now = new Date().toISOString();
    const cleanShaftBrand = customShaftBrand.trim();
    const cleanShaftModel = customShaftModel.trim();
    const savedShaftBrand = shaftManual ? cleanShaftBrand : selectedShaft?.brand || (shaftId === existing?.shaftId ? existing?.customShaftBrand : null);
    const savedShaftModel = shaftManual ? cleanShaftModel : selectedShaft?.model || (shaftId === existing?.shaftId ? existing?.customShaftModel || existing?.customShaft : null);
    const legacyCustomShaft = [savedShaftBrand, savedShaftModel].filter(Boolean).join(" ") || null;
    const savedModel = manual ? cleanModel : catalogModel;
    const savedGeneration = generation.trim() || selectedClub?.generation || null;
    const savedYear = parsedYear === null ? selectedClub?.year || null : parsedYear;
    const identityChanged = Boolean(existing?.isCurrent && (
      existing.category !== category
      || (existing.catalogClubId || catalogClubId
        ? existing.catalogClubId !== (manual ? null : catalogClubId || null)
        : !sameIdentityText(existing.customBrand, cleanBrand) || !sameIdentityText(existing.customModel, savedModel))
      || !sameIdentityText(existing.generation, savedGeneration)
      || existing.year !== savedYear
    ));
    onSave({
      id: identityChanged ? uid("club") : existing?.id || uid("club"),
      userId,
      category,
      catalogClubId: manual ? null : catalogClubId || null,
      // These fields are also the immutable display snapshot for a catalog
      // selection. A saved bag stays readable if that model is later archived
      // or the catalog provider is temporarily unavailable.
      customBrand: cleanBrand,
      customModel: savedModel,
      generation: savedGeneration,
      year: savedYear,
      loft: parsedLoft ?? null,
      handedness,
      shaftId: shaftManual ? null : shaftId || null,
      customShaftBrand: savedShaftBrand || null,
      customShaftModel: savedShaftModel || null,
      customShaft: legacyCustomShaft,
      flex: flex || null,
      shaftWeightGrams: parsedWeight ?? null,
      lengthInches: parsedLength ?? null,
      lieDegrees: parsedLie ?? null,
      grip: grip.trim() || null,
      notes: notes.trim() || null,
      setComposition: category === "IRON_SET" ? composition : [],
      isCurrent: existing?.isCurrent ?? true,
      startedUsingAt: identityChanged ? now : existing?.startedUsingAt || (existing?.isCurrent === false ? null : now),
      stoppedUsingAt: identityChanged ? null : existing?.stoppedUsingAt || null,
      createdAt: identityChanged ? now : existing?.createdAt || now,
      updatedAt: now,
    });
  }

  return <div className={styles.editorBackdrop} role="presentation">
    <section ref={dialogRef} tabIndex={-1} className={styles.editorSheet} role="dialog" aria-modal="true" aria-labelledby="club-editor-title">
      <div className={styles.sheetHandle} />
      <h2 id="club-editor-title">{existing ? "Editar bastón" : "Agregar a mi bolsa"}</h2>
      <p>Marca + modelo es suficiente. Las especificaciones son opcionales.</p>
      <form className={styles.formGrid} onSubmit={submit} noValidate>
        <label className={styles.fullField}>Categoría
          <select value={category} onChange={(event) => chooseCategory(event.target.value as ClubCategory)}>
            {Object.entries(CLUB_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        {!manual ? <>
          <label className={styles.fullField}>Buscar bastón
            <input type="search" value={catalogQuery} maxLength={120} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Ej. TaylorMade o GT3" autoComplete="off" />
            <span className={styles.subtle} role="status">{catalogSearch.status === "loading" ? "Buscando…" : catalogSearch.status === "error" ? "Sin conexión: puedes usar ‘Mi bastón no aparece’." : `${selectableCatalog.length} resultado(s)`}</span>
          </label>
          <label>Marca
            <select value={effectiveBrand} onChange={(event) => { setBrand(event.target.value); setCatalogClubId(""); setGeneration(""); setYear(""); setLoft(""); }}>
              <option value="">Selecciona marca</option>
              {effectiveBrand && !brands.some((value) => sameBrand(value, effectiveBrand)) && <option value={effectiveBrand}>{effectiveBrand} · guardada</option>}
              {brands.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          {catalogSearch.hasMore && <button className={styles.manualToggle} type="button" onClick={() => void catalogSearch.loadMore()}>Cargar más modelos</button>}
          <label>Modelo
            <select value={catalogClubId} disabled={!effectiveBrand} onChange={(event) => chooseModel(event.target.value)}>
              <option value="">Selecciona modelo</option>
              {catalogClubId && !selectedCatalogClub && existing?.customModel && <option value={catalogClubId}>{existing.customModel} · guardado</option>}
              {models.map((club) => <option key={club.id} value={club.id}>{club.model}{club.generation ? ` · ${club.generation}` : ""}{club.active ? "" : " · anterior"}</option>)}
            </select>
          </label>
        </> : <>
          <label>Marca<input value={brand} maxLength={100} onChange={(event) => setBrand(event.target.value)} placeholder="Marca" /></label>
          <label>Modelo<input value={customModel} maxLength={140} onChange={(event) => setCustomModel(event.target.value)} placeholder="Modelo" /></label>
        </>}

        <button className={styles.manualToggle} type="button" onClick={() => { setManual((value) => !value); setCatalogClubId(""); setCustomModel(""); setGeneration(""); setYear(""); setLoft(""); setMessage(""); }}>
          {manual ? "Volver al catálogo" : "Mi bastón no aparece"}
        </button>

        <label>Generación (opcional)<input value={generation} maxLength={100} onChange={(event) => setGeneration(event.target.value)} placeholder="Ej. Gen 2" /></label>
        <label>Año (opcional)<input type="number" inputMode="numeric" min={1900} max={2200} value={year} onChange={(event) => setYear(event.target.value)} placeholder="2025" /></label>
        <label>Loft ° (opcional)<input type="number" inputMode="decimal" min={0} max={90} step="0.1" list="verified-club-lofts" value={loft} onChange={(event) => changeLoft(event.target.value)} placeholder="10.5" /><datalist id="verified-club-lofts">{selectedCatalogClub?.lofts.map((value) => <option key={value} value={value} />)}</datalist></label>
        <label>Mano
          <select value={handedness} onChange={(event) => setHandedness(event.target.value as ClubHandedness)}>{availableHands.includes("RH") && <option value="RH">RH · Derecha</option>}{availableHands.includes("LH") && <option value="LH">LH · Izquierda</option>}</select>
        </label>

        {category === "IRON_SET" && <fieldset className={styles.choiceFieldset}>
          <legend>Composición del set (opcional)</legend>
          <div className={styles.choiceGrid}>{IRON_SET_PACKAGES.map((set) => <button type="button" className={styles.manualToggle} key={set.label} onClick={() => setComposition([...set.clubs])}>{set.label}</button>)}</div>
          <p className={styles.subtle}>Personalizar set</p>
          <div className={styles.choiceGrid}>{CUSTOM_IRON_COMPOSITION.map((club) => <label key={club}><input type="checkbox" checked={composition.includes(club)} onChange={(event) => setComposition((current) => event.target.checked ? [...current, club] : current.filter((item) => item !== club))} />{club}</label>)}</div>
        </fieldset>}

        {!shaftManual ? <><label className={styles.fullField}>Buscar varilla (opcional)
          <input type="search" value={shaftQuery} maxLength={120} onChange={(event) => setShaftQuery(event.target.value)} placeholder="Ej. Ventus Blue" autoComplete="off" />
          <span className={styles.subtle} role="status">{shaftSearch.status === "loading" ? "Buscando…" : shaftSearch.status === "error" ? "Sin conexión: puedes capturar la varilla manualmente." : `${activeShafts.length} resultado(s)`}</span>
        </label><label className={styles.fullField}>Varilla (opcional)
          <select value={shaftId} onChange={(event) => { setShaftId(event.target.value); const selected = activeShafts.find((shaft) => shaft.id === event.target.value); if (selected?.weight) setShaftWeight(String(selected.weight)); if (selected?.flex.length === 1) setFlex(selected.flex[0]); }}>
            <option value="">No lo sé / sin indicar</option>
            {shaftId && !selectedShaft && <option value={shaftId}>{[existing?.customShaftBrand, existing?.customShaftModel || existing?.customShaft].filter(Boolean).join(" ") || "Shaft guardado"}</option>}
            {activeShafts.map((shaft) => <option key={shaft.id} value={shaft.id}>{shaft.brand} {shaft.model}</option>)}
          </select>
        </label>{shaftSearch.hasMore && <button className={styles.manualToggle} type="button" onClick={() => void shaftSearch.loadMore()}>Cargar más varillas</button>}</> : <>
          <label>Marca de varilla (opcional)<input value={customShaftBrand} maxLength={100} onChange={(event) => setCustomShaftBrand(event.target.value)} placeholder="Ej. Fujikura" /></label>
          <label>Modelo de varilla (opcional)<input value={customShaftModel} maxLength={140} onChange={(event) => setCustomShaftModel(event.target.value)} placeholder="Ej. Ventus Blue" /></label>
        </>}
        <button type="button" className={styles.manualToggle} onClick={() => { setShaftManual((value) => !value); setShaftId(""); }}>{shaftManual ? "Elegir varilla del catálogo" : "Mi varilla no aparece"}</button>

        <label>Flex (opcional)<select value={flex} onChange={(event) => setFlex(event.target.value as ShaftFlex | "")}><option value="">No lo sé</option>{Object.entries(FLEX_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Peso de varilla g (opcional)<input type="number" inputMode="decimal" min={1} max={300} step="0.1" value={shaftWeight} onChange={(event) => setShaftWeight(event.target.value)} /></label>
        <label>Longitud in (opcional)<input type="number" inputMode="decimal" min={10} max={60} step="0.125" value={length} onChange={(event) => setLength(event.target.value)} /></label>
        <label>Lie ° (opcional)<input type="number" inputMode="decimal" min={30} max={90} step="0.1" value={lie} onChange={(event) => setLie(event.target.value)} /></label>
        <label className={styles.fullField}>Grip (opcional)<input value={grip} maxLength={180} onChange={(event) => setGrip(event.target.value)} /></label>
        <label className={styles.fullField}>Notas (opcional)<textarea value={notes} maxLength={1000} rows={3} onChange={(event) => setNotes(event.target.value)} /></label>
        {selectedCatalogClub && <p className={`${styles.subtle} ${styles.fullField}`}>
          Datos verificados el {new Date(selectedCatalogClub.verifiedAt).toLocaleDateString("es-MX")} · {selectedCatalogClub.sourceName}
          {selectedCatalogClub.sourceUrl && <> · <a href={selectedCatalogClub.sourceUrl} target="_blank" rel="noreferrer">Ver fuente</a></>}
          {selectedCatalogClub.license && <> · {selectedCatalogClub.license}</>}
        </p>}
        {message && <div className={styles.formMessage} role="alert">{message}</div>}
        <div className={styles.formActions}><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button type="submit" className="primary">Guardar bastón</button></div>
      </form>
    </section>
  </div>;
}

type BallEditorProps = {
  userId: string;
  catalog: readonly GolfBallCatalog[];
  existing?: PlayerBall | null;
  onCancel: () => void;
  onSave: (ball: PlayerBall) => void;
};

export function BallEditor({ userId, catalog, existing, onCancel, onSave }: BallEditorProps) {
  const dialogRef = useModalDialog(true, onCancel);
  const existingCatalog = existing?.catalogBallId ? catalog.find((ball) => ball.id === existing.catalogBallId) : null;
  const [manual, setManual] = useState(Boolean(existing && !existing.catalogBallId));
  const [brand, setBrand] = useState(existingCatalog?.brand || existing?.ballBrand || "");
  const [catalogBallId, setCatalogBallId] = useState(existing?.catalogBallId || existingCatalog?.id || "");
  const [customModel, setCustomModel] = useState(existing?.ballModel || "");
  const [generation, setGeneration] = useState(existing?.generation || existingCatalog?.generation || "");
  const [year, setYear] = useState(existing?.year ? String(existing.year) : existingCatalog?.year ? String(existingCatalog.year) : "");
  const [color, setColor] = useState(existing?.color || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [message, setMessage] = useState("");
  const activeCatalog = useMemo(() => catalog.filter((ball) => ball.active || ball.id === existingCatalog?.id), [catalog, existingCatalog?.id]);
  const pinnedBallIds = useMemo(() => catalogBallId ? [catalogBallId] : [], [catalogBallId]);
  const catalogSearch = useEquipmentCatalogSearch({ kind: "BALL", query: catalogQuery, fallback: activeCatalog, pinnedIds: pinnedBallIds });
  const selectableCatalog = useMemo(() => {
    const byId = new Map(catalogSearch.items.map((ball) => [ball.id, ball]));
    if (existingCatalog) byId.set(existingCatalog.id, existingCatalog);
    return [...byId.values()];
  }, [catalogSearch.items, existingCatalog]);
  const brands = useMemo(() => [...new Set(selectableCatalog.map((ball) => ball.brand))].sort((a, b) => a.localeCompare(b, "es-MX")), [selectableCatalog]);
  const selected = selectableCatalog.find((ball) => ball.id === catalogBallId)
    || catalog.find((ball) => ball.id === catalogBallId)
    || null;
  const effectiveBrand = brand || selected?.brand || "";
  const models = selectableCatalog.filter((ball) => sameBrand(ball.brand, effectiveBrand));
  const colorOptions = selected?.colors || [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const cleanBrand = (selected?.brand || effectiveBrand).trim();
    const cleanModel = manual ? customModel.trim() : selected?.model || (catalogBallId === existing?.catalogBallId ? existing.ballModel : "");
    if (!cleanBrand || !cleanModel || (!manual && !catalogBallId)) {
      setMessage(manual ? "Escribe marca y modelo de la bola." : "Selecciona una marca y un modelo del catálogo.");
      return;
    }
    const parsedYear = yearOrNull(year);
    if (parsedYear === undefined) { setMessage("Revisa el año o déjalo vacío."); return; }
    const now = new Date().toISOString();
    const savedGeneration = generation.trim() || selected?.generation || null;
    const savedYear = parsedYear === null ? selected?.year || null : parsedYear;
    const identityChanged = Boolean(existing?.isCurrent && (
      (existing.catalogBallId || catalogBallId
        ? existing.catalogBallId !== (manual ? null : catalogBallId || null)
        : !sameIdentityText(existing.ballBrand, cleanBrand) || !sameIdentityText(existing.ballModel, cleanModel))
      || !sameIdentityText(existing.generation, savedGeneration)
      || existing.year !== savedYear
    ));
    onSave({
      id: identityChanged ? uid("ball") : existing?.id || uid("ball"),
      userId,
      catalogBallId: manual ? null : catalogBallId || null,
      ballBrand: cleanBrand,
      ballModel: cleanModel,
      generation: savedGeneration,
      year: savedYear,
      color: color.trim() || null,
      notes: notes.trim() || null,
      isCurrent: true,
      startedUsingAt: identityChanged ? now : existing?.startedUsingAt || now,
      stoppedUsingAt: null,
      createdAt: identityChanged ? now : existing?.createdAt || now,
      updatedAt: now,
    });
  }

  return <div className={styles.editorBackdrop} role="presentation">
    <section ref={dialogRef} tabIndex={-1} className={styles.editorSheet} role="dialog" aria-modal="true" aria-labelledby="ball-editor-title">
      <div className={styles.sheetHandle} />
      <h2 id="ball-editor-title">{existing ? "Cambiar mi bola" : "Elegir mi bola"}</h2>
      <p>El catálogo conserva la generación y la fuente. El color es opcional.</p>
      <form className={styles.formGrid} onSubmit={submit} noValidate>
        {!manual ? <>
          <label className={styles.fullField}>Buscar bola
            <input type="search" value={catalogQuery} maxLength={120} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Ej. Pro V" autoComplete="off" />
            <span className={styles.subtle} role="status">{catalogSearch.status === "loading" ? "Buscando…" : catalogSearch.status === "error" ? "Sin conexión: puedes usar ‘Mi bola no aparece’." : `${selectableCatalog.length} resultado(s)`}</span>
          </label>
          <label>Marca<select value={effectiveBrand} onChange={(event) => { setBrand(event.target.value); setCatalogBallId(""); setGeneration(""); setYear(""); setColor(""); }}><option value="">Selecciona marca</option>{effectiveBrand && !brands.some((value) => sameBrand(value, effectiveBrand)) && <option value={effectiveBrand}>{effectiveBrand} · guardada</option>}{brands.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Modelo<select value={catalogBallId} disabled={!effectiveBrand} onChange={(event) => { const id = event.target.value; setCatalogBallId(id); const ball = selectableCatalog.find((item) => item.id === id) || catalog.find((item) => item.id === id); setGeneration(ball?.generation || ""); setYear(ball?.year ? String(ball.year) : ""); setColor(""); }}><option value="">Selecciona modelo</option>{catalogBallId && !selected && existing?.ballModel && <option value={catalogBallId}>{existing.ballModel} · guardada</option>}{models.map((ball) => <option key={ball.id} value={ball.id}>{ball.model}{ball.generation ? ` · ${ball.generation}` : ""}{ball.active ? "" : " · anterior"}</option>)}</select></label>
          {catalogSearch.hasMore && <button className={styles.manualToggle} type="button" onClick={() => void catalogSearch.loadMore()}>Cargar más modelos</button>}
        </> : <>
          <label>Marca<input value={brand} maxLength={100} onChange={(event) => setBrand(event.target.value)} /></label>
          <label>Modelo<input value={customModel} maxLength={140} onChange={(event) => setCustomModel(event.target.value)} /></label>
        </>}
        <button type="button" className={styles.manualToggle} onClick={() => { setManual((value) => !value); setCatalogBallId(""); setCustomModel(""); setGeneration(""); setYear(""); setColor(""); setMessage(""); }}>{manual ? "Volver al catálogo" : "Mi bola no aparece"}</button>
        <label>Generación (opcional)<input value={generation} maxLength={100} onChange={(event) => setGeneration(event.target.value)} /></label>
        <label>Año (opcional)<input type="number" inputMode="numeric" min={1900} max={2200} value={year} onChange={(event) => setYear(event.target.value)} /></label>
        {colorOptions.length ? <label className={styles.fullField}>Color (opcional)<select value={color} onChange={(event) => setColor(event.target.value)}><option value="">Sin indicar</option>{colorOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : <label className={styles.fullField}>Color (opcional)<input value={color} maxLength={80} onChange={(event) => setColor(event.target.value)} placeholder="Blanco, amarillo…" /></label>}
        <label className={styles.fullField}>Notas (opcional)<textarea value={notes} maxLength={1000} rows={3} onChange={(event) => setNotes(event.target.value)} placeholder="Por qué la elegiste, condiciones en que la juegas…" /></label>
        {selected && <p className={`${styles.subtle} ${styles.fullField}`}>Datos del modelo verificados el {new Date(selected.verifiedAt).toLocaleDateString("es-MX")} · {selected.sourceName}</p>}
        {message && <div className={styles.formMessage} role="alert">{message}</div>}
        <div className={styles.formActions}><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button type="submit" className="primary">Guardar como actual</button></div>
      </form>
    </section>
  </div>;
}

type ClubDistanceEditorProps = {
  userId: string;
  clubId: string;
  clubLabel: string;
  existing?: PlayerClubDistance | null;
  onCancel: () => void;
  onSave: (distance: PlayerClubDistance) => void;
};

export function ClubDistanceEditor({ userId, clubId, clubLabel, existing, onCancel, onSave }: ClubDistanceEditorProps) {
  const dialogRef = useModalDialog(true, onCancel);
  const [carry, setCarry] = useState(existing?.carryDistance === null || existing?.carryDistance === undefined ? "" : String(existing.carryDistance));
  const [total, setTotal] = useState(existing?.totalDistance === null || existing?.totalDistance === undefined ? "" : String(existing.totalDistance));
  const [unit, setUnit] = useState<"YD" | "M">(existing?.unit || "YD");
  const [message, setMessage] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const carryDistance = numberOrNull(carry, 0, 800);
    const totalDistance = numberOrNull(total, 0, 800);
    if (carryDistance === undefined || totalDistance === undefined) {
      setMessage("Usa una distancia entre 0 y 800, o deja el campo vacío.");
      return;
    }
    if (carryDistance === null && totalDistance === null) {
      setMessage("Captura carry, distancia total o ambas.");
      return;
    }
    if (carryDistance !== null && totalDistance !== null && totalDistance < carryDistance) {
      setMessage("La distancia total no puede ser menor que el carry.");
      return;
    }
    const now = new Date().toISOString();
    onSave({
      id: existing?.id || uid("club-distance"),
      userId,
      playerClubId: clubId,
      carryDistance,
      totalDistance,
      unit,
      source: "MANUAL",
      sampleCount: existing?.source === "MANUAL" ? existing.sampleCount || 1 : 1,
      confidence: existing?.source === "MANUAL" ? existing.confidence : null,
      updatedAt: now,
    });
  }

  return <div className={styles.editorBackdrop} role="presentation">
    <section ref={dialogRef} tabIndex={-1} className={styles.editorSheet} role="dialog" aria-modal="true" aria-labelledby="distance-editor-title">
      <div className={styles.sheetHandle} />
      <h2 id="distance-editor-title">Distancia de {clubLabel}</h2>
      <p>Captura lo que conoces. Es una referencia manual y podrás corregirla cuando quieras.</p>
      <form className={styles.formGrid} onSubmit={submit} noValidate>
        <label>Carry
          <input type="number" inputMode="decimal" min={0} max={800} step="0.1" value={carry} onChange={(event) => setCarry(event.target.value)} placeholder="Ej. 155" />
        </label>
        <label>Distancia total
          <input type="number" inputMode="decimal" min={0} max={800} step="0.1" value={total} onChange={(event) => setTotal(event.target.value)} placeholder="Opcional" />
        </label>
        <label className={styles.fullField}>Unidad
          <select value={unit} onChange={(event) => setUnit(event.target.value as "YD" | "M")}>
            <option value="YD">Yardas</option>
            <option value="M">Metros</option>
          </select>
        </label>
        {message && <div className={styles.formMessage} role="alert">{message}</div>}
        <div className={styles.formActions}><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button type="submit" className="primary">Guardar distancia</button></div>
      </form>
    </section>
  </div>;
}
