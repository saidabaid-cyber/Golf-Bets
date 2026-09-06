"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import type { GolfCatalogAdminResource } from "../../lib/golf-catalog-admin-contract";
import { useBackyardAccount } from "./account-provider";
import styles from "../admin/admin.module.css";

type AdminItem = Record<string, unknown> & { id: string; active?: boolean };
type FieldKind = "text" | "number" | "url" | "datetime-local" | "select";
type FieldDefinition = {
  name: string;
  label: string;
  kind?: FieldKind;
  required?: boolean;
  placeholder?: string;
  options?: readonly { value: string; label: string }[];
};
type EditorDefinition = {
  resource: GolfCatalogAdminResource;
  label: string;
  singular: string;
  active: boolean;
  brandResource?: "ball-brands" | "club-brands";
  defaults: Record<string, string>;
  fields: readonly FieldDefinition[];
};

const CATEGORY_OPTIONS = [
  ["DRIVER", "Driver"], ["MINI_DRIVER", "Mini driver"], ["FAIRWAY_WOOD", "Madera"], ["HYBRID", "Híbrido"],
  ["UTILITY_IRON", "Utility / Driving iron"], ["IRON_SET", "Set de hierros"], ["WEDGE", "Wedge"], ["PUTTER", "Putter"],
].map(([value, label]) => ({ value, label }));
const PROVIDER_OPTIONS = [{ value: "BACKYARD_INTERNAL", label: "The Backyard interno" }];
const GENDER_OPTIONS = [
  { value: "", label: "Sin categoría" }, { value: "MEN", label: "Men" }, { value: "WOMEN", label: "Women" },
  { value: "UNISEX", label: "Unisex" }, { value: "OTHER", label: "Otra" },
] as const;

const SOURCE_FIELDS: readonly FieldDefinition[] = [
  { name: "source_name", label: "Nombre de la fuente", required: true, placeholder: "Fabricante" },
  { name: "source_url", label: "URL de la fuente", kind: "url", required: true, placeholder: "https://…" },
  { name: "verified_at", label: "Fecha verificada", kind: "datetime-local", required: true },
];

