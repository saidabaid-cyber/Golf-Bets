"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowser } from "../../../../lib/supabase/client";

type JsonRecord = Record<string, unknown>;
type CourseView = {
  key: string;
  data: JsonRecord;
  postingTees: JsonRecord[];
  error: JsonRecord | null;
  postingError: JsonRecord | null;
};

const MAX_SCORE_ROWS = 10;
const MAX_TRACE_ROWS = 30;
const MAX_DIFF_ROWS = 24;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const parsed = record(item);
    return parsed ? [parsed] : [];
  }) : [];
}

function stage(payload: JsonRecord | null, key: string) {
  return record(payload?.[key]);
}

function valueText(value: unknown, fallback = "—") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return fallback;
}

function primitiveEntries(value: unknown) {
  const source = record(value);
  return source ? Object.entries(source).filter(([, item]) => (
    typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null
  )) : [];
}

function StatusChip({ value }: { value: unknown }) {
  const status = valueText(value, "PENDING_INTERACTIVE_QA");
  return <span className="eyebrow" aria-label={`Estado ${status}`}>{status}</span>;
}

function ScalarFacts({ value, empty = "Sin datos adicionales." }: { value: unknown; empty?: string }) {
  const entries = primitiveEntries(value);
  if (!entries.length) return <p>{empty}</p>;
  return (
    <dl className="provisionalGrid">
      {entries.map(([key, item]) => (
        <div className="stat" key={key}><dt>{key}</dt><dd><b>{valueText(item)}</b></dd></div>
      ))}
    </dl>
  );
}

function ErrorSummary({ value }: { value: unknown }) {
  const error = record(value);
  if (!error) return null;
  return (
    <p role="status">
      {valueText(error.code, "UPSTREAM_ERROR")} · HTTP {valueText(error.httpStatus)} · {valueText(error.message, "La consulta no devolvió detalle.")}
    </p>
  );
}

function teeHoleCount(tee: JsonRecord) {
  const holeData = records(tee.holeData);
  return holeData.length || valueText(tee.holes, "0");
}

