"use client";

import { useId, useMemo, useRef, useState } from "react";
import { DEFAULT_MANUAL_AVATAR, MANUAL_AVATAR_OPTIONS, MANUAL_AVATAR_SWATCHES, manualAvatarUrl, parseManualAvatarUrl, randomManualAvatarConfig, type ManualAvatarConfig } from "../../lib/manual-avatar";
import styles from "./avatar-creation-panel.module.css";

type Field = keyof typeof MANUAL_AVATAR_OPTIONS;
type CategoryId = "face" | "skin" | "hair" | "brows" | "eyes" | "nose" | "mouth" | "beard" | "glasses" | "hat" | "clothes" | "accessories" | "background";
const CATEGORIES: ReadonlyArray<{ id: CategoryId; label: string; fields: readonly Field[] }> = [
  { id: "face", label: "ROSTRO", fields: ["rostro", "mandibula", "mejillas", "orejas"] },
  { id: "skin", label: "PIEL", fields: ["piel"] },
  { id: "hair", label: "PELO", fields: ["pelo", "colorPelo"] },
  { id: "brows", label: "CEJAS", fields: ["cejas"] },
  { id: "eyes", label: "OJOS", fields: ["ojos", "colorOjos"] },
  { id: "nose", label: "NARIZ", fields: ["nariz"] },
  { id: "mouth", label: "BOCA", fields: ["boca"] },
  { id: "beard", label: "BARBA / BIGOTE", fields: ["barba", "colorBarba"] },
  { id: "glasses", label: "LENTES", fields: ["lentes"] },
  { id: "hat", label: "GORRA / VISERA", fields: ["sombrero"] },
  { id: "clothes", label: "ROPA", fields: ["ropa", "colorRopa"] },
  { id: "accessories", label: "ACCESORIOS", fields: ["accesorio"] },
  { id: "background", label: "FONDO", fields: ["fondo"] },
];

const FIELD_LABELS: Record<Field, string> = {
  rostro: "Forma de rostro", mandibula: "Mandíbula", mejillas: "Mejillas", orejas: "Orejas", piel: "Tono de piel",
  pelo: "Peinado", colorPelo: "Color de pelo", cejas: "Cejas", ojos: "Forma de ojos", colorOjos: "Color de ojos",
  nariz: "Nariz", boca: "Boca", barba: "Barba o bigote", colorBarba: "Color de barba", lentes: "Lentes",
  sombrero: "Gorra o sombrero", ropa: "Prenda", colorRopa: "Color de ropa", accesorio: "Accesorio", fondo: "Fondo",
};
const LABELS: Record<string, string> = {
  ovalado: "Ovalado", redondo: "Redondo", cuadrado: "Cuadrado", corazon: "Corazón", alargado: "Alargado", diamante: "Diamante",
  suave: "Suave", definida: "Definida", angular: "Angular", suaves: "Suaves", marcadas: "Marcadas", llenas: "Llenas",
  pequenas: "Pequeñas", medias: "Medias", grandes: "Grandes", porcelana: "Porcelana", clara: "Clara", mediaClara: "Media clara", media: "Media", morena: "Morena", oscura: "Oscura", profunda: "Profunda",
  sinPelo: "Sin pelo", calvicie: "Calvicie", rapado: "Rapado", muyCorto: "Muy corto", corto: "Corto", lacio: "Lacio", medio: "Medio", peinado: "Peinado", ondulado: "Ondulado", rizado: "Rizado", afro: "Afro", largo: "Largo", coleta: "Coleta", entradas: "Entradas",
  negro: "Negro", cafeOscuro: "Café oscuro", cafe: "Café", castano: "Castaño", rubio: "Rubio", pelirrojo: "Pelirrojo", gris: "Gris", blanco: "Blanco",
  finas: "Finas", marcadasCejas: "Marcadas", arqueadas: "Arqueadas", rectas: "Rectas", redondos: "Redondos", almendrados: "Almendrados", profundos: "Profundos", sonrientes: "Sonrientes", serenos: "Serenos", avellana: "Avellana", verde: "Verde", azul: "Azul",
  pequena: "Pequeña", recta: "Recta", ancha: "Ancha", respingada: "Respingada", "aguileña": "Aguileña", sonrisa: "Sonrisa", neutra: "Neutra", amplia: "Amplia", seria: "Seria",
  ninguna: "Sin barba", sombra: "Sombra", corta: "Corta", completa: "Completa", candado: "Candado", bigote: "Bigote", barbaBigote: "Barba + bigote",
  ninguno: "Ninguno", rectangulares: "Rectangulares", aviador: "Aviador", sol: "Lentes de sol", gorra: "Gorra", gorraGolf: "Gorra de golf", visera: "Visera", bucket: "Bucket hat",
  polo: "Polo", playera: "Playera", chamarra: "Chamarra", quarterZip: "Quarter zip", backyard: "Backyard", navy: "Navy", marfil: "Marfil", arcilla: "Arcilla", salvia: "Salvia",
  arete: "Un arete", aretes: "Aretes", "pañuelo": "Pañuelo", neutro: "Neutro claro", neutroOscuro: "Neutro oscuro", green: "Green", campo: "Campo desenfocado", fondoBackyard: "Backyard sólido", premium: "Premium minimalista",
};