const EDITORS: readonly EditorDefinition[] = [
  {
    resource: "ball-brands", label: "Marcas de bolas", singular: "marca", active: true, defaults: {},
    fields: [
      { name: "id", label: "ID estable", required: true, placeholder: "titleist" },
      { name: "name", label: "Nombre", required: true, placeholder: "Titleist" },
      { name: "official_url", label: "Sitio oficial", kind: "url", placeholder: "https://…" },
      { name: "source_name", label: "Fuente" },
      { name: "verified_at", label: "Fecha verificada", kind: "datetime-local" },
    ],
  },
  {
    resource: "club-brands", label: "Marcas de bastones", singular: "marca", active: true, defaults: {},
    fields: [
      { name: "id", label: "ID estable", required: true, placeholder: "ping" },
      { name: "name", label: "Nombre", required: true, placeholder: "PING" },
      { name: "official_url", label: "Sitio oficial", kind: "url", placeholder: "https://…" },
      { name: "source_name", label: "Fuente" },
      { name: "verified_at", label: "Fecha verificada", kind: "datetime-local" },
    ],
  },
  {
    resource: "balls", label: "Bolas", singular: "bola", active: true, brandResource: "ball-brands", defaults: {},
    fields: [
      { name: "id", label: "ID estable", required: true, placeholder: "titleist-pro-v1-2025" },
      { name: "brand_id", label: "Marca", kind: "select", required: true },
      { name: "model", label: "Modelo", required: true },
      { name: "generation", label: "Generación" },
      { name: "year", label: "Año", kind: "number" },
      ...SOURCE_FIELDS,
    ],
  },
  {
    resource: "club-models", label: "Bastones", singular: "bastón", active: true, brandResource: "club-brands", defaults: { category: "DRIVER" },
    fields: [
      { name: "id", label: "ID estable", required: true, placeholder: "titleist-gt3-driver-2024" },
      { name: "brand_id", label: "Marca", kind: "select", required: true },
      { name: "model", label: "Modelo", required: true },
      { name: "generation", label: "Generación" },
      { name: "year", label: "Año", kind: "number" },
      { name: "category", label: "Categoría", kind: "select", required: true, options: CATEGORY_OPTIONS },
      ...SOURCE_FIELDS,
    ],
  },
  {
    resource: "shafts", label: "Shafts", singular: "shaft", active: true, defaults: {},
    fields: [
      { name: "id", label: "ID estable", required: true, placeholder: "fujikura-ventus-blue" },
      { name: "brand", label: "Marca", required: true },
      { name: "model", label: "Modelo", required: true },
      { name: "generation", label: "Generación" },
      { name: "year", label: "Año", kind: "number" },
      { name: "weight_grams", label: "Peso (g)", kind: "number" },
      ...SOURCE_FIELDS,
    ],
  },
  {
    resource: "course-venues", label: "Clubes / sedes", singular: "club", active: true, defaults: { provider: "BACKYARD_INTERNAL", visibility: "PUBLIC" },
    fields: [
      { name: "name", label: "Nombre", required: true },
      { name: "country", label: "País" },
      { name: "state_region", label: "Estado / región" },
      { name: "city", label: "Ciudad" },
      { name: "address", label: "Dirección" },
      { name: "provider", label: "Proveedor", kind: "select", required: true, options: PROVIDER_OPTIONS },
    ],
  },
  {
    resource: "courses", label: "Campos", singular: "campo", active: true, defaults: { holes: "18", provider: "BACKYARD_INTERNAL", visibility: "PUBLIC" },
    fields: [
      { name: "club_id", label: "ID estable del club", required: true, placeholder: "club-la-vista" },
      { name: "name", label: "Nombre del recorrido", required: true },
      { name: "holes", label: "Hoyos", kind: "select", required: true, options: [{ value: "9", label: "9" }, { value: "18", label: "18" }] },
      { name: "provider", label: "Proveedor", kind: "select", required: true, options: PROVIDER_OPTIONS },
    ],
  },
  {
    resource: "course-tees", label: "Tees", singular: "tee", active: true, defaults: { provider: "BACKYARD_INTERNAL" },
    fields: [
      { name: "course_id", label: "ID estable del campo", required: true, placeholder: "course-la-vista" },
      { name: "name", label: "Nombre", required: true },
      { name: "color", label: "Color" },
      { name: "gender", label: "Categoría", kind: "select", options: GENDER_OPTIONS },
      { name: "rating", label: "Rating", kind: "number" },
      { name: "slope", label: "Slope", kind: "number" },
      { name: "par", label: "Par", kind: "number" },
      { name: "total_yards", label: "Yardas totales", kind: "number" },
      { name: "provider", label: "Proveedor", kind: "select", required: true, options: PROVIDER_OPTIONS },
    ],
  },
  {
    resource: "course-holes", label: "Hoyos", singular: "hoyo", active: false, defaults: { provider: "BACKYARD_INTERNAL", par: "4" },
    fields: [
      { name: "course_id", label: "ID estable del campo", required: true, placeholder: "course-la-vista" },
      { name: "hole_number", label: "Número", kind: "number", required: true },
      { name: "par", label: "Par", kind: "number", required: true },
      { name: "stroke_index", label: "Stroke index", kind: "number", required: true },
      { name: "provider", label: "Proveedor", kind: "select", required: true, options: PROVIDER_OPTIONS },
    ],
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function displayValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

function dateTimeInput(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "";
  return new Date(value).toISOString().slice(0, 16);
}

function itemTitle(item: AdminItem): string {
  const brand = displayValue(item.brand);
  const model = displayValue(item.model);
  if (brand || model) return [brand, model].filter(Boolean).join(" ");
  return displayValue(item.name) || displayValue(item.test_source) || item.id;
}

function responseError(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === "string" ? value.error : fallback;
}

export function GolfCatalogAdminPanel() {
  const { identity, openAccess } = useBackyardAccount();
  const [resource, setResource] = useState<GolfCatalogAdminResource>("balls");
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [items, setItems] = useState<AdminItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<AdminItem | null>(null);
  const editor = useMemo(() => EDITORS.find(candidate => candidate.resource === resource) || EDITORS[0], [resource]);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...editor.defaults }));
  const [brandOptions, setBrandOptions] = useState<readonly { value: string; label: string }[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(false);
  const [brandError, setBrandError] = useState("");
  const token = identity.mode === "authenticated" ? identity.accessToken : null;

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const parameters = new URLSearchParams({ resource, limit: "30" });
      if (query.trim()) parameters.set("q", query.trim());
      if (includeArchived) parameters.set("includeArchived", "true");
      if (cursor) parameters.set("cursor", cursor);
      const response = await fetch(`/api/admin/golf-catalog?${parameters}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(payload, "No fue posible cargar el catálogo."));
      const payloadRecord = isRecord(payload) ? payload : {};
      const nextItems = Array.isArray(payloadRecord.items)
        ? payloadRecord.items.filter((item): item is AdminItem => isRecord(item) && typeof item.id === "string")
        : [];
      setItems(current => append ? [...current, ...nextItems] : nextItems);
      setNextCursor(typeof payloadRecord.nextCursor === "string" ? payloadRecord.nextCursor : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No fue posible cargar el catálogo.");
      if (!append) setItems([]);
    } finally { setLoading(false); }
  }, [includeArchived, query, resource, token]);

  useEffect(() => {
    setEditing(null);
    setValues({ ...editor.defaults });
    setMessage("");
    if (!token) { setItems([]); return; }
    const timer = window.setTimeout(() => { void load(); }, 250);
    return () => window.clearTimeout(timer);
  }, [editor, load, token]);

  useEffect(() => {
    let cancelled = false;
    const brandResource = editor.brandResource;
    setBrandOptions([]);
    setBrandError("");
    setBrandsLoading(false);
    if (!token || !brandResource) return () => { cancelled = true; };

    setBrandsLoading(true);
    void fetch(`/api/admin/golf-catalog?resource=${brandResource}&limit=50&includeArchived=true`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    }).then(async response => {
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(payload, "No fue posible cargar las marcas."));
      const payloadRecord = isRecord(payload) ? payload : {};
      const options = Array.isArray(payloadRecord.items) ? payloadRecord.items.flatMap(item => {
        if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") return [];
        return [{ value: item.id, label: `${item.name}${item.active === false ? " · archivada" : ""}` }];
      }) : [];
      if (!cancelled) setBrandOptions(options);
    }).catch(loadError => {
      if (!cancelled) setBrandError(loadError instanceof Error ? loadError.message : "No fue posible cargar las marcas.");
    }).finally(() => {
      if (!cancelled) setBrandsLoading(false);
    });

    return () => { cancelled = true; };
  }, [editor.brandResource, token]);

  function startEdit(item: AdminItem) {
    const nextValues = { ...editor.defaults };
    for (const field of editor.fields) {
      nextValues[field.name] = field.kind === "datetime-local" ? dateTimeInput(item[field.name]) : displayValue(item[field.name]);
    }
    setEditing(item);
    setValues(nextValues);
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetEditor() {
    setEditing(null);
    setValues({ ...editor.defaults });
  }

  function payloadFromValues() {
    const payload: Record<string, unknown> = {};
    for (const field of editor.fields) {
      if (editing && field.name === "id") continue;
      const raw = values[field.name] || "";
      if (!raw.trim()) {
        if (editing && !field.required) payload[field.name] = null;
        continue;
      }
      if (field.kind === "number") payload[field.name] = Number(raw);
      else if (field.kind === "datetime-local") payload[field.name] = new Date(raw).toISOString();
      else payload[field.name] = raw.trim();
    }
    return payload;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/golf-catalog", {
        method: editing ? "PATCH" : "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(editing
          ? { resource, id: editing.id, changes: payloadFromValues() }
          : { resource, data: { ...payloadFromValues(), ...(editor.active ? { active: true } : {}) } }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(payload, "No fue posible guardar el registro."));
      setMessage(editing ? "Cambios guardados." : `${editor.singular[0].toUpperCase()}${editor.singular.slice(1)} agregado.`);
      resetEditor();
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No fue posible guardar el registro.");
    } finally { setSaving(false); }
  }

  async function toggleArchive(item: AdminItem) {
    if (!token || typeof item.active !== "boolean") return;
    const archive = item.active;
    if (archive && !window.confirm(`¿Archivar ${itemTitle(item)}? Seguirá disponible para históricos.`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/golf-catalog", {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ resource, id: item.id, changes: { active: !item.active } }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(payload, "No fue posible cambiar el estado."));
      setMessage(archive ? "Registro archivado sin borrarlo." : "Registro reactivado.");
      await load();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "No fue posible cambiar el estado.");
    } finally { setSaving(false); }
  }

  if (!token) return <main className={styles.page}>
    <section className={styles.authCard}>
      <p className={styles.eyebrow}>ADMINISTRACIÓN</p>
      <h1>Catálogos de golf</h1>
      <p>Esta ruta requiere una cuenta con rol administrativo verificado en el servidor.</p>
      <button type="button" onClick={openAccess}>Iniciar sesión</button>
      <Link href="/">Volver a The Backyard</Link>
    </section>
  </main>;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>THE BACKYARD · ADMIN</p><h1>Catálogos de golf</h1><p>Alta, corrección y archivo. Ningún registro de catálogo se elimina.</p></div>
      <Link href="/">Volver a la app</Link>
    </header>

    <section className={styles.toolbar} aria-label="Seleccionar catálogo">
      <label>Catálogo<select value={resource} onChange={event => setResource(event.target.value as GolfCatalogAdminResource)}>
        {EDITORS.map(option => <option key={option.resource} value={option.resource}>{option.label}</option>)}
      </select></label>
      <label>Buscar<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Buscar ${editor.label.toLowerCase()}…`} /></label>
      {editor.active && <label className={styles.checkbox}><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} />Incluir archivados</label>}
    </section>

    <div className={styles.columns}>
      <section className={styles.card}>
        <div className={styles.sectionTitle}><div><h2>{editing ? `Editar ${editor.singular}` : `Agregar ${editor.singular}`}</h2><p>Solo guarda datos confirmados y su fuente.</p></div>{editing && <button type="button" onClick={resetEditor}>Cancelar</button>}</div>
        <form className={styles.form} onSubmit={save}>
          {brandError && <div className={styles.error} role="alert">{brandError}</div>}
          {editor.fields.map(field => <label key={field.name}>{field.label}
            {field.kind === "select" ? <select required={field.required} disabled={saving || Boolean(editing && field.name === "id")} value={values[field.name] || ""} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))}>
              {field.name === "brand_id" && <option value="">{brandsLoading ? "Cargando marcas…" : "Selecciona una marca"}</option>}
              {!field.required && !field.options?.some(option => option.value === "") && <option value="">Sin dato</option>}
              {(field.name === "brand_id" ? brandOptions : field.options)?.map(option => <option key={option.value || "empty"} value={option.value}>{option.label}</option>)}
            </select> : <input
              type={field.kind === "number" ? "number" : field.kind === "url" ? "url" : field.kind === "datetime-local" ? "datetime-local" : "text"}
              step={field.kind === "number" ? "any" : undefined}
              required={field.required}
              disabled={saving || Boolean(editing && field.name === "id")}
              value={values[field.name] || ""}
              placeholder={field.placeholder}
              onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))}
            />}
          </label>)}
          <button className={styles.primary} disabled={saving} type="submit">{saving ? "Guardando…" : editing ? "Guardar cambios" : `Agregar ${editor.singular}`}</button>
        </form>
      </section>

      <section className={styles.card} aria-live="polite">
        <div className={styles.sectionTitle}><div><h2>{editor.label}</h2><p>{items.length} registro{items.length === 1 ? "" : "s"} en esta página</p></div><button type="button" disabled={loading} onClick={() => void load()}>Actualizar</button></div>
        {error && <div className={styles.error} role="alert">{error}</div>}
        {message && <div className={styles.success} role="status">{message}</div>}
        {loading && !items.length ? <div className={styles.empty}>Cargando catálogo…</div> : !items.length && !error ? <div className={styles.empty}>No hay registros para esta búsqueda.</div> : <div className={styles.list}>
          {items.map(item => <article className={styles.item} key={item.id}>
            <div><strong>{itemTitle(item)}</strong><span>{item.id}</span>{item.active === false && <em>ARCHIVADO</em>}</div>
            <div className={styles.actions}><button type="button" disabled={saving} onClick={() => startEdit(item)}>Editar</button>{editor.active && typeof item.active === "boolean" && <button type="button" disabled={saving} onClick={() => void toggleArchive(item)}>{item.active ? "Archivar" : "Reactivar"}</button>}</div>
          </article>)}
        </div>}
        {nextCursor && <button className={styles.loadMore} type="button" disabled={loading} onClick={() => void load(nextCursor, true)}>{loading ? "Cargando…" : "Cargar más"}</button>}
      </section>
    </div>
  </main>;
}
