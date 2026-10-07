"use client";
import { useRef, useState } from "react";
import type { GhinCourseLookupInput, GhinCourseLookupResponse } from "../../lib/ghin/course-lookup";
import type { NormalizedGhinTee } from "../../lib/ghin/core";
import styles from "./ghin-read-only-panel.module.css";

function Tee({ tee, inspect }: { tee: NormalizedGhinTee; inspect?: () => void }) {
  return <article>
    <b>{tee.displayName ?? tee.name ?? "Tee sin nombre"}</b>
    <span>{tee.gender ?? "Género no informado"} · ID {tee.id ?? "—"}</span>
    <small>{tee.holes ?? "—"} hoyos · Par {tee.par ?? "—"} · {tee.totalYards ?? "—"} yd · CR {tee.courseRating ?? "—"} · Slope {tee.slopeRating ?? "—"}</small>
    {inspect && <button type="button" className="textButton" onClick={inspect}>VER DETALLE DE TEE</button>}
  </article>;
}

/** Every upstream read requires an explicit click. Opening this section is inert. */
export function GhinCourseLookup({ lookup }: { lookup: (input: GhinCourseLookupInput) => Promise<GhinCourseLookupResponse> }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("La Vista");
  const [courseId, setCourseId] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState<GhinCourseLookupResponse | null>(null);
  async function read(input: GhinCourseLookupInput) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const next = await lookup(input);
      setData(current => input.operation === "tee" || input.operation === "posting-profile" ? { ...current, ...next } : next);
    }
    catch (error) { setError(error instanceof Error ? error.message : "No se pudo consultar GHIN."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <details className={styles.scores}>
    <summary>Consultar campo GHIN</summary>
    <p>Consulta oficial de sólo lectura. No cambia tu catálogo ni tus rondas.</p>
    <form className={styles.authForm} onSubmit={event => { event.preventDefault(); void read({ operation: "search", name }); }}>
      <label>Campo GHIN<input value={name} maxLength={100} minLength={2} onChange={event => setName(event.target.value)} required /></label>
      <button type="submit" className="secondary" disabled={busy}>{busy ? "CONSULTANDO…" : "BUSCAR CAMPO GHIN"}</button>
    </form>
    <form className={styles.authForm} onSubmit={event => { event.preventDefault(); void read({ operation: "course", courseId }); }}>
      <label>ID de campo GHIN<input value={courseId} inputMode="numeric" pattern="[0-9]{1,12}" maxLength={12} onChange={event => setCourseId(event.target.value)} required /></label>
      <button type="submit" className="secondary" disabled={busy}>CONSULTAR POR ID</button>
    </form>
    <button type="button" className="textButton" disabled={busy} onClick={() => void read({ operation: "posting-profile" })}>VERIFICAR PERFIL PARA POSTING</button>
    {error && <p role="alert">{error}</p>}
    {data?.facilities && <p>{data.facilities.ok ? `Instalaciones encontradas: ${data.facilities.data.length}` : `Facility search: ${data.facilities.code} · HTTP ${data.facilities.httpStatus ?? "—"}`}</p>}
    {data?.facilities?.ok && data.facilities.data.map(f => <p key={f.id}>{f.name} · Facility ID {f.id} · {f.city}, {f.state}, {f.country}</p>)}
    {data?.courses && !data.courses.ok && <p>Course search: {data.courses.code} · HTTP {data.courses.httpStatus ?? "—"}</p>}
    {data?.courses?.ok && <div className={styles.scoreList}>{data.courses.data.map(c => <article key={c.id}><b>{c.name}</b><span>Course ID {c.id} · Facility {c.facilityId ?? "—"}</span>{c.id && <button type="button" className="secondary" disabled={busy} onClick={() => void read({ operation: "course", courseId: c.id! })}>CONSULTAR {c.name}</button>}</article>)}</div>}
    {data?.course && !data.course.ok && <p>Course details: {data.course.code} · HTTP {data.course.httpStatus ?? "—"}</p>}
    {data?.course?.ok && <section aria-label="Detalle de campo GHIN">
      <h3>{data.course.data.name}</h3>
      <p>Course ID {data.course.data.id} · Facility ID {data.course.data.facilityId} · {data.course.data.holes ?? "—"} hoyos · Par {data.course.data.par ?? "—"}</p>
      <div className={styles.scoreList}>{data.course.data.tees.map(t => <Tee key={t.id} tee={t} inspect={t.id && !busy ? () => void read({ operation: "tee", teeId: t.id! }) : undefined} />)}</div>
    </section>}
    {data?.postingTees && <p role="status">{data.postingTees.ok ? `Tees habilitadas por GHIN para score posting: ${data.postingTees.data.map(t => t.id).join(", ") || "ninguna"}` : `Score posting entitlement: ${data.postingTees.code} · HTTP ${data.postingTees.httpStatus ?? "—"}`}</p>}
    {data?.tee && (data.tee.ok ? <Tee tee={data.tee.data} /> : <p>Tee details: {data.tee.code} · HTTP {data.tee.httpStatus ?? "—"}</p>)}
    {data?.postingProfile && <p role="status">{data.postingProfile.ok
      ? `Perfil GHIN: ${data.postingProfile.data.identityMatches ? "identidad vinculada confirmada" : "identidad no coincide"} · Género declarado por GHIN: ${data.postingProfile.data.gender ?? "no informado"}`
      : `Perfil para posting: ${data.postingProfile.code} · HTTP ${data.postingProfile.httpStatus ?? "—"}`}</p>}
    {data && <details><summary>Evidencia de campo y tees</summary><pre className={styles.evidence}>{JSON.stringify(data, null, 2)}</pre></details>}
  </details>;
}