function CourseTee({
  courseKey,
  tee,
  index,
  postingIds,
  expandedTee,
  onToggle,
}: {
  courseKey: string;
  tee: JsonRecord;
  index: number;
  postingIds: ReadonlySet<string>;
  expandedTee: string | null;
  onToggle: (key: string) => void;
}) {
  const teeId = valueText(tee.id, `sin-id-${index + 1}`);
  const key = `${courseKey}:${teeId}:${index}`;
  const holes = records(tee.holeData);
  const isExpanded = expandedTee === key;
  return (
    <article className="card" style={{ marginTop: "1rem" }}>
      <div className="roundActions" style={{ justifyContent: "space-between" }}>
        <div>
          <h4 style={{ marginBottom: ".35rem" }}>{valueText(tee.displayName ?? tee.name, `Tee ${index + 1}`)}</h4>
          <p style={{ margin: 0 }}>TeeSetRatingId {valueText(tee.id)} · {postingIds.has(teeId) ? "Válido para score posting" : "No confirmado para score posting"}</p>
        </div>
        <button className="secondary" type="button" onClick={() => onToggle(key)} disabled={!holes.length}>
          {isExpanded ? "Ocultar hoyos" : `Ver hoyos (${holes.length})`}
        </button>
      </div>
      <div className="provisionalGrid">
        <div className="stat"><span>Género</span><b>{valueText(tee.gender)}</b></div>
        <div className="stat"><span>Status</span><b>{valueText(tee.rawStatus ?? tee.status)}</b></div>
        <div className="stat"><span>Par</span><b>{valueText(tee.par)}</b></div>
        <div className="stat"><span>Yardage</span><b>{valueText(tee.totalYards)}</b></div>
        <div className="stat"><span>Rating Total</span><b>{valueText(tee.courseRating)}</b></div>
        <div className="stat"><span>Slope Total</span><b>{valueText(tee.slopeRating)}</b></div>
        <div className="stat"><span>Rating Front</span><b>{valueText(tee.frontRating)}</b></div>
        <div className="stat"><span>Slope Front</span><b>{valueText(tee.frontSlope)}</b></div>
        <div className="stat"><span>Rating Back</span><b>{valueText(tee.backRating)}</b></div>
        <div className="stat"><span>Slope Back</span><b>{valueText(tee.backSlope)}</b></div>
        <div className="stat"><span>Hoyos</span><b>{teeHoleCount(tee)}</b></div>
      </div>
      {isExpanded && (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Hoyo</th><th>HoleId</th><th>Par</th><th>Yardage</th><th>Stroke allocation</th></tr></thead>
            <tbody>
              {holes.map((hole, holeIndex) => (
                <tr key={`${valueText(hole.id, "hole")}-${holeIndex}`}>
                  <td>{valueText(hole.number)}</td><td>{valueText(hole.id)}</td><td>{valueText(hole.par)}</td>
                  <td>{valueText(hole.yardage)}</td><td>{valueText(hole.strokeIndex)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function courseViews(course: JsonRecord | null, selectedCourse: JsonRecord | null): CourseView[] {
  const layouts = records(course?.relatedLayouts);
  const views = layouts.flatMap((layout, index) => {
    const detail = record(layout.details);
    const candidate = record(layout.candidate);
    const detailData = record(detail?.data) ?? candidate;
    if (!detailData) return [];
    const selectedId = valueText(selectedCourse?.id, "");
    const layoutId = valueText(detailData.id, "");
    const data = selectedCourse && selectedId && selectedId === layoutId ? selectedCourse : detailData;
    const scorePosting = record(layout.scorePostingTees);
    return [{
      key: layoutId || `course-${index}`,
      data,
      postingTees: records(scorePosting?.data),
      error: record(layout.error),
      postingError: record(layout.postingError),
    }];
  });
  if (views.length || !selectedCourse) return views;
  return [{ key: valueText(selectedCourse.id, "selected-course"), data: selectedCourse, postingTees: [], error: null, postingError: null }];
}

function CourseSummary({
  view,
  expandedTee,
  onToggleTee,
}: {
  view: CourseView;
  expandedTee: string | null;
  onToggleTee: (key: string) => void;
}) {
  const tees = records(view.data.tees);
  const postingIds = new Set(view.postingTees.flatMap((tee) => {
    const id = valueText(tee.id, "");
    return id ? [id] : [];
  }));
  const pars = [...new Set(tees.flatMap((tee) => typeof tee.par === "number" ? [tee.par] : []))];
  return (
    <article className="card" style={{ marginTop: "1rem" }}>
      <h3>{valueText(view.data.name, "Course sin nombre")}</h3>
      <div className="provisionalGrid">
        <div className="stat"><span>Facility</span><b>{valueText(view.data.facilityName)}</b></div>
        <div className="stat"><span>FacilityId</span><b>{valueText(view.data.facilityId)}</b></div>
        <div className="stat"><span>CourseId</span><b>{valueText(view.data.id)}</b></div>
        <div className="stat"><span>CourseStatus</span><b>{valueText(view.data.rawStatus ?? view.data.status)}</b></div>
        <div className="stat"><span>TotalPar</span><b>{valueText(view.data.par, pars.length === 1 ? String(pars[0]) : "—")}</b></div>
        <div className="stat"><span>Total TeeSets</span><b>{tees.length}</b></div>
        <div className="stat"><span>TeeSets para posting</span><b>{postingIds.size}</b></div>
      </div>
      <ErrorSummary value={view.error} />
      <ErrorSummary value={view.postingError} />
      {tees.map((tee, index) => (
        <CourseTee
          key={`${view.key}-${valueText(tee.id, String(index))}`}
          courseKey={view.key}
          tee={tee}
          index={index}
          postingIds={postingIds}
          expandedTee={expandedTee}
          onToggle={onToggleTee}
        />
      ))}
    </article>
  );
}

function ReconciliationSummary({ items }: { items: JsonRecord[] }) {
  if (!items.length) return <p>Aún no hay una reconciliación disponible.</p>;
  return (
    <div className="provisionalGrid">
      {items.map((item, index) => {
        const diffs = records(item.diffs).slice(0, MAX_DIFF_ROWS);
        const postingIds = Array.isArray(item.postingTeeSetIds) ? item.postingTeeSetIds : [];
        return (
          <article className="card" key={`${valueText(item.layout, "layout")}-${index}`}>
            <h3>{valueText(item.layout, "Layout")}</h3>
            <StatusChip value={item.status} />
            <p>CourseId: {valueText(item.ghinCourseId)}</p>
            <p>TeeSetRatingIds para posting: {postingIds.length ? postingIds.map((id) => valueText(id)).join(", ") : "ninguno"}</p>
            <p>{valueText(item.reason)}</p>
            {diffs.length > 0 && <ul>{diffs.map((diff, diffIndex) => (
              <li key={`${valueText(diff.tee)}-${valueText(diff.field)}-${diffIndex}`}>
                {valueText(diff.tee)} · {valueText(diff.field)}: Backyard {valueText(diff.backyard)} / GHIN {valueText(diff.ghin)}
              </li>
            ))}</ul>}
          </article>
        );
      })}
    </div>
  );
}

export default function GhinDiagnosticClient() {
  const [configuration, setConfiguration] = useState<JsonRecord | null>(null);
  const [diagnostic, setDiagnostic] = useState<JsonRecord | null>(null);
  const [courseSync, setCourseSync] = useState<JsonRecord | null>(null);
  const [expandedTee, setExpandedTee] = useState<string | null>(null);
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
    setExpandedTee(null);
    setDiagnostic(null);
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

  const runCourseSync = useCallback(async (courseId: string, apply: boolean) => {
    setRunning(true);
    setMessage(apply ? "Sincronizando el mapping confirmado en Supabase QA…" : "Generando dry-run de sincronización…");
    try {
      const supabase = getSupabaseBrowser();
      if (!supabase) throw new Error("La conexión de cuenta no está configurada.");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Inicia sesión con una cuenta administradora.");
      const response = await fetch("/api/admin/dev/ghin/course-sync", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(apply
          ? { operation: "apply_confirmed", courseId, confirmation: "APPLY_GHIN_COURSE_SYNC_QA" }
          : { operation: "dry_run", courseId }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as JsonRecord | null;
      if (!payload || !response.ok) throw new Error(valueText(payload?.error, "No fue posible generar el dry-run."));
      setCourseSync(payload);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No fue posible generar el dry-run.");
    } finally {
      setRunning(false);
    }
  }, []);

  const auth = stage(diagnostic, "auth");
  const golfer = stage(diagnostic, "golfer");
  const golferData = record(golfer?.data);
  const scores = stage(diagnostic, "scores");
  const scoreItems = records(scores?.items).slice(0, MAX_SCORE_ROWS);
  const course = stage(diagnostic, "course");
  const details = record(course?.details);
  const courseData = record(details?.data);
  const comparison = record(course?.comparison);
  const reconciliation = records(course?.reconciliation);
  const fixedTargets = record(configuration?.fixedTargets);
  const layouts = courseViews(course, courseData);
  const confirmedPar72 = reconciliation.some((item) => item.layout === "PAR_72"
    && item.status === "GHIN_MATCH_CONFIRMED"
    && item.ghinCourseId === "23233");
  const traces = records(diagnostic?.trace).slice(-MAX_TRACE_ROWS);

  if (!configuration) {
    return <main className="shell"><section className="card" role="status">{message}</section></main>;
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <span className="eyebrow">THE BACKYARD · ADMIN · PREVIEW</span>
          <h1>GHIN read-only diagnostic</h1>
          <p>Vista resumida para el jugador autorizado y La Vista. Sólo permite aplicar el mapping Par 72 confirmado en Supabase QA; nunca publica scores.</p>
        </div>
        <Link className="secondary" href="/admin">Volver a Admin</Link>
      </section>

      {message && <section className="card" role="status">{message}</section>}

      <section className="card">
        <h2>Configuración segura</h2>
        <div className="provisionalGrid">
          <article className="stat"><span>Estado</span><StatusChip value={configuration.status} /></article>
          <article className="stat"><span>Entorno</span><b>{valueText(configuration.environment)}</b></article>
          <article className="stat"><span>Modo</span><b>{valueText(configuration.mode, "READ_ONLY")}</b></article>
          <article className="stat"><span>Resultado</span><StatusChip value={diagnostic?.status} /></article>
        </div>
        <ScalarFacts value={configuration.capabilities} />
        <button className="primary" type="button" onClick={() => void run()} disabled={running}>
          {running ? "Consultando…" : "Ejecutar diagnóstico real de sólo lectura"}
        </button>
      </section>

      <section className="card">
        <h2>Autenticación y token</h2>
        <StatusChip value={auth?.status} />
        <p>Firebase Installation HTTP {valueText(auth?.firebaseHttpStatus)} · golfer_login HTTP {valueText(auth?.httpStatus)}</p>
        <p>Endpoint: {valueText(auth?.endpoint)} · Expira: {valueText(auth?.expiresAt)}</p>
        <ErrorSummary value={auth?.error} />
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
        <ScalarFacts value={golfer?.validation} empty="Sin validación todavía." />
        <ErrorSummary value={golfer?.error} />
      </section>

      <section className="card">
        <h2>Historial de scores</h2>
        <StatusChip value={scores?.status} />
        <p>{valueText(scores?.count, "0")} registros leídos; se muestran como máximo {MAX_SCORE_ROWS}. Ninguna escritura implementada.</p>
        {scoreItems.length > 0 && <div style={{ overflowX: "auto" }}><table><thead><tr><th>Fecha</th><th>Campo</th><th>Tee</th><th>Score</th><th>Differential</th></tr></thead><tbody>
          {scoreItems.map((score, index) => <tr key={`${valueText(score.id, "score")}-${index}`}><td>{valueText(score.playedOn)}</td><td>{valueText(score.courseName)}</td><td>{valueText(score.teeName)}</td><td>{valueText(score.grossScore ?? score.adjustedGrossScore)}</td><td>{valueText(score.differential)}</td></tr>)}
        </tbody></table></div>}
        <ErrorSummary value={scores?.error} />
      </section>

      <section className="card">
        <h2>La Vista: facility, layouts y tees</h2>
        <StatusChip value={course?.status} />
        <p>{layouts.length} Course/Layout relacionados. TeeSetRatingsForScorePosting se consulta en modo read-only.</p>
        <ErrorSummary value={course?.error} />
        {layouts.map((view) => <CourseSummary key={view.key} view={view} expandedTee={expandedTee} onToggleTee={(key) => setExpandedTee((current) => current === key ? null : key)} />)}
      </section>

      <section className="card">
        <h2>Reconciliación La Vista</h2>
        <p>Par 72, Temporary Par 70 y Temporary Par 69 se evalúan por IDs y firma de datos; nunca sólo por nombre.</p>
        <ReconciliationSummary items={reconciliation} />
      </section>

      <section className="card">
        <h2>Comparación y mappings propuestos</h2>
        <p>El dry-run no escribe. La sincronización sólo se habilita para FacilityId 19886 / CourseId 23233 después de una reconciliación confirmada.</p>
        {typeof comparison?.humanReport === "string" && <pre style={{ maxHeight: "20rem", overflow: "auto", whiteSpace: "pre-wrap" }}>{comparison.humanReport.slice(0, 12_000)}</pre>}
        <ScalarFacts value={comparison?.summary} />
        <p>Mappings propuestos: {records(course?.mappingProposal).length}</p>
        {typeof courseData?.id === "string" && <div className="roundActions">
          <button className="secondary" type="button" disabled={running} onClick={() => void runCourseSync(courseData.id as string, false)}>Preparar dry-run de sync</button>
          {confirmedPar72 && courseData.id === "23233" && <button className="primary" type="button" disabled={running} onClick={() => void runCourseSync("23233", true)}>Sincronizar Par 72 confirmado en QA</button>}
        </div>}
        {courseSync && <><StatusChip value={courseSync.status} /><ScalarFacts value={{ mode: courseSync.mode, facilityId: courseSync.facilityId, courseId: courseSync.courseId, completeForPlay: courseSync.completeForPlay, completeForScorePosting: courseSync.completeForScorePosting }} />
          {record(courseSync.databaseState) && <p>DB QA: {records(record(courseSync.databaseState)?.layouts).length} layouts · {records(record(courseSync.databaseState)?.tees).length} tees oficiales · {valueText(record(courseSync.databaseState)?.holeCount, "0")} hoyos · {valueText(record(courseSync.databaseState)?.yardageCount, "0")} yardajes.</p>}
        </>}
      </section>

      <section className="card">
        <h2>Traza sanitizada</h2>
        <p>Se muestran como máximo {MAX_TRACE_ROWS} llamadas y nunca headers ni tokens.</p>
        {traces.length > 0 && <div style={{ overflowX: "auto" }}><table><thead><tr><th>Fecha</th><th>Método</th><th>HTTP</th><th>Resultado</th><th>Endpoint</th><th>ms</th></tr></thead><tbody>
          {traces.map((trace, index) => <tr key={`${valueText(trace.at, "trace")}-${index}`}><td>{valueText(trace.at)}</td><td>{valueText(trace.method)}</td><td>{valueText(trace.httpStatus)}</td><td>{valueText(trace.outcome)}</td><td>{valueText(trace.endpoint)}</td><td>{valueText(trace.durationMs)}</td></tr>)}
        </tbody></table></div>}
      </section>
    </main>
  );
}
