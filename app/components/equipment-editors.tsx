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
  ShaftUsage,
} from "../../lib/golf-equipment";
import { resolveCatalogShaftSelection } from "../../lib/equipment-editor-selection";
import styles from "./equipment.module.css";
import { useEquipmentCatalogSearch } from "./use-equipment-catalog-search";
import { useModalDialog } from "./use-modal-dialog";
import { ModalCloseButton } from "./modal-shell";
import { AnchoredSearch, AnchoredSearchOption } from "./anchored-search";

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

const LEGACY_FLEX_TO_LABEL: Partial<Record<ShaftFlex, string>> = {
  LADIES: "L", SENIOR: "A", REGULAR: "R", STIFF: "S", X_STIFF: "X", TX: "TX",
};

function shaftUsageForCategory(category: ClubCategory): ShaftUsage {
  if (category === "DRIVER" || category === "MINI_DRIVER") return "WOOD";
  if (category === "FAIRWAY_WOOD") return "FAIRWAY";
  if (category === "HYBRID") return "HYBRID";
  if (category === "UTILITY_IRON") return "UTILITY";
  if (category === "WEDGE") return "WEDGE";
  if (category === "PUTTER") return "PUTTER";
  return "IRON";
}

function legacyFlexFromManufacturerLabel(value: string): ShaftFlex | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "L" || /\(L\)$/.test(normalized)) return "LADIES";
  if (["A", "SR", "R2"].includes(normalized) || /\(A\)$/.test(normalized)) return "SENIOR";
  if (["R", "R1"].includes(normalized) || /\(R\)$/.test(normalized)) return "REGULAR";
  if (normalized === "S" || /\(S\)$/.test(normalized)) return "STIFF";
  if (normalized === "X" || /\(X\)$/.test(normalized)) return "X_STIFF";
  if (normalized === "TX") return "TX";
  return "OTHER";
}

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
  const [shaftBrand, setShaftBrand] = useState(existingShaft?.brand || existing?.customShaftBrand || "");
  const [customShaftBrand, setCustomShaftBrand] = useState(existing?.customShaftBrand || "");
  const [customShaftModel, setCustomShaftModel] = useState(existing?.customShaftModel || existing?.customShaft || "");
  const [flex, setFlex] = useState<ShaftFlex | "">(existing?.flex || "");
  const [shaftFlexLabel, setShaftFlexLabel] = useState(existing?.shaftFlexLabel || (existing?.flex ? LEGACY_FLEX_TO_LABEL[existing.flex] || "" : ""));
  const [shaftWeight, setShaftWeight] = useState(existing?.shaftWeightGrams === null || existing?.shaftWeightGrams === undefined ? "" : String(existing.shaftWeightGrams));
  const [length, setLength] = useState(existing?.lengthInches === null || existing?.lengthInches === undefined ? "" : String(existing.lengthInches));
  const [lie, setLie] = useState(existing?.lieDegrees === null || existing?.lieDegrees === undefined ? "" : String(existing.lieDegrees));
  const [grip, setGrip] = useState(existing?.grip || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [composition, setComposition] = useState(existing?.setComposition || []);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [shaftQuery, setShaftQuery] = useState("");
  const [message, setMessage] = useState("");
  const [step, setStep] = useState<"category" | "brand" | "model" | "specs" | "shaft" | "finish">(existing ? "finish" : "category");

  const categoryCatalog = useMemo(() => catalog.filter((club) => club.category === category && (club.active || club.id === existingCatalog?.id)), [catalog, category, existingCatalog?.id]);
  const pinnedClubIds = useMemo(() => catalogClubId ? [catalogClubId] : [], [catalogClubId]);
  const clubSearchQuery = step === "model" && brand ? `${brand} ${catalogQuery}`.trim() : catalogQuery;
  const catalogSearch = useEquipmentCatalogSearch({ kind: "CLUB", query: clubSearchQuery, category, fallback: categoryCatalog, pinnedIds: pinnedClubIds });
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
  const shaftUsage = shaftUsageForCategory(category);
  const shaftFallback = useMemo(() => shafts.filter((shaft) => (shaft.active || shaft.id === existingShaft?.id)
    && (!shaft.usage || shaft.usage === shaftUsage)), [existingShaft?.id, shaftUsage, shafts]);
  const pinnedShaftIds = useMemo(() => shaftId ? [shaftId] : [], [shaftId]);
  const shaftSearchQuery = shaftBrand ? `${shaftBrand} ${shaftQuery}`.trim() : shaftQuery;
  const shaftSearch = useEquipmentCatalogSearch({ kind: "SHAFT", query: shaftSearchQuery, shaftUsage, fallback: shaftFallback, pinnedIds: pinnedShaftIds });
  const activeShafts = useMemo(() => {
    const byId = new Map(shaftSearch.items.map((shaft) => [shaft.id, shaft]));
    if (existingShaft) byId.set(existingShaft.id, existingShaft);
    return [...byId.values()];
  }, [existingShaft, shaftSearch.items]);
  const selectedShaft = resolveCatalogShaftSelection(shaftId, activeShafts, existingShaft);
  const shaftBrands = useMemo(() => [...new Set(activeShafts.map((shaft) => shaft.brand))].sort((a, b) => a.localeCompare(b, "es-MX")), [activeShafts]);
  const shaftModels = activeShafts.filter((shaft) => sameBrand(shaft.brand, shaftBrand));
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
    setShaftId("");
    setShaftBrand("");
    setShaftQuery("");
    setShaftWeight("");
    setShaftFlexLabel("");
    setFlex("");
    if (value !== "IRON_SET") setComposition([]);
    setManual(false);
    setStep("brand");
  }

  function chooseModel(id: string) {
    setCatalogClubId(id);
    const selected = selectableCatalog.find((club) => club.id === id) || catalog.find((club) => club.id === id);
    if (selected) {
      setGeneration(selected.generation || "");
      setYear(selected.year ? String(selected.year) : "");
      setLoft(selected.lofts.length === 1 ? String(selected.lofts[0]) : "");
      if (!selected.handedness.includes(handedness)) setHandedness(selected.handedness[0] || "RH");
      setBrand(selected.brand);
      setCustomModel(selected.model);
      setStep("specs");
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
      flex: shaftFlexLabel ? legacyFlexFromManufacturerLabel(shaftFlexLabel) : flex || null,
      shaftFlexLabel: shaftFlexLabel.trim() || null,
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
      <ModalCloseButton onClose={onCancel} />
      <div className={styles.sheetHandle} />
      <h2 id="club-editor-title">{existing ? "Editar bastón" : "Agregar a mi bolsa"}</h2>
      <p>Marca + modelo es suficiente. Las especificaciones son opcionales.</p>
      <div className={styles.flowProgress} aria-label="Progreso de selección">
        {(["category", "brand", "model", "specs", "shaft", "finish"] as const).map((item, index) => <span key={item} data-active={item === step} data-complete={index < ["category", "brand", "model", "specs", "shaft", "finish"].indexOf(step)} />)}
      </div>
      <form className={styles.formGrid} onSubmit={submit} noValidate>
        {step === "category" && <div className={styles.flowScreen}>
          <h3>Selecciona categoría</h3><p>Primero el tipo de bastón; después marca, modelo y configuración.</p>
          <div className={styles.catalogChoiceGrid}>{Object.entries(CLUB_CATEGORY_LABELS).map(([value, label]) => <button type="button" key={value} onClick={() => chooseCategory(value as ClubCategory)}><span>{CLUB_CATEGORY_ICONS[value as ClubCategory]}</span><b>{label}</b></button>)}</div>
        </div>}

        {step === "brand" && <div className={styles.flowScreen}>
          <button type="button" className={styles.flowBack} onClick={() => setStep("category")}>← Categorías</button>
          <h3>Select Brand</h3><p>{CLUB_CATEGORY_LABELS[category]} · escribe para filtrar el catálogo completo, incluidos modelos anteriores.</p>
          <AnchoredSearch label="Buscar bastón por marca" value={catalogQuery} onChange={setCatalogQuery} placeholder="Ej. TaylorMade" expanded={brands.length > 0} status={catalogSearch.status === "loading" ? "Buscando…" : catalogSearch.status === "error" ? "Sin conexión; usa la captura manual." : `${brands.length} marcas en estos resultados`}>
            {brands.map((value) => <AnchoredSearchOption key={value} onSelect={() => { setBrand(value); setCatalogQuery(""); setStep("model"); }}><b>{value}</b><small>{selectableCatalog.filter((club) => sameBrand(club.brand, value)).length} modelos en esta página</small></AnchoredSearchOption>)}
          </AnchoredSearch>
          {catalogSearch.hasMore && <button className="secondary" type="button" onClick={() => void catalogSearch.loadMore()}>Más marcas</button>}
          <button className={styles.manualToggle} type="button" onClick={() => { setManual(true); setBrand(""); setCustomModel(""); setStep("specs"); }}>Mi bastón no aparece</button>
        </div>}

        {step === "model" && <div className={styles.flowScreen}>
          <button type="button" className={styles.flowBack} onClick={() => { setBrand(""); setCatalogQuery(""); setStep("brand"); }}>← Marcas</button>
          <h3>Select Model</h3><p>{effectiveBrand} · actuales y anteriores se conservan en Mi Bolsa.</p>
          <AnchoredSearch label="Buscar modelo" value={catalogQuery} onChange={setCatalogQuery} placeholder="Ej. Stealth 2 Plus" expanded={models.length > 0} status={catalogSearch.status === "loading" ? "Buscando…" : catalogSearch.status === "error" ? "No se pudo consultar el catálogo." : `${models.length} modelos encontrados`}>
            {models.map((club) => <AnchoredSearchOption key={club.id} onSelect={() => chooseModel(club.id)}><b>{club.model}</b><small>{[club.generation, club.year, club.active ? "Actual" : "Modelo anterior", club.subCategory].filter(Boolean).join(" · ")}</small></AnchoredSearchOption>)}
          </AnchoredSearch>
          {catalogSearch.hasMore && <button className="secondary" type="button" onClick={() => void catalogSearch.loadMore()}>Cargar más modelos</button>}
        </div>}

        {step === "specs" && <div className={styles.flowScreen}>
          <button type="button" className={styles.flowBack} onClick={() => { if (manual) setManual(false); setStep(manual ? "brand" : "model"); }}>← {manual ? "Catálogo" : "Modelos"}</button>
          <h3>Tipo y especificación</h3>
          <div className={styles.productPreview}><span>{CLUB_CATEGORY_ICONS[category]}</span><div><b>{manual ? [brand, customModel].filter(Boolean).join(" ") || "Bastón manual" : `${selectedCatalogClub?.brand || effectiveBrand} ${selectedCatalogClub?.model || ""}`}</b><small>{selectedCatalogClub ? [selectedCatalogClub.generation, selectedCatalogClub.year, selectedCatalogClub.active ? "Actual" : "Modelo anterior"].filter(Boolean).join(" · ") : "La imagen estará disponible cuando exista una fuente autorizada."}</small></div></div>
          {manual && <div className={styles.inlineFields}><label>Marca<input value={brand} maxLength={100} onChange={(event) => setBrand(event.target.value)} placeholder="Marca" /></label><label>Modelo<input value={customModel} maxLength={140} onChange={(event) => setCustomModel(event.target.value)} placeholder="Modelo" /></label></div>}
          <div className={styles.inlineFields}><label>Generación (opcional)<input value={generation} maxLength={100} onChange={(event) => setGeneration(event.target.value)} /></label><label>Año (opcional)<input type="number" inputMode="numeric" min={1900} max={2200} value={year} onChange={(event) => setYear(event.target.value)} /></label><label>Loft ° (opcional)<input type="number" inputMode="decimal" min={0} max={90} step="0.1" list="verified-club-lofts" value={loft} onChange={(event) => changeLoft(event.target.value)} /><datalist id="verified-club-lofts">{selectedCatalogClub?.lofts.map((value) => <option key={value} value={value} />)}</datalist></label><label>Mano<select value={handedness} onChange={(event) => setHandedness(event.target.value as ClubHandedness)}>{availableHands.includes("RH") && <option value="RH">Derecha</option>}{availableHands.includes("LH") && <option value="LH">Izquierda</option>}</select></label></div>
          {category === "IRON_SET" && <fieldset className={styles.choiceFieldset}><legend>Composición del set</legend><div className={styles.choiceGrid}>{IRON_SET_PACKAGES.map((set) => <button type="button" key={set.label} onClick={() => setComposition([...set.clubs])}>{set.label}</button>)}</div><p className={styles.subtle}>Personalizar set</p><div className={styles.choiceGrid}>{CUSTOM_IRON_COMPOSITION.map((club) => <label key={club}><input type="checkbox" checked={composition.includes(club)} onChange={(event) => setComposition((current) => event.target.checked ? [...current, club] : current.filter((item) => item !== club))} />{club}</label>)}</div></fieldset>}
          <div className={styles.flowActions}><button type="button" className="secondary" onClick={() => { setShaftId(""); setShaftBrand(""); setStep("finish"); }}>Sin varilla / No sé</button><button type="button" className="primary" onClick={() => setStep("shaft")}>Elegir varilla</button></div>
        </div>}

        {step === "shaft" && <div className={styles.flowScreen}>
          <button type="button" className={styles.flowBack} onClick={() => setStep("specs")}>← Especificaciones</button>
          <h3>Selecciona varilla</h3><p>Busca por marca, modelo, peso o flex. Las varillas anteriores siguen disponibles.</p>
          {!shaftManual && !shaftBrand && <AnchoredSearch label="Buscar varilla por marca" value={shaftQuery} onChange={setShaftQuery} placeholder="Ej. Fujikura" expanded={shaftBrands.length > 0} status={shaftSearch.status === "loading" ? "Buscando…" : `${shaftBrands.length} marcas`}>
            {shaftBrands.map((value) => <AnchoredSearchOption key={value} onSelect={() => { setShaftBrand(value); setShaftQuery(""); }}><b>{value}</b><small>{activeShafts.filter((shaft) => sameBrand(shaft.brand, value)).length} familias en esta página</small></AnchoredSearchOption>)}
          </AnchoredSearch>}
          {!shaftManual && shaftBrand && <><button type="button" className={styles.selectedBrand} onClick={() => { setShaftBrand(""); setShaftQuery(""); }}>Marca: {shaftBrand} · cambiar</button><AnchoredSearch label="Buscar modelo / peso / flex" value={shaftQuery} onChange={setShaftQuery} placeholder="Ej. Ventus Blue 6S" expanded={shaftModels.length > 0} status={shaftSearch.status === "loading" ? "Buscando…" : `${shaftModels.length} varillas encontradas`}>
            {shaftModels.map((shaft) => <AnchoredSearchOption key={shaft.id} onSelect={() => { setShaftId(shaft.id); setShaftWeight(shaft.weightOptions.length === 1 ? String(shaft.weightOptions[0]) : ""); const exactFlex = shaft.flexOptions.length === 1 ? shaft.flexOptions[0] : ""; setShaftFlexLabel(exactFlex); setFlex(exactFlex ? legacyFlexFromManufacturerLabel(exactFlex) || "" : ""); setStep("finish"); }}><b>{shaft.model}{shaft.generation ? ` · ${shaft.generation}` : ""}</b><small>{[shaft.active ? "Actual" : "Modelo anterior", shaft.oemStockOrAftermarket === "OEM_STOCK" ? "OEM stock" : "Aftermarket", shaft.weightOptions.length ? `${shaft.weightOptions.join("/")} g` : null, shaft.flexOptions.join("/")].filter(Boolean).join(" · ")}</small></AnchoredSearchOption>)}
          </AnchoredSearch>{shaftSearch.hasMore && <button className="secondary" type="button" onClick={() => void shaftSearch.loadMore()}>Cargar más varillas</button>}</>}
          {shaftManual && <div className={styles.inlineFields}><label>Marca<input value={customShaftBrand} maxLength={100} onChange={(event) => setCustomShaftBrand(event.target.value)} /></label><label>Modelo<input value={customShaftModel} maxLength={140} onChange={(event) => setCustomShaftModel(event.target.value)} /></label><button type="button" className="primary" onClick={() => setStep("finish")}>Continuar</button></div>}
          <button type="button" className={styles.manualToggle} onClick={() => { setShaftManual((value) => !value); setShaftId(""); setShaftBrand(""); setShaftQuery(""); }}>{shaftManual ? "Volver al catálogo" : "Mi varilla no aparece"}</button>
        </div>}

        {step === "finish" && <div className={styles.flowScreen}>
          <button type="button" className={styles.flowBack} onClick={() => setStep("shaft")}>← Varilla</button>
          <h3>Revisa y agrega</h3>
          <div className={styles.productPreview}><span>{CLUB_CATEGORY_ICONS[category]}</span><div><b>{[effectiveBrand, selectedCatalogClub?.model || customModel].filter(Boolean).join(" ")}</b><small>{selectedShaft ? `${selectedShaft.brand} ${selectedShaft.model}` : shaftManual ? [customShaftBrand, customShaftModel].filter(Boolean).join(" ") || "Varilla manual" : "Sin varilla indicada"}</small></div></div>
          <div className={styles.inlineFields}>
            {selectedShaft?.flexOptions.length ? <label>Flex<select value={shaftFlexLabel} onChange={(event) => { setShaftFlexLabel(event.target.value); setFlex(legacyFlexFromManufacturerLabel(event.target.value) || ""); }}><option value="">No lo sé</option>{selectedShaft.flexOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : <label>Flex (opcional)<input value={shaftFlexLabel} maxLength={40} onChange={(event) => { setShaftFlexLabel(event.target.value); setFlex(legacyFlexFromManufacturerLabel(event.target.value) || ""); }} placeholder="5.5, F4, M4, S…" /></label>}
            {selectedShaft?.weightOptions.length ? <label>Peso de varilla<select value={shaftWeight} onChange={(event) => setShaftWeight(event.target.value)}><option value="">No lo sé</option>{selectedShaft.weightOptions.map((value) => <option key={value} value={value}>{value} g</option>)}</select></label> : <label>Peso de varilla g (opcional)<input type="number" inputMode="decimal" min={1} max={300} step="0.1" value={shaftWeight} onChange={(event) => setShaftWeight(event.target.value)} /></label>}
            <label>Longitud in (opcional)<input type="number" inputMode="decimal" min={10} max={60} step="0.125" value={length} onChange={(event) => setLength(event.target.value)} /></label><label>Lie ° (opcional)<input type="number" inputMode="decimal" min={30} max={90} step="0.1" value={lie} onChange={(event) => setLie(event.target.value)} /></label><label>Grip (opcional)<input value={grip} maxLength={180} onChange={(event) => setGrip(event.target.value)} /></label><label>Notas (opcional)<textarea value={notes} maxLength={1000} rows={3} onChange={(event) => setNotes(event.target.value)} /></label>
          </div>
          {selectedShaft && <p className={styles.subtle}>{[selectedShaft.launch ? `Launch ${selectedShaft.launch}` : null, selectedShaft.spin ? `Spin ${selectedShaft.spin}` : null, selectedShaft.sourceName].filter(Boolean).join(" · ")}</p>}
          {message && <div className={styles.formMessage} role="alert">{message}</div>}
          <div className={styles.formActions}><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button type="submit" className="primary">Guardar bastón</button></div>
        </div>}
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
  const [step, setStep] = useState<"brand" | "model" | "details">(existing ? "details" : "brand");
  const activeCatalog = useMemo(() => catalog.filter((ball) => ball.active || ball.id === existingCatalog?.id), [catalog, existingCatalog?.id]);
  const pinnedBallIds = useMemo(() => catalogBallId ? [catalogBallId] : [], [catalogBallId]);
  const ballSearchQuery = step === "model" && brand ? `${brand} ${catalogQuery}`.trim() : catalogQuery;
  const catalogSearch = useEquipmentCatalogSearch({ kind: "BALL", query: ballSearchQuery, fallback: activeCatalog, pinnedIds: pinnedBallIds });
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
      <ModalCloseButton onClose={onCancel} />
      <div className={styles.sheetHandle} />
      <h2 id="ball-editor-title">{existing ? "Cambiar mi bola" : "Elegir mi bola"}</h2>
      <p>El catálogo conserva la generación y la fuente. El color es opcional.</p>
      <div className={styles.flowProgress}>{(["brand", "model", "details"] as const).map((item, index) => <span key={item} data-active={item === step} data-complete={index < ["brand", "model", "details"].indexOf(step)} />)}</div>
      <form className={styles.formGrid} onSubmit={submit} noValidate>
        {step === "brand" && <div className={styles.flowScreen}><h3>Selecciona marca</h3><p>Busca dentro de las generaciones actuales y anteriores.</p><AnchoredSearch label="Buscar bola por marca" value={catalogQuery} onChange={setCatalogQuery} placeholder="Ej. Titleist" expanded={brands.length > 0} status={catalogSearch.status === "loading" ? "Buscando…" : `${brands.length} marcas`}>
          {brands.map((value) => <AnchoredSearchOption key={value} onSelect={() => { setBrand(value); setCatalogQuery(""); setStep("model"); }}><b>{value}</b><small>{selectableCatalog.filter((ball) => sameBrand(ball.brand, value)).length} modelos en esta página</small></AnchoredSearchOption>)}
        </AnchoredSearch>{catalogSearch.hasMore && <button type="button" className="secondary" onClick={() => void catalogSearch.loadMore()}>Más marcas</button>}<button type="button" className={styles.manualToggle} onClick={() => { setManual(true); setBrand(""); setCustomModel(""); setStep("details"); }}>Mi bola no aparece</button></div>}
        {step === "model" && <div className={styles.flowScreen}><button type="button" className={styles.flowBack} onClick={() => { setBrand(""); setCatalogQuery(""); setStep("brand"); }}>← Marcas</button><h3>Selecciona modelo</h3><p>{effectiveBrand} · la generación elegida queda guardada.</p><AnchoredSearch label="Buscar modelo" value={catalogQuery} onChange={setCatalogQuery} placeholder="Ej. Pro V1 2025" expanded={models.length > 0} status={catalogSearch.status === "loading" ? "Buscando…" : `${models.length} modelos encontrados`}>
          {models.map((ball) => <AnchoredSearchOption key={ball.id} onSelect={() => { setCatalogBallId(ball.id); setBrand(ball.brand); setCustomModel(ball.model); setGeneration(ball.generation || ""); setYear(ball.year ? String(ball.year) : ""); setColor(""); setStep("details"); }}><b>{ball.model}</b><small>{[ball.generation, ball.year, ball.active ? "Actual" : "Modelo anterior", ball.fitEligible ? "Apta para Ball Fit" : "Sólo Mi Bola"].filter(Boolean).join(" · ")}</small></AnchoredSearchOption>)}
        </AnchoredSearch>{catalogSearch.hasMore && <button type="button" className="secondary" onClick={() => void catalogSearch.loadMore()}>Cargar más modelos</button>}</div>}
        {step === "details" && <div className={styles.flowScreen}><button type="button" className={styles.flowBack} onClick={() => { if (manual) setManual(false); setStep(manual ? "brand" : "model"); }}>← {manual ? "Catálogo" : "Modelos"}</button><h3>Variante final</h3><div className={`${styles.productPreview} ${styles.ballProductPreview}`}><span>●</span><div><b>{[selected?.brand || brand, selected?.model || customModel].filter(Boolean).join(" ") || "Bola manual"}</b><small>{[generation || selected?.generation, year || selected?.year, selected && (selected.active ? "Actual" : "Modelo anterior")].filter(Boolean).join(" · ") || "Completa sólo lo que conozcas"}</small></div></div>
          {manual && <div className={styles.inlineFields}><label>Marca<input value={brand} maxLength={100} onChange={(event) => setBrand(event.target.value)} /></label><label>Modelo<input value={customModel} maxLength={140} onChange={(event) => setCustomModel(event.target.value)} /></label></div>}
          <div className={styles.inlineFields}><label>Generación (opcional)<input value={generation} maxLength={100} onChange={(event) => setGeneration(event.target.value)} /></label><label>Año (opcional)<input type="number" inputMode="numeric" min={1900} max={2200} value={year} onChange={(event) => setYear(event.target.value)} /></label>{colorOptions.length ? <label>Color (opcional)<select value={color} onChange={(event) => setColor(event.target.value)}><option value="">Sin indicar</option>{colorOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : <label>Color (opcional)<input value={color} maxLength={80} onChange={(event) => setColor(event.target.value)} /></label>}<label>Notas (opcional)<textarea value={notes} maxLength={1000} rows={3} onChange={(event) => setNotes(event.target.value)} /></label></div>
          {selected && <div className={styles.ballFacts}>{[["Vuelo", selected.flight], ["Driver spin", selected.driverSpin], ["Greenside", selected.shortGameSpin], ["Sensación", selected.feel], ["Construcción", selected.construction], ["Compresión", selected.compression]].map(([label, value]) => <span key={label}><small>{label}</small><b>{value ?? "Sin dato verificado"}</b></span>)}</div>}
          {selected && <p className={styles.subtle}>Datos verificados · {selected.sourceName} · {new Date(selected.verifiedAt).toLocaleDateString("es-MX")}</p>}
          {message && <div className={styles.formMessage} role="alert">{message}</div>}<div className={styles.formActions}><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button type="submit" className="primary">Guardar como actual</button></div>
        </div>}
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
      <ModalCloseButton onClose={onCancel} />
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
