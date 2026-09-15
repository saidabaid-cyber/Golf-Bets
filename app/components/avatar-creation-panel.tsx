"use client";

import { useId, useRef, useState } from "react";
import { DEFAULT_MANUAL_AVATAR, MANUAL_AVATAR_OPTIONS, MANUAL_AVATAR_SWATCHES, manualAvatarUrl, parseManualAvatarUrl, randomManualAvatarConfig, type ManualAvatarConfig } from "../../lib/manual-avatar";
import styles from "./avatar-creation-panel.module.css";

const LABELS: { [K in keyof typeof MANUAL_AVATAR_OPTIONS]: Record<(typeof MANUAL_AVATAR_OPTIONS)[K][number], string> } = {
  persona: { golfista: "Golfista", clasico: "Clásico", deportivo: "Deportivo" },
  rostro: { ovalado: "Ovalado", redondo: "Redondo", cuadrado: "Cuadrado" },
  piel: { clara: "Clara", media: "Media", morena: "Morena", oscura: "Oscura", profunda: "Profunda" },
  pelo: { sinPelo: "Sin pelo", rapado: "Rapado", corto: "Corto", medio: "Medio", peinado: "Peinado", ondulado: "Ondulado", rizado: "Rizado", largo: "Largo" },
  colorPelo: { negro: "Negro", cafeOscuro: "Café oscuro", cafe: "Café", castano: "Castaño", rubio: "Rubio", pelirrojo: "Pelirrojo", gris: "Gris", blanco: "Blanco" },
  ojos: { redondos: "Redondos", almendrados: "Almendrados", sonrientes: "Sonrientes" },
  colorOjos: { cafe: "Café", verde: "Verde", azul: "Azul" },
  cejas: { suaves: "Suaves", marcadas: "Marcadas", arqueadas: "Arqueadas" },
  nariz: { pequena: "Pequeña", recta: "Recta", ancha: "Ancha" },
  boca: { sonrisa: "Sonrisa", neutra: "Neutra", amplia: "Amplia" },
  barba: { ninguna: "Sin barba", sombra: "Sombra", corta: "Corta", media: "Media", completa: "Completa", perilla: "Perilla", bigote: "Bigote", barbaBigote: "Barba + bigote" },
  accesorio: { ninguno: "Ninguno", lentes: "Lentes", lentesSol: "Lentes de sol", visera: "Visera", gorra: "Gorra", gorraGolf: "Gorra de golf", aretes: "Aretes" },
};
const CATEGORIES = [
  ["persona", "PERSONA"], ["rostro", "ROSTRO"], ["piel", "PIEL"], ["pelo", "PELO"],
  ["colorPelo", "COLOR DE PELO"], ["ojos", "OJOS"], ["colorOjos", "COLOR DE OJOS"],
  ["cejas", "CEJAS"], ["nariz", "NARIZ"], ["boca", "BOCA"],
  ["barba", "BARBA"], ["accesorio", "ACCESORIOS"],
] as const satisfies readonly (readonly [keyof typeof MANUAL_AVATAR_OPTIONS, string])[];

function swatchFor(category: keyof typeof MANUAL_AVATAR_OPTIONS, option: string): string | null {
  if (category === "piel" || category === "colorPelo" || category === "colorOjos") return (MANUAL_AVATAR_SWATCHES[category] as Record<string, string>)[option] || null;
  return null;
}

export function AvatarCreationPanel({ initialValue, onUse, onCancel, onBusyChange, staged = false }: {
  initialValue?: string;
  onUse: (avatarUrl: string) => void | Promise<void>;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
  staged?: boolean;
}) {
  const id = useId();
  const [config, setConfig] = useState<ManualAvatarConfig>(() => parseManualAvatarUrl(initialValue) || DEFAULT_MANUAL_AVATAR);
  const [category, setCategory] = useState<keyof typeof MANUAL_AVATAR_OPTIONS>("persona");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const selected = CATEGORIES.find(([key]) => key === category)![1];
  const preview = manualAvatarUrl(config);

  function update(key: keyof typeof MANUAL_AVATAR_OPTIONS, value: string) {
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
    <header><div><span>HECHO POR TI · SIN IA</span><h3 id={`${id}-title`}>CREA TU AVATAR</h3></div><button type="button" aria-label="Cerrar editor de avatar" disabled={saving} onClick={onCancel}>×</button></header>
    <div className={styles.hero}><div className={styles.preview}><img src={preview} alt="Vista previa instantánea de tu avatar" /></div><div><strong>Tu estilo, pieza por pieza.</strong><p>Elige rostro, rasgos y accesorios. Todo se crea aquí en tu dispositivo; no se envía ninguna foto ni descripción a un proveedor.</p></div></div>
    <small className={styles.categoryHint}>DESLIZA PARA ELEGIR UNA PARTE →</small>
    <div className={styles.categories} role="group" aria-label="Partes del avatar">{CATEGORIES.map(([key, label]) => <button key={key} type="button" aria-pressed={category === key} data-active={category === key} disabled={saving} onClick={() => setCategory(key)}>{label}</button>)}</div>
    <fieldset className={styles.options}><legend>{selected}</legend><div>{MANUAL_AVATAR_OPTIONS[category].map((option) => <button key={option} type="button" aria-pressed={config[category] === option} data-active={config[category] === option} disabled={saving} onClick={() => update(category, option)}>{swatchFor(category, option) && <span className={styles.swatch} style={{ backgroundColor: swatchFor(category, option)! }} aria-hidden="true" />}{(LABELS[category] as Record<string, string>)[option]}</button>)}</div></fieldset>
    <div className={styles.actions}><button type="button" className="secondary" disabled={saving} onClick={() => { setConfig(randomManualAvatarConfig()); setNotice("Nueva combinación lista. Puedes seguir editándola."); setError(""); }}>ALEATORIO</button><button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? "GUARDANDO…" : "GUARDAR AVATAR"}</button></div>
    <button type="button" className="textButton" disabled={saving} onClick={onCancel}>CANCELAR</button>
    {notice && <small role="status">{notice}</small>}
    {error && <small className={styles.error} role="alert">{error}</small>}
    <small>{staged ? "Tu avatar quedará listo y se guardará al completar tu perfil." : "Guardar confirma este avatar para tu perfil; si falla, podrás reintentar sin perder los rasgos elegidos."}</small>
  </section>;
}
