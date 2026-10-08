"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AdvancedStatsByHole, Course, Player, PlayerTeeAssignmentSnapshot, PuttsByHole, RoundLifecycleState, RoundShotSnapshot } from "../../lib/types";
import { canQuickEditPlayer, GOLF_RESULT_LABELS, recordedNumber, scorecardCells, summarizeScorecard, toParText, type GolfResult, type QuickEditAccess, type QuickHoleDraft, type RecordedTotal, type ScorecardCell } from "../../lib/premium-scorecard";
import type { ScoreRows } from "../../lib/score-capture";
import type { ScorecardView } from "../../lib/scorecard-view";
import { QuickHoleEditor } from "./quick-hole-editor";

export type PremiumScorecardProps = {
  roundId: string; course: Course; players: Player[]; order: number[]; scores: ScoreRows;
  date?: string; lifecycle?: RoundLifecycleState; ownerId?: string; accountUserId?: string;
  putts?: PuttsByHole; advancedStats?: AdvancedStatsByHole; assignments?: PlayerTeeAssignmentSnapshot[];
  shots?: readonly RoundShotSnapshot[]; clubs?: readonly string[]; access?: QuickEditAccess;
  onSaveHole?: (hole: number, playerId: string, draft: QuickHoleDraft) => Promise<void> | void;
  onRequestEdit?: () => void;
  /** Isolated QA can describe its in-memory confirmation without claiming cloud sync. */
  saveNotice?: (hole: number) => string;
  /** Future integrations may supply already-authorized hole media without changing providers. */
  holeMedia?: (hole: number, playerId: string) => React.ReactNode;
};
const lifecycleCopy = { live: "En juego", draft: "Borrador", completed: "Terminada", cancelled: "Cancelada" };
function dateLabel(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? "";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}
export function GolfScoreSymbol({ score, result }: { score: number | null; result: GolfResult }) {
  return <span className="golfScoreSymbol" data-result={result} aria-label={score === null ? "Sin score" : `${score} golpes, ${GOLF_RESULT_LABELS[result]}`}>{score ?? "—"}</span>;
}
function statTotal(value: RecordedTotal, ratio = false) {
  if (value.value === null) return "—";
  return ratio ? `${value.value}/${value.captured}` : `${value.value}${value.captured < value.possible ? '*' : ''}`;
}
const directionLabels = { far_left: 'Muy a la izquierda', left: 'Izquierda', center: 'Centro', right: 'Derecha', far_right: 'Muy a la derecha' };
const directionSymbols = { far_left: '⇇', left: '←', center: '↑', right: '→', far_right: '⇉' };
function Missing({ applicable = true }: { applicable?: boolean }) {
  return <span className="scorecardMissing" aria-label={applicable ? 'Sin capturar' : 'No aplicable'} title={applicable ? 'Sin capturar' : 'No aplicable'}>{applicable ? '—' : 'N/A'}</span>;
}
function Hit({ value, applicable = true }: { value: boolean | null; applicable?: boolean }) {
  if (!applicable || value === null) return <Missing applicable={applicable} />;
  return <span className="scorecardFact" data-hit={value} aria-label={value ? 'Sí' : 'No'} title={value ? 'Sí' : 'No'}>{value ? '✓' : '×'}</span>;
}
function Captured({ value }: { value: string | number | null | undefined }) {
  return value === null || value === undefined ? <Missing /> : <>{value}</>;
}
export function PremiumScorecard(props: PremiumScorecardProps & {
  view: Exclude<ScorecardView, { kind: "round" }>; onBack: () => void; onHole: (hole: number, player: string) => void;
}) {
  const [selected, setSelected] = useState(props.view.kind === 'hole' ? props.view.playerId : props.ownerId ?? props.players[0]?.id ?? '');
  const [nine, setNine] = useState<"front" | "back">(props.order.some(number => number <= 9) ? "front" : "back");
  const [editing, setEditing] = useState<ScorecardCell | null>(null), [notice, setNotice] = useState(''), [fullName, setFullName] = useState(false);
  const scroll = useRef<HTMLDivElement>(null), horizontalPositions = useRef(new Map<string, number>());
  const playerId = props.view.kind === 'hole' ? props.view.playerId : selected;
  const player = props.players.find(value => value.id === playerId) ?? props.players[0];
  const cells = useMemo(() => player ? scorecardCells({ course: props.course, order: props.order, scores: props.scores, putts: props.putts, advancedStats: props.advancedStats, playerId: player.id }) : [], [props.course, props.order, props.scores, props.putts, props.advancedStats, player]);
  const summary = summarizeScorecard(cells);
  const front = cells.filter(cell => cell.hole.number <= 9), back = cells.filter(cell => cell.hole.number >= 10);
  const visible = nine === 'front' ? front : back;
  const scrollKey = `${playerId}:${nine}`;
  useLayoutEffect(() => {
    if (props.view.kind === 'card' && scroll.current) scroll.current.scrollLeft = horizontalPositions.current.get(scrollKey) ?? 0;
  }, [scrollKey, props.view.kind]);
  const editable = Boolean(player && props.access && props.onSaveHole && canQuickEditPlayer(props.access, player));
  const has = (key: keyof ScorecardCell['stat']) => cells.some(cell => cell.stat[key] !== undefined);
  const rows: Array<{ label: string; render: (cell: ScorecardCell) => React.ReactNode }> = [
    ...(cells.some(cell => recordedNumber(cell.hole.yards, 1, 1500) !== null) ? [{ label: 'Yardas', render: (cell: ScorecardCell) => <Captured value={recordedNumber(cell.hole.yards, 1, 1500)} /> }] : []),
    ...(cells.some(cell => recordedNumber(cell.hole.strokeIndex, 1, 18) !== null) ? [{ label: 'Ventaja · SI', render: (cell: ScorecardCell) => <Captured value={recordedNumber(cell.hole.strokeIndex, 1, 18)} /> }] : []),
    { label: 'Par', render: cell => cell.hole.par },
    { label: 'Score', render: cell => <button type="button" className="scorecardScoreButton" aria-label={`${editable ? 'Editar' : 'Ver'} score del hoyo ${cell.hole.number}: ${cell.score ?? 'sin capturar'}, ${GOLF_RESULT_LABELS[cell.result]}`} onClick={() => editable ? setEditing(cell) : props.onHole(cell.hole.number, player!.id)}><GolfScoreSymbol score={cell.score} result={cell.result} /></button> },
    { label: 'Putts', render: cell => <Captured value={cell.putts} /> },
    ...(has('firstPuttDistanceFeet') ? [{ label: '1er putt · ft', render: (cell: ScorecardCell) => <Captured value={cell.stat.firstPuttDistanceFeet} /> }] : []),
    ...(has('fairwayHit') ? [{ label: 'FIR', render: (cell: ScorecardCell) => <Hit value={cell.fir} applicable={cell.hole.par !== 3} /> }] : []),
    ...(has('teeDirection') ? [{ label: 'Salida', render: (cell: ScorecardCell) => cell.stat.teeDirection ? <span title={directionLabels[cell.stat.teeDirection]} aria-label={directionLabels[cell.stat.teeDirection]}>{directionSymbols[cell.stat.teeDirection]}</span> : <Missing /> }] : []),
    ...(has('teeClub') ? [{ label: 'Bastón', render: (cell: ScorecardCell) => cell.stat.teeClub ? <span className="scorecardClub" title={cell.stat.teeClub} aria-label={cell.stat.teeClub}>{cell.stat.teeClub}</span> : <Missing /> }] : []),
    ...(has('greenInRegulation') ? [{ label: 'GIR', render: (cell: ScorecardCell) => <Hit value={cell.gir} /> }] : []),
    ...(has('penaltyStrokes') ? [{ label: 'Penalidades', render: (cell: ScorecardCell) => <Captured value={cell.stat.penaltyStrokes} /> }] : []),
    ...(has('outOfBounds') || has('outOfBoundsCount') ? [{ label: 'OB', render: (cell: ScorecardCell) => cell.stat.outOfBoundsCount ?? (cell.stat.outOfBounds === undefined ? '—' : Number(cell.stat.outOfBounds)) }] : []),
  ];
  const holeNumber = props.view.kind === 'hole' ? props.view.hole : null;
  const detail = cells.find(cell => cell.hole.number === holeNumber);
  const tee = props.assignments?.find(value => value.playerId === player?.id)?.teeName ?? props.course.teeName;
  const header = <header className="premiumCardHeader"><button type="button" aria-label={detail ? 'Volver a tarjeta' : 'Volver a ronda'} onClick={props.onBack}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7" /></svg></button><h1>{detail ? `Hoyo ${detail.hole.displayLabel ?? detail.hole.number}` : 'Tarjeta de golf'}</h1><span className="premiumCardStatus">{editable ? 'Editable' : 'Solo lectura'}</span></header>;
  const details: Array<[string, React.ReactNode]> = detail ? [
    ...(recordedNumber(detail.hole.strokeIndex, 1, 18) !== null ? [['Ventaja · SI', detail.hole.strokeIndex] as [string, React.ReactNode]] : []),
    ...(detail.hole.par === 3 ? [['FIR', 'No aplicable · par 3'] as [string, React.ReactNode]] : detail.fir !== null ? [['FIR', detail.fir ? 'Fairway' : 'Fairway fallado'] as [string, React.ReactNode]] : []),
    ...(detail.stat.teeDirection ? [['Salida', directionLabels[detail.stat.teeDirection]] as [string, React.ReactNode]] : []),
    ...(detail.gir !== null ? [['GIR', detail.gir ? 'Sí' : 'No'] as [string, React.ReactNode]] : []),
    ...(detail.stat.bunkerCount !== undefined ? [['Bunker', detail.stat.bunkerCount] as [string, React.ReactNode]] : []),
    ...(detail.stat.greenSideBunkerCount !== undefined ? [['Bunker de green', detail.stat.greenSideBunkerCount] as [string, React.ReactNode]] : []),
    ...(detail.stat.fairwayBunkerCount !== undefined ? [['Bunker de fairway', detail.stat.fairwayBunkerCount] as [string, React.ReactNode]] : []),
    ...(detail.stat.penaltyStrokes !== undefined ? [['Penalidades', detail.stat.penaltyStrokes] as [string, React.ReactNode]] : []),
    ...(detail.stat.penaltyAreaCount !== undefined ? [['Área de penalidad', detail.stat.penaltyAreaCount] as [string, React.ReactNode]] : []),
    ...(detail.stat.outOfBoundsCount !== undefined || detail.stat.outOfBounds !== undefined ? [['OB', detail.stat.outOfBoundsCount ?? Number(detail.stat.outOfBounds)] as [string, React.ReactNode]] : []),
    ...(detail.stat.teeClub ? [['Bastón de salida', detail.stat.teeClub] as [string, React.ReactNode]] : []),
    ...(detail.stat.teeDistance !== undefined ? [['Distancia de salida', `${detail.stat.teeDistance} yd`] as [string, React.ReactNode]] : []),
    ...(detail.stat.firstPuttDistanceFeet !== undefined ? [['Primer putt', `${detail.stat.firstPuttDistanceFeet} ft`] as [string, React.ReactNode]] : []),
  ] : [];
  return <section className="premiumScorecard" aria-label={detail ? `Detalle del hoyo ${detail.hole.number}` : 'Tarjeta de golf'}>
    {header}<div className={`premiumCardIdentity${detail ? ' premiumHoleIdentity' : ''}`}><div className="premiumIdentityText"><button type="button" className="premiumCourseName" title={props.course.name} aria-label={`Nombre completo del campo: ${props.course.name}`} aria-expanded={fullName} onClick={() => setFullName(value => !value)}><h2>{props.course.name}</h2></button><p>{dateLabel(props.date)}{tee ? <span title={tee}> · {tee}</span> : null}</p><span title={player?.name}>{player?.name ?? 'Jugador'}{props.lifecycle ? ` · ${lifecycleCopy[props.lifecycle]}` : ''}</span></div>
      {!detail && <div className="premiumScoreSummary" aria-label="Resultado de la tarjeta"><span>Score{summary.scored < summary.holes ? ' parcial' : ''}</span><strong>{summary.gross ?? '—'}</strong><small>{toParText(summary.toPar)} <span>vs. par</span></small></div>}
    </div>{fullName && <p className="premiumFullName">{props.course.name}{tee ? ` · ${tee}` : ''}</p>}
    <div hidden={Boolean(detail)}>
      {props.players.length > 1 && <label className="premiumPlayerSelect">Jugador<select aria-label="Jugador de la tarjeta" value={selected} onChange={event => { setSelected(event.target.value); setNotice(''); }}>{props.players.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>}
      <div className="premiumNineSelector" role="group" aria-label="Sección de tarjeta"><button type="button" aria-pressed={nine === 'front'} disabled={!front.length} onClick={() => setNine('front')}>Ida <span>1–9</span></button><button type="button" aria-pressed={nine === 'back'} disabled={!back.length} onClick={() => setNine('back')}>Vuelta <span>10–18</span></button></div>
      <div className="premiumCardHint"><span>{summary.scored}/{summary.holes} hoyos · Par {summary.par}</span><span>Desliza ↔ · Toca un hoyo</span></div>
      <div ref={scroll} key={scrollKey} className="premiumHoleScroll" tabIndex={0} role="region" aria-label={`Tarjeta ${nine === 'front' ? 'ida' : 'vuelta'}, desliza horizontalmente`} onScroll={event => { horizontalPositions.current.set(scrollKey, event.currentTarget.scrollLeft); }}>
        <table className="premiumHoleTable"><caption className="scorecardSrOnly">Resultados por hoyo de {player?.name}; score gross y estadísticas capturadas</caption><thead><tr><th scope="col">Hoyo</th>{visible.map(cell => <th scope="col" key={cell.hole.number}><button type="button" aria-label={`Ver detalle del hoyo ${cell.hole.number}`} onClick={() => props.onHole(cell.hole.number, player!.id)}>{cell.hole.displayLabel ?? cell.hole.number}</button></th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{visible.map(cell => <td key={cell.hole.number}>{row.render(cell)}</td>)}</tr>)}</tbody></table>
      </div>
      <section className="premiumTotals" aria-label="Resumen Ida Vuelta Total"><table><thead><tr><th scope="col">Resumen</th><th scope="col">Par</th><th scope="col">Score</th><th scope="col">+/−</th>{cells.some(cell => cell.putts !== null) && <th scope="col">Putts</th>}</tr></thead><tbody>{([['IDA / OUT', front], ['VUELTA / IN', back], ['TOTAL', cells]] as const).filter(([, values]) => values.length).map(([label, values]) => { const result = summarizeScorecard(values); return <tr key={label}><th scope="row">{label}</th><td>{result.par}</td><td><strong>{result.gross ?? '—'}</strong>{result.scored < result.holes && result.gross !== null && <span aria-label="Score parcial">*</span>}</td><td>{toParText(result.toPar)}</td>{cells.some(cell => cell.putts !== null) && <td title={`${result.putts.captured}/${result.putts.possible} hoyos con putts`}>{statTotal(result.putts)}</td>}</tr>; })}</tbody></table>
      {(has('fairwayHit') || has('greenInRegulation') || has('penaltyStrokes')) && <div className="premiumStatsTotals">{([['IDA', front], ['VUELTA', back], ['TOTAL', cells]] as const).filter(([, values]) => values.length).map(([label, values]) => { const result = summarizeScorecard(values); return <div key={label}><b>{label}</b>{has('fairwayHit') && <span>FIR <strong>{statTotal(result.fir, true)}</strong></span>}{has('greenInRegulation') && <span>GIR <strong>{statTotal(result.gir, true)}</strong></span>}{has('penaltyStrokes') && <span>Pen. <strong>{statTotal(result.penalties)}</strong></span>}</div>; })}</div>}
      <p>— Sin capturar · N/A No aplicable · 0 Capturado sin eventos.<br />* Captura parcial. FIR/GIR usan sólo los hoyos con dato registrado.</p></section>
      <div className="premiumScoreLegend" aria-label="Leyenda de resultados">{(['eagle','birdie','par','bogey','double'] as const).map((result, index) => <span key={result}><GolfScoreSymbol score={[2,3,4,5,6][index]} result={result} /><small>{GOLF_RESULT_LABELS[result]}</small></span>)}</div>
      {editable && <p className="premiumEditHint">Toca tu score para capturar o corregir el hoyo.</p>}
      {props.onRequestEdit && player?.id === props.ownerId && <button type="button" className="premiumEditAction" onClick={props.onRequestEdit}>Corregir ronda con el flujo autorizado</button>}
    </div>
    {detail && <><div className="premiumHoleResult"><GolfScoreSymbol score={detail.score} result={detail.result} /><div><strong>{GOLF_RESULT_LABELS[detail.result]}</strong><span>{detail.score === null ? 'Score sin capturar' : `${toParText(detail.score - detail.hole.par)} vs. par`}</span></div></div><dl className="premiumHolePrimary"><div><dt>Par</dt><dd>{detail.hole.par}</dd></div><div><dt>Distancia</dt><dd>{recordedNumber(detail.hole.yards, 1, 1500) === null ? <Missing /> : `${detail.hole.yards} yd`}</dd></div><div><dt>Putts</dt><dd>{detail.putts ?? <Missing />}</dd></div></dl>
      {details.length > 0 && <section className="premiumHoleAdvanced"><h2>Datos del hoyo</h2><dl className="premiumHoleFacts">{details.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>}
      {player?.accountUserId === props.accountUserId && detail.stat.notes && <p className="premiumHoleNote">{detail.stat.notes}</p>}
      {editable && <button type="button" className="premiumEditAction" onClick={() => setEditing(detail)}>Capturar este hoyo</button>}
      {props.holeMedia?.(detail.hole.number, player!.id)}
      {props.shots?.some(shot => shot.hole === detail.hole.number && shot.playerId === player?.id) ? <section className="premiumHoleShots"><h2>Golpes registrados</h2>{props.shots.filter(shot => shot.hole === detail.hole.number && shot.playerId === player?.id).sort((a,b) => a.sequence - b.sequence).map(shot => <p key={shot.id}><b>Golpe {shot.sequence}</b><span>{shot.clubLabel}{typeof shot.distanceYards === 'number' && Number.isFinite(shot.distanceYards) ? ` · ${Math.round(shot.distanceYards)} yd` : ''}</span></p>)}</section> : <p className="premiumHoleEmpty">Sin golpes registrados en este hoyo.</p>}
    </>}
    {notice && <p role="status" className="premiumSaveNotice">{notice}</p>}
    {editing && editable && <QuickHoleEditor key={`${props.roundId}:${player!.id}:${editing.hole.number}`} cell={editing} playerName={player!.name} clubs={props.clubs} onCancel={() => setEditing(null)} onSave={async draft => { await props.onSaveHole!(editing.hole.number, player!.id, draft); setEditing(null); setNotice(props.saveNotice?.(editing.hole.number) ?? `Hoyo ${editing.hole.number} guardado en este dispositivo. La sincronización usa tu conexión habitual.`); }} />}
  </section>;
}
