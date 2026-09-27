"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowser } from "../../../../lib/supabase/client";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stage(payload: JsonRecord | null, key: string) {
  return record(payload?.[key]);
}

function valueText(value: unknown, fallback = "—") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function StatusChip({ value }: { value: unknown }) {
  const status = valueText(value, "PENDING_INTERACTIVE_QA");
  return <span className="eyebrow" aria-label={`Estado ${status}`}>{status}</span>;
}

function JsonPanel({ value }: { value: unknown }) {
  return <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(value ?? null, null, 2)}</pre>;
}

export default function GhinDiagnosticClient() {
  const [configuration, setConfiguration] = useState<JsonRecord | null>(null);
  const [diagnostic, setDiagnostic] = useState<JsonRecord | null>(null);
  const [courseSync, setCourseSync] = useState<JsonRecord | null>(null);
  const [message, setMessage] = useState("Validando acceso administrativo…");
  const [running, setRunning] = useState(false);

  const authorizedFetch = useCallback(async (method: "GET" | "POST") => {
    const supabase = getSupabaseBrowser();
    if (!supabase) throw new Error("La conexión de cuenta no está configurada en este entorno.");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Inicia sesión con una cuenta administradora.");
    const response = await fetch("/api/admin/dev/ghin", {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify({ operation: "run_full_read_only" }) } : {}),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as JsonRecord | null;
    if (!payload) throw new Error("La ruta GHIN no devolvió JSON válido.");
    if (!response.ok && ![502, 503].includes(response.status)) {
      throw new Error(valueText(payload.error, "No fue posible ejecutar el diagnóstico."));
    }
    return payload;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void authorizedFetch("GET")
      .then((payload) => {
        if (cancelled) return;
        setConfiguration(payload);
        setMessage("");
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "No fue posible validar el acceso.");
      });
    return () => { cancelled = true; };
  }, [authorizedFetch]);

  const run = useCallback(async () => {
    setRunning(true);
    setMessage("Ejecutando lecturas GHIN reales…");
    try {
      const payload = await authorizedFetch("POST");
      setDiagnostic(payload);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible ejecutar el diagnóstico.");
    } finally {
      setRunning(false);
    }
  }, [authorizedFetch]);

  const runCourseSync = useCallback(async (operation: "dry_run" | "apply_confirmed", courseId: string) => {
    if (operation === "apply_confirmed" && !window.confirm("Aplicar únicamente el mapping y catálogo GHIN revisados en Supabase QA. No afecta Production ni publica scores. ¿Continuar?")) return;
    setRunning(true);
    setMessage(operation === "dry_run" ? "Generando dry-run de sincronización…" : "Aplicando sincronización controlada en QA…");
    try {
      const supabase = getSupabaseBrowser();
      if (!supabase) throw new Error("La conexión de cuenta no está configurada.");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Inicia sesión con una cuenta administradora.");
      const response = await fetch("/api/admin/dev/ghin/course-sync", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ operation, courseId, ...(operation === "apply_confirmed" ? { confirmation: "APPLY_GHIN_COURSE_SYNC_QA" } : {}) }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as JsonRecord | null;
      if (!payload || !response.ok) throw new Error(valueText(payload?.error, "No fue posible sincronizar."));
      setCourseSync(payload);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible sincronizar.");
    } finally {
      setRunning(false);
    }
  }, []);

  const auth = stage(diagnostic, "auth");
  const golfer = stage(diagnostic, "golfer");
  const golferData = record(golfer?.data);
  const scores = stage(diagnostic, "scores");
  const course = stage(diagnostic, "course");
  const details = record(course?.details);
  const courseData = record(details?.data);
  const comparison = record(course?.comparison);
  const reconciliation = Array.isArray(course?.reconciliation) ? course?.reconciliation : [];
  const fixedTargets = record(configuration?.fixedTargets);

  if (!configuration) {
    return (
      <main className="shell">
        <section className="card" role="status">{message}</section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <span className="eyebrow">THE BACKYARD · ADMIN · PREVIEW</span>
          <h1>GHIN read-only diagnostic</h1>
          <p>Prueba controlada para un jugador autorizado y La Vista. No publica scores, no aplica mappings y no modifica perfiles.</p>
        </div>
        <Link className="secondary" href="/admin">Volver a Admin</Link>
      </section>

      {message && <section className="card" role="status">{message}</section>}

      <section className="card">
        <h2>Configuración segura</h2>
        <div className="provisionalGrid">
          <article className="stat"><span>Estado</span><StatusChip value={configuration?.status} /></article>
          <article className="stat"><span>Entorno</span><b>{valueText(configuration?.environment)}</b></article>
          <article className="stat"><span>Modo</span><b>{valueText(configuration?.mode, "READ_ONLY")}</b></article>
          <article className="stat"><span>Resultado</span><StatusChip value={diagnostic?.status} /></article>
        </div>
        <JsonPanel value={{ capabilities: configuration?.capabilities, blocker: configuration?.blocker, safety: configuration?.safety }} />
        <button className="primary" type="button" onClick={() => void run()} disabled={running}>
          {running ? "Consultando…" : "Ejecutar diagnóstico real de sólo lectura"}
        </button>
      </section>

      <section className="card">
        <h2>Autenticación y token</h2>
        <StatusChip value={auth?.status} />
        <p>Firebase Installation HTTP {valueText(auth?.firebaseHttpStatus)} · golfer_login HTTP {valueText(auth?.httpStatus)}</p>
        <p>Endpoint: {valueText(auth?.endpoint)} · Expira: {valueText(auth?.expiresAt)}</p>
      </section>

      <section className="card">
        <h2>Golfer {valueText(fixedTargets?.ghinNumber, "objetivo autorizado")}</h2>
        <StatusChip value={golfer?.status} />
        <div className="provisionalGrid">
          <article className="stat"><span>Nombre</span><b>{valueText(golferData?.name)}</b></article>
          <article className="stat"><span>Club</span><b>{valueText(golferData?.clubName)}</b></article>
          <article className="stat"><span>Handicap Index</span><b>{valueText(golferData?.handicapIndex)}</b></article>
          <article className="stat"><span>Actualizado</span><b>{valueText(golferData?.updatedAt ?? golfer?.fetchedAt)}</b></article>
        </div>
        <JsonPanel value={{ validation: golfer?.validation, error: golfer?.error }} />
      </section>

      <section className="card">
        <h2>Historial de scores</h2>
        <StatusChip value={scores?.status} />
        <p>{valueText(scores?.count, "0")} registros leídos; ninguna escritura implementada.</p>
        <JsonPanel value={scores?.items ?? scores?.error} />
      </section>

      <section className="card">
        <h2>La Vista: facility, layouts, tees y hoyos</h2>
        <StatusChip value={course?.status} />
        <p>Facility ID: {valueText(courseData?.facilityId)} · Course ID: {valueText(courseData?.id)}</p>
        <p>La consulta incluye TeeSetRatingsForScorePosting como verificación read-only; no publica ningún score.</p>
        <JsonPanel value={{ facilities: course?.facilities, course: courseData, relatedLayouts: course?.relatedLayouts, teeReads: course?.teeReads, error: course?.error }} />
      </section>

      <section className="card">
        <h2>Reconciliación La Vista</h2>
        <p>Par 72, Temporary Par 70 y Temporary Par 69 se evalúan por IDs y firma de datos; nunca sólo por nombre.</p>
        <JsonPanel value={reconciliation} />
      </section>

      <section className="card">
        <h2>Comparación y mappings propuestos</h2>
        <p>Dry-run únicamente; cualquier propuesta requiere revisión y una aplicación controlada posterior.</p>
        {typeof comparison?.humanReport === "string" && <pre style={{ overflowX: "auto", whiteSpace: "pre-wrap" }}>{comparison.humanReport}</pre>}
        <JsonPanel value={{ summary: comparison?.summary, mappings: course?.mappingProposal }} />
        {typeof courseData?.id === "string" && <div className="roundActions">
          <button className="secondary" type="button" disabled={running} onClick={() => void runCourseSync("dry_run", courseData.id as string)}>Dry-run de sync</button>
          <button className="primary" type="button" disabled={running} onClick={() => void runCourseSync("apply_confirmed", courseData.id as string)}>Aplicar mapping revisado en QA</button>
        </div>}
        {courseSync && <JsonPanel value={courseSync} />}
      </section>

      <section className="card">
        <h2>Traza sanitizada</h2>
        <JsonPanel value={diagnostic?.trace} />
      </section>
    </main>
  );
}
