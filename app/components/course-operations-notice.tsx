"use client";

import { useEffect, useState } from "react";
import { ModalCloseButton, ModalShell } from "./modal-shell";

type Operations = {
  badges?: string[];
  warning?: string;
  localRules?: Array<{ id?: string; title?: string; shortSummary?: string; body?: string }>;
  documents?: Array<{ id: string; name: string; url: string; attribution?: string | null }>;
  resolved?: { warnings?: string[]; resolvedHoles?: Array<{ id: string; displayLabel: string; par: number; operationalNote?: string | null; dropZoneNote?: string | null }> };
};

export function CourseOperationsNotice({ courseId, frozenAt, accessToken }: { courseId: string; frozenAt?: string | null; accessToken?: string | null }) {
  const [operations, setOperations] = useState<Operations | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const parameters = new URLSearchParams({ at: frozenAt || new Date().toISOString() });
    void fetch(`/api/courses/${encodeURIComponent(courseId)}/operations?${parameters}`, { cache: "no-store", signal: controller.signal, headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined })
      .then(async (response) => response.ok ? response.json() as Promise<Operations> : null)
      .then((payload) => { if (payload) setOperations(payload); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [courseId, frozenAt, accessToken]);
  const badges = operations?.badges || [];
  if (!badges.length) return null;
  const temporary = badges.includes("TEMPORAL");
  const rules = operations?.localRules || [];
  return <>
    <div className="courseOperationsNotice" role="status">
      <div>{badges.map((badge) => <b key={badge}>{badge}</b>)}<span>{frozenAt ? "Configuración congelada para esta ronda." : temporary ? "Hay cambios operativos vigentes para próximas rondas." : "Este campo tiene reglas locales publicadas."}</span></div>
      <button type="button" className="textButton" onClick={() => setOpen(true)}>{temporary ? "Ver cambios" : "Ver reglas"}</button>
    </div>
    <ModalShell className="confirmDialog courseOperationsDialog" open={open} onClose={() => setOpen(false)} labelledBy="course-operations-title">
      <ModalCloseButton onClose={() => setOpen(false)} />
      <h2 id="course-operations-title">Operación vigente del campo</h2>
      {operations?.warning && <p>{operations.warning}</p>}
      {(operations?.resolved?.warnings || []).map((warning) => <p className="notice" key={warning}>{warning}</p>)}
      {temporary && <><h3>Cambios temporales</h3><ul>{(operations?.resolved?.resolvedHoles || []).filter((hole) => hole.operationalNote || hole.dropZoneNote || !/^\d+$/.test(hole.displayLabel)).map((hole) => <li key={hole.id}><b>Hoyo {hole.displayLabel} · Par {hole.par}</b>{hole.operationalNote || hole.dropZoneNote ? ` — ${hole.operationalNote || hole.dropZoneNote}` : ""}</li>)}</ul></>}
      {rules.length > 0 && <><h3>Reglas locales</h3>{rules.map((rule, index) => <article className="courseLocalRule" key={rule.id || `${rule.title}-${index}`}><b>{rule.title || "Regla local"}</b><span>{rule.shortSummary || rule.body}</span></article>)}</>}
      {(operations?.documents || []).length > 0 && <><h3>Documentos</h3>{operations?.documents?.map((document) => <a className="courseDocumentLink" href={document.url} target="_blank" rel="noreferrer" key={document.id}>{document.name}{document.attribution ? ` · ${document.attribution}` : ""}</a>)}</>}
      <button className="primary" onClick={() => setOpen(false)}>Entendido</button>
    </ModalShell>
  </>;
}
