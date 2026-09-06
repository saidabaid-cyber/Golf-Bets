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
  ShaftFlex,
} from "../../lib/golf-equipment";
import styles from "./equipment.module.css";
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

const COMPOSITION = ["3", "4", "5", "6", "7", "8", "9", "PW", "GW", "AW", "SW", "LW"];

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
  const [manual, setManual] = useState(Boolean(existing && !existingCatalog));
  const [brand, setBrand] = useState(existingCatalog?.brand || existing?.customBrand || "");
  const [catalogClubId, setCatalogClubId] = useState(existingCatalog?.id || "");
  const [customModel, setCustomModel] = useState(existing?.customModel || "");
  const [generation, setGeneration] = useState(existing?.generation || existingCatalog?.generation || "");
  const [year, setYear] = useState(existing?.year ? String(existing.year) : existingCatalog?.year ? String(existingCatalog.year) : "");
  const [loft, setLoft] = useState(existing?.loft === null || existing?.loft === undefined ? "" : String(existing.loft));
  const [handedness, setHandedness] = useState<ClubHandedness>(existing?.handedness || "RH");
  const existingShaft = existing?.shaftId ? shafts.find((shaft) => shaft.id === existing.shaftId) : null;
  const [shaftManual, setShaftManual] = useState(Boolean(existing?.customShaft && !existingShaft));
  const [shaftId, setShaftId] = useState(existingShaft?.id || "");
  const [customShaft, setCustomShaft] = useState(existing?.customShaft || "");
  const [flex, setFlex] = useState<ShaftFlex | "">(existing?.flex || "");
  const [shaftWeight, setShaftWeight] = useState(existing?.shaftWeightGrams === null || existing?.shaftWeightGrams === undefined ? "" : String(existing.shaftWeightGrams));
  const [length, setLength] = useState(existing?.lengthInches === null || existing?.lengthInches === undefined ? "" : String(existing.lengthInches));
  const [lie, setLie] = useState(existing?.lieDegrees === null || existing?.lieDegrees === undefined ? "" : String(existing.lieDegrees));
  const [grip, setGrip] = useState(existing?.grip || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [composition, setComposition] = useState(existing?.setComposition || []);
  const [message, setMessage] = useState("");

  const selectableCatalog = useMemo(() => catalog.filter((club) => club.category === category && (club.active || club.id === existingCatalog?.id)), [catalog, category, existingCatalog?.id]);
  const brands = useMemo(() => [...new Set(selectableCatalog.map((club) => club.brand))].sort((a, b) => a.localeCompare(b, "es-MX")), [selectableCatalog]);
  const models = useMemo(() => selectableCatalog.filter((club) => sameBrand(club.brand, brand)), [selectableCatalog, brand]);
  const activeShafts = useMemo(() => shafts.filter((shaft) => shaft.active || shaft.id === existingShaft?.id), [existingShaft?.id, shafts]);
  const selectedCatalogClub = catalog.find((club) => club.id === catalogClubId) || null;
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
    if (value !== "IRON_SET") setComposition([]);
  }

  function chooseModel(id: string) {
    setCatalogClubId(id);
    const selected = catalog.find((club) => club.id === id);
    if (selected) {
      setGeneration(selected.generation || "");
      setYear(selected.year ? String(selected.year) : "");
      setLoft(selected.lofts.length === 1 ? String(selected.lofts[0]) : "");
      if (!selected.handedness.includes(handedness)) setHandedness(selected.handedness[0] || "RH");
    }
  }

  function changeLoft(value: string) {
    setLoft(value);
    const selected = catalog.find((club) => club.id === catalogClubId);
    const variant = selected?.variants.find((item) => Math.abs(item.loft - Number(value)) < 0.001);
    if (variant && !variant.handedness.includes(handedness)) setHandedness(variant.handedness[0] || "RH");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const selectedClub = catalog.find((club) => club.id === catalogClubId);
    const cleanBrand = brand.trim();
    const cleanModel = customModel.trim();
    if (manual ? (!cleanBrand || !cleanModel) : !selectedClub) {
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
    onSave({
      id: existing?.id || uid("club"),
      userId,
      category,
      catalogClubId: manual ? null : selectedClub?.id || null,
      customBrand: manual ? cleanBrand : null,
      customModel: manual ? cleanModel : null,
      generation: generation.trim() || selectedClub?.generation || null,
      year: parsedYear === null ? selectedClub?.year || null : parsedYear,
      loft: parsedLoft ?? null,
      handedness,
      shaftId: shaftManual ? null : shaftId || null,
      customShaft: shaftManual ? customShaft.trim() || null : null,
      flex: flex || null,
      shaftWeightGrams: parsedWeight ?? null,
      lengthInches: parsedLength ?? null,
      lieDegrees: parsedLie ?? null,
      grip: grip.trim() || null,
      notes: notes.trim() || null,
      setComposition: category === "IRON_SET" ? composition : [],
      isCurrent: existing?.isCurrent ?? true,
      createdAt: existing?.createdAt || now,
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
          <label>Marca
            <select value={brand} onChange={(event) => { setBrand(event.target.value); setCatalogClubId(""); setGeneration(""); setYear(""); setLoft(""); }}>
              <option value="">Selecciona marca</option>
              {brands.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>Modelo
            <select value={catalogClubId} disabled={!brand} onChange={(event) => chooseModel(event.target.value)}>
              <option value="">Selecciona modelo</option>
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
          <div className={styles.choiceGrid}>{COMPOSITION.map((club) => <label key={club}><input type="checkbox" checked={composition.includes(club)} onChange={(event) => setComposition((current) => event.target.checked ? [...current, club] : current.filter((item) => item !== club))} />{club}</label>)}</div>
        </fieldset>}

        {!shaftManual ? <label className={styles.fullField}>Shaft (opcional)
          <select value={shaftId} onChange={(event) => { setShaftId(event.target.value); const selected = shafts.find((shaft) => shaft.id === event.target.value); if (selected?.weight) setShaftWeight(String(selected.weight)); if (selected?.flex.length === 1) setFlex(selected.flex[0]); }}>
            <option value="">No lo sé / sin indicar</option>
            {activeShafts.map((shaft) => <option key={shaft.id} value={shaft.id}>{shaft.brand} {shaft.model}</option>)}
          </select>
        </label> : <label className={styles.fullField}>Shaft manual (opcional)<input value={customShaft} maxLength={180} onChange={(event) => setCustomShaft(event.target.value)} placeholder="Marca y modelo" /></label>}
        <button type="button" className={styles.manualToggle} onClick={() => { setShaftManual((value) => !value); setShaftId(""); }}>{shaftManual ? "Elegir shaft del catálogo" : "Mi shaft no aparece"}</button>

        <label>Flex (opcional)<select value={flex} onChange={(event) => setFlex(event.target.value as ShaftFlex | "")}><option value="">No lo sé</option>{Object.entries(FLEX_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Peso shaft g (opcional)<input type="number" inputMode="decimal" min={1} max={300} step="0.1" value={shaftWeight} onChange={(event) => setShaftWeight(event.target.value)} /></label>
        <label>Longitud in (opcional)<input type="number" inputMode="decimal" min={10} max={60} step="0.125" value={length} onChange={(event) => setLength(event.target.value)} /></label>
        <label>Lie ° (opcional)<input type="number" inputMode="decimal" min={30} max={90} step="0.1" value={lie} onChange={(event) => setLie(event.target.value)} /></label>
        <label className={styles.fullField}>Grip (opcional)<input value={grip} maxLength={180} onChange={(event) => setGrip(event.target.value)} /></label>
        <label className={styles.fullField}>Notas (opcional)<textarea value={notes} maxLength={1000} rows={3} onChange={(event) => setNotes(event.target.value)} /></label>
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
  const [manual, setManual] = useState(Boolean(existing && !existingCatalog));
  const [brand, setBrand] = useState(existingCatalog?.brand || existing?.ballBrand || "");
  const [catalogBallId, setCatalogBallId] = useState(existingCatalog?.id || "");
  const [customModel, setCustomModel] = useState(existing?.ballModel && !existingCatalog ? existing.ballModel : "");
  const [generation, setGeneration] = useState(existing?.generation || existingCatalog?.generation || "");
  const [year, setYear] = useState(existing?.year ? String(existing.year) : existingCatalog?.year ? String(existingCatalog.year) : "");
  const [color, setColor] = useState(existing?.color || "");
  const [message, setMessage] = useState("");
  const selectableCatalog = useMemo(() => catalog.filter((ball) => ball.active || ball.id === existingCatalog?.id), [catalog, existingCatalog?.id]);
  const brands = useMemo(() => [...new Set(selectableCatalog.map((ball) => ball.brand))].sort((a, b) => a.localeCompare(b, "es-MX")), [selectableCatalog]);
  const models = useMemo(() => selectableCatalog.filter((ball) => sameBrand(ball.brand, brand)), [selectableCatalog, brand]);
  const selected = catalog.find((ball) => ball.id === catalogBallId) || null;
  const colorOptions = selected?.colors || [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const cleanBrand = brand.trim();
    const cleanModel = manual ? customModel.trim() : selected?.model || "";
    if (!cleanBrand || !cleanModel || (!manual && !selected)) {
      setMessage(manual ? "Escribe marca y modelo de la bola." : "Selecciona una marca y un modelo del catálogo.");
      return;
    }
    const parsedYear = yearOrNull(year);
    if (parsedYear === undefined) { setMessage("Revisa el año o déjalo vacío."); return; }
    const now = new Date().toISOString();
    onSave({
      id: existing?.id || uid("ball"),
      userId,
      catalogBallId: manual ? null : selected?.id || null,
      ballBrand: cleanBrand,
      ballModel: cleanModel,
      generation: generation.trim() || selected?.generation || null,
      year: parsedYear === null ? selected?.year || null : parsedYear,
      color: color.trim() || null,
      isCurrent: true,
      createdAt: existing?.createdAt || now,
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
          <label>Marca<select value={brand} onChange={(event) => { setBrand(event.target.value); setCatalogBallId(""); setGeneration(""); setYear(""); setColor(""); }}><option value="">Selecciona marca</option>{brands.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Modelo<select value={catalogBallId} disabled={!brand} onChange={(event) => { const id = event.target.value; setCatalogBallId(id); const ball = catalog.find((item) => item.id === id); setGeneration(ball?.generation || ""); setYear(ball?.year ? String(ball.year) : ""); setColor(""); }}><option value="">Selecciona modelo</option>{models.map((ball) => <option key={ball.id} value={ball.id}>{ball.model}{ball.generation ? ` · ${ball.generation}` : ""}{ball.active ? "" : " · anterior"}</option>)}</select></label>
        </> : <>
          <label>Marca<input value={brand} maxLength={100} onChange={(event) => setBrand(event.target.value)} /></label>
          <label>Modelo<input value={customModel} maxLength={140} onChange={(event) => setCustomModel(event.target.value)} /></label>
        </>}
        <button type="button" className={styles.manualToggle} onClick={() => { setManual((value) => !value); setCatalogBallId(""); setCustomModel(""); setGeneration(""); setYear(""); setColor(""); setMessage(""); }}>{manual ? "Volver al catálogo" : "Mi bola no aparece"}</button>
        <label>Generación (opcional)<input value={generation} maxLength={100} onChange={(event) => setGeneration(event.target.value)} /></label>
        <label>Año (opcional)<input type="number" inputMode="numeric" min={1900} max={2200} value={year} onChange={(event) => setYear(event.target.value)} /></label>
        {colorOptions.length ? <label className={styles.fullField}>Color (opcional)<select value={color} onChange={(event) => setColor(event.target.value)}><option value="">Sin indicar</option>{colorOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : <label className={styles.fullField}>Color (opcional)<input value={color} maxLength={80} onChange={(event) => setColor(event.target.value)} placeholder="Blanco, amarillo…" /></label>}
        {selected && <p className={`${styles.subtle} ${styles.fullField}`}>Datos del modelo verificados el {new Date(selected.verifiedAt).toLocaleDateString("es-MX")} · {selected.sourceName}</p>}
        {message && <div className={styles.formMessage} role="alert">{message}</div>}
        <div className={styles.formActions}><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button type="submit" className="primary">Guardar como actual</button></div>
      </form>
    </section>
  </div>;
}
