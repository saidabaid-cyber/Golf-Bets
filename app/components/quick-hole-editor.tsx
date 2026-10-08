"use client";

import { useEffect, useRef, useState } from "react";
import type { AdvancedHoleStat } from "../../lib/types";
import { quickDraftErrors, toParText, type QuickHoleDraft, type ScorecardCell } from "../../lib/premium-scorecard";

export function QuickHoleEditor({ cell, playerName, clubs = [], onCancel, onSave }: {
  cell: ScorecardCell; playerName: string; clubs?: readonly string[]; onCancel: () => void;
  onSave: (draft: QuickHoleDraft) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<QuickHoleDraft>(() => ({ score: cell.score, putts: cell.putts, advanced: { ...cell.stat } }));
  const [details, setDetails] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLElement>(null), saving = useRef(false);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, []);
  function advanced(patch: Partial<AdvancedHoleStat>) { setDraft(value => ({ ...value, advanced: { ...value.advanced, ...patch } })); }
  function stepper(label: string, value: number | null | undefined, change: (next: number | null) => void, min: number, max: number, fallback: number) {
    return <div className="quickField"><label>{label}<div className="quickStepper">
      <button type="button" aria-label={`Disminuir ${label}`} disabled={busy || value === min} onClick={() => change(Math.max(min, (value ?? fallback) - 1))}>−</button>
      <input type="number" inputMode="numeric" aria-label={label} min={min} max={max} value={value ?? ""} placeholder="—" disabled={busy} onChange={event => change(event.target.value === "" ? null : Number(event.target.value))} />
      <button type="button" aria-label={`Aumentar ${label}`} disabled={busy || value === max} onClick={() => change(Math.min(max, (value ?? fallback) + 1))}>+</button>
    </div></label><button type="button" className="quickClear" disabled={busy} onClick={() => change(null)}>Sin capturar</button></div>;
  }
  async function save() {
    if (saving.current) return;
    const errors = quickDraftErrors(draft);
    if (errors.length) { setError(errors.join(" ")); return; }
    saving.current = true; setBusy(true); setError("");
    try { await onSave(draft); }
    catch { setError("No pudimos guardar el hoyo. Tu captura sigue aquí; vuelve a intentar."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="quickHoleBackdrop"><section ref={dialog} className="quickHoleSheet" role="dialog" aria-modal="true" aria-labelledby="quick-hole-title" tabIndex={-1} onKeyDown={event => {
    if (event.key === "Escape" && !saving.current) { event.preventDefault(); onCancel(); }
    if (event.key === "Tab") {
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') ?? [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <header className="quickHoleHeader"><div><span>CAPTURA RÁPIDA · {playerName}</span><h2 id="quick-hole-title">Hoyo {cell.hole.displayLabel ?? cell.hole.number} <small>Par {cell.hole.par}</small></h2></div><button type="button" aria-label="Cancelar captura" disabled={busy} onClick={onCancel}>×</button></header>
    <div className="quickHoleFields"><div className="quickMainFields">
      {stepper("Score", draft.score, score => setDraft(value => ({ ...value, score })), 1, 100, cell.hole.par)}
      {stepper("Putts", draft.putts, putts => setDraft(value => ({ ...value, putts })), 0, 50, 0)}
    </div><p className="quickComparison">{draft.score === null ? "Captura tu score para guardar." : `${toParText(draft.score - cell.hole.par)} vs. par`}{draft.putts === null ? " · Putts sin capturar" : ` · ${draft.putts} putts registrados`}</p>
    {draft.score === null && <button type="button" className="quickUsePar" onClick={() => setDraft(value => ({ ...value, score: cell.hole.par }))}>Confirmar par ({cell.hole.par})</button>}
    {cell.hole.par !== 3 && <fieldset className="quickTee"><legend>Salida · FIR <small>Opcional</small></legend><div className="quickChoices">
      {([['left', 'Izquierda'], ['center', 'Fairway'], ['right', 'Derecha']] as const).map(([direction, label]) => <button type="button" key={direction} disabled={busy} aria-pressed={direction === 'center' ? draft.advanced.fairwayHit === true : draft.advanced.teeDirection === direction} onClick={() => advanced({ teeDirection: direction, fairwayHit: direction === 'center' })}>{label}</button>)}
      <button type="button" disabled={busy} aria-pressed={draft.advanced.fairwayHit === undefined && draft.advanced.teeDirection === undefined} onClick={() => advanced({ fairwayHit: undefined, teeDirection: undefined })}>N/D</button>
    </div></fieldset>}
    <button type="button" className="quickDetailsToggle" aria-expanded={details} aria-controls="quick-hole-advanced" disabled={busy} onClick={() => setDetails(value => !value)}>Más detalles <span aria-hidden="true">{details ? '−' : '+'}</span></button>
    {details && <div id="quick-hole-advanced" className="quickAdvanced"><fieldset><legend>Green en regulación · GIR</legend><div className="quickChoices">{([true, false, undefined] as const).map((value, index) => <button type="button" disabled={busy} aria-pressed={draft.advanced.greenInRegulation === value} key={index} onClick={() => advanced({ greenInRegulation: value })}>{index === 0 ? 'Sí' : index === 1 ? 'No' : 'N/D'}</button>)}</div></fieldset>
      <div className="quickMainFields">
        {stepper("Penalidades", draft.advanced.penaltyStrokes, value => advanced({ penaltyStrokes: value ?? undefined }), 0, 50, 0)}
        {stepper("Bunker", draft.advanced.bunkerCount, value => advanced({ bunkerCount: value ?? undefined, greenSideBunkerCount: undefined, fairwayBunkerCount: undefined }), 0, 20, 0)}
        {stepper("Área de penalidad", draft.advanced.penaltyAreaCount, value => advanced({ penaltyAreaCount: value ?? undefined }), 0, 20, 0)}
        {stepper("OB", draft.advanced.outOfBoundsCount ?? (draft.advanced.outOfBounds === undefined ? undefined : Number(draft.advanced.outOfBounds)), value => advanced({ outOfBoundsCount: value ?? undefined, outOfBounds: value === null ? undefined : value > 0 }), 0, 20, 0)}
      </div>
      <label>Bastón de salida<input list="quick-tee-clubs" maxLength={40} disabled={busy} value={draft.advanced.teeClub ?? ''} onChange={event => advanced({ teeClub: event.target.value || undefined })} placeholder="Sin capturar" /></label>
      <datalist id="quick-tee-clubs">{[...new Set([...clubs, ...(cell.stat.teeClub ? [cell.stat.teeClub] : [])])].map(club => <option value={club} key={club} />)}</datalist>
      <label>Distancia de salida · yd<input type="number" inputMode="decimal" min={0} max={600} disabled={busy} value={draft.advanced.teeDistance ?? ''} onChange={event => advanced({ teeDistance: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="Sin capturar" /></label>
      <label>Primer putt · ft<input type="number" inputMode="decimal" min={0} max={300} disabled={busy} value={draft.advanced.firstPuttDistanceFeet ?? ''} onChange={event => advanced({ firstPuttDistanceFeet: event.target.value === '' ? undefined : Number(event.target.value) })} placeholder="Sin capturar" /></label>
    </div>}
    {error && <p className="quickError" role="alert">{error}</p>}</div>
    <footer className="quickHoleActions"><button type="button" disabled={busy} onClick={onCancel}>Cancelar</button><button type="button" className="quickSave" disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar"}</button></footer>
  </section></div>;
}