function optionLabel(field: Field, option: string) {
  if (option === "marcadas" && field === "cejas") return "Marcadas";
  if (option === "backyard" && field === "fondo") return "Backyard sólido";
  if (option === "media" && field === "barba") return "Media";
  return LABELS[option] || option;
}
function swatchFor(field: Field, option: string): string | null {
  if (field in MANUAL_AVATAR_SWATCHES) return (MANUAL_AVATAR_SWATCHES[field as keyof typeof MANUAL_AVATAR_SWATCHES] as Record<string, string>)[option] || null;
  return null;
}
const VISUAL_FIELDS = new Set<Field>(["rostro", "mandibula", "mejillas", "orejas", "pelo", "cejas", "ojos", "nariz", "boca", "barba", "lentes", "sombrero", "ropa", "accesorio"]);

export function AvatarCreationPanel({ initialValue, onUse, onCancel, onBusyChange, staged = false }: {
  initialValue?: string; onUse: (avatarUrl: string) => void | Promise<void>; onCancel: () => void;
  onBusyChange?: (busy: boolean) => void; staged?: boolean;
}) {
  const id = useId();
  const [config, setConfig] = useState<ManualAvatarConfig>(() => parseManualAvatarUrl(initialValue) || DEFAULT_MANUAL_AVATAR);
  const [categoryId, setCategoryId] = useState<CategoryId>("face");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const selected = CATEGORIES.find((item) => item.id === categoryId) || CATEGORIES[0];
  const preview = useMemo(() => manualAvatarUrl(config), [config]);
  const optionPreviews = useMemo(() => {
    const previews = new Map<string, string>();
    for (const field of selected.fields) {
      if (!VISUAL_FIELDS.has(field)) continue;
      for (const option of MANUAL_AVATAR_OPTIONS[field]) previews.set(`${field}:${option}`, manualAvatarUrl({ ...config, [field]: option } as ManualAvatarConfig));
    }
    return previews;
  }, [config, selected]);

  function update(key: Field, value: string) {
    setConfig((current) => ({ ...current, [key]: value }) as ManualAvatarConfig);
    setNotice(""); setError("");
  }
  async function save() {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); onBusyChange?.(true); setError("");
    try { await onUse(preview); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el avatar. Reintenta."); }
    finally { savingRef.current = false; setSaving(false); onBusyChange?.(false); }
  }

  return <section className={styles.panel} aria-labelledby={`${id}-title`}>
    <header><div><span>CREADOR DE PERSONAJE</span><h3 id={`${id}-title`}>Crea tu avatar</h3><p>Construye un retrato adulto, deportivo y hecho para tu perfil.</p></div><button type="button" aria-label="Cerrar editor de avatar" disabled={saving} onClick={onCancel}>×</button></header>
    <div className={styles.previewShell}><div className={styles.previewGlow} aria-hidden="true" /><div className={styles.preview}><img src={preview} alt="Vista previa instantánea de tu avatar" /></div><div className={styles.previewLabel}><span aria-hidden="true">●</span> VISTA PREVIA EN VIVO</div></div>
    <small className={styles.categoryHint}>DESLIZA PARA ELEGIR UNA CATEGORÍA →</small>
    <div className={styles.categories} role="tablist" aria-label="Partes del avatar">{CATEGORIES.map((category) => <button key={category.id} type="button" role="tab" aria-selected={categoryId === category.id} data-active={categoryId === category.id} disabled={saving} onClick={() => setCategoryId(category.id)}>{category.label}</button>)}</div>
    <div className={styles.options} aria-label={selected.label}>{selected.fields.map((field) => <fieldset key={field}><legend>{FIELD_LABELS[field]}</legend><div>{MANUAL_AVATAR_OPTIONS[field].map((option) => {
      const swatch = swatchFor(field, option);
      const optionPreview = optionPreviews.get(`${field}:${option}`) || "";
      return <button className={styles.optionButton} key={option} type="button" aria-pressed={config[field] === option} data-active={config[field] === option} disabled={saving} onClick={() => update(field, option)}>{swatch ? <span className={styles.swatch} style={{ backgroundColor: swatch }} aria-hidden="true" /> : optionPreview ? <span className={styles.optionPreview} aria-hidden="true"><img src={optionPreview} alt="" /></span> : null}<span>{optionLabel(field, option)}</span></button>;
    })}</div></fieldset>)}</div>
    <div className={styles.utilityActions}><button type="button" className="secondary" disabled={saving} onClick={() => { setConfig(randomManualAvatarConfig(Math.random, config)); setNotice("Nueva combinación lista. Conservamos tu tono de piel; puedes seguir editando."); setError(""); }}>ALEATORIO</button><button type="button" className="secondary" disabled={saving} onClick={() => { setConfig(DEFAULT_MANUAL_AVATAR); setNotice("Avatar reiniciado."); setError(""); }}>REINICIAR</button></div>
    <div className={styles.actions}><button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? "PREPARANDO…" : "USAR ESTE AVATAR"}</button></div>
    <button type="button" className="textButton" disabled={saving} onClick={onCancel}>VOLVER</button>
    {notice && <small role="status">{notice}</small>}{error && <small className={styles.error} role="alert">{error}</small>}
    <small>{staged ? "Tu avatar quedará listo y se guardará al completar tu perfil." : "Tu selección queda lista aquí y se guarda al confirmar el perfil."}</small>
  </section>;
}
