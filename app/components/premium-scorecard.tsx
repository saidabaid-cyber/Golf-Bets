"use client";

import { useMemo, useState } from "react";
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
function Fir({ cell }: { cell: ScorecardCell }) {
  if (cell.hole.par === 3) return <span aria-label="FIR no aplica en par 3">—</span>;
  const direction = cell.stat.teeDirection;
  const label = cell.fir === true ? "Fairway" : direction === 'left' || direction === 'far_left' ? "Fallo a la izquierda" : direction === 'right' || direction === 'far_right' ? "Fallo a la derecha" : cell.fir === false ? "Fairway fallado" : "Sin capturar";
  return <span className="scorecardFact" data-hit={cell.fir === true} aria-label={label} title={label}>{cell.fir === true ? '✓' : label.includes('izquierda') ? '←' : label.includes('derecha') ? '→' : cell.fir === false ? '×' : '—'}</span>;
}
export function PremiumScorecard(props: PremiumScorecardProps & {
  view: Exclude<ScorecardView, { kind: "round" }>; onBack: () => void; onHole: (hole: number, player: string) => void;
}) {
  const [selected, setSelected] = useState(props.ownerId ?? props.players[0]?.id ?? '');
  const [nine, setNine] = useState<"front" | "back">(props.order.some(number => number <= 9) ? "front" : "back");
  const [position, setPosition] = useState(0), [editing, setEditing] = useState<ScorecardCell | null>(null), [notice, setNotice] = useState('');
  const playerId = props.view.kind === 'hole' ? props.view.playerId : selected;
  const player = props.players.find(value => value.id === playerId) ?? props.players[0];
  const cells = useMemo(() => player ? scorecardCells({ course: props.course, order: props.order, scores: props.scores, putts: props.putts, advancedStats: props.advancedStats, playerId: player.id }) : [], [props.course, props.order, props.scores, props.putts, props.advancedStats, player]);
  const summary = summarizeScorecard(cells);
  const front = cells.filter(cell => cell.hole.number <= 9), back = cells.filter(cell => cell.hole.number >= 10);
  const visible = nine === 'front' ? front : back;
  const editable = Boolean(player && props.access && props.onSaveHole && canQuickEditPlayer(props.access, player));
  const has = (key: keyof ScorecardCell['stat']) => cells.some(cell => cell.stat[key] !== undefined);
  const rows: Array<{ label: string; render: (cell: ScorecardCell) => React.ReactNode }> = [
    ...(cells.some(cell => recordedNumber(cell.hole.yards, 1, 1500) !== null) ? [{ label: 'Distancia · yd', render: (cell: ScorecardCell) => recordedNumber(cell.hole.yards, 1, 1500) ?? '—' }] : []),
    ...(cells.some(cell => recordedNumber(cell.hole.strokeIndex, 1, 18) !== null) ? [{ label: 'Ventaja · SI', render: (cell: ScorecardCell) => recordedNumber(cell.hole.strokeIndex, 1, 18) ?? '—' }] : []),
    { label: 'Par', render: cell => cell.hole.par },
    { label: 'Score', render: cell => <button type="button" className="scorecardScoreButton" aria-label={`${editable ? 'Editar' : 'Ver'} score del hoyo ${cell.hole.number}: ${cell.score ?? 'sin capturar'}, ${GOLF_RESULT_LABELS[cell.result]}`} onClick={() => editable ? setEditing(cell) : props.onHole(cell.hole.number, player!.id)}><GolfScoreSymbol score={cell.score} result={cell.result} /></button> },
    ...(cells.some(cell => cell.putts !== null) ? [{ label: 'Putts', render: (cell: ScorecardCell) => cell.putts ?? '—' }] : []),
    ...(has('firstPuttDistanceFeet') ? [{ label: '1er putt · ft', render: (cell: ScorecardCell) => cell.stat.firstPuttDistanceFeet ?? '—' }] : []),
    ...(has('fairwayHit') || has('teeDirection') ? [{ label: 'FIR', render: (cell: ScorecardCell) => <Fir cell={cell} /> }] : []),
    ...(has('teeClub') ? [{ label: 'Bastón', render: (cell: ScorecardCell) => cell.stat.teeClub ?? '—' }] : []),
    ...(has('greenInRegulation') ? [{ label: 'GIR', render: (cell: ScorecardCell) => <span aria-label={cell.gir === null ? 'Sin capturar' : cell.gir ? 'Green en regulación' : 'Green fallado'}>{cell.gir === null ? '—' : cell.gir ? '✓' : '×'}</span> }] : []),
    ...(has('penaltyStrokes') ? [{ label: 'Penalidades', render: (cell: ScorecardCell) => cell.stat.penaltyStrokes ?? '—' }] : []),
    ...(has('outOfBounds') || has('outOfBoundsCount') ? [{ label: 'OB', render: (cell: ScorecardCell) => cell.stat.outOfBoundsCount ?? (cell.stat.outOfBounds === undefined ? '—' : Number(cell.stat.outOfBounds)) }] : []),
  ];
  const holeNumber = props.view.kind === 'hole' ? props.view.hole : null;
  const detail = cells.find(cell => cell.hole.number === holeNumber);
  const tee = props.assignments?.find(value => value.playerId === player?.id)?.teeName ?? props.course.teeName;
  const header = <header className="premiumCardHeader"><button type="button" aria-label={detail ? 'Volver a tarjeta' : 'Volver a ronda'} onClick={props.onBack}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7" /></svg></button><h1>{detail ? `Hoyo ${detail.hole.displayLabel ?? detail.hole.number}` : 'Tarjeta de golf'}</h1><span className="premiumCardStatus">{editable ? 'Editable' : 'Solo lectura'}</span></header>;
  const details: Array<[string, React.ReactNode]> = detail ? [
    ['Par', detail.hole.par], ...(recordedNumber(detail.hole.yards, 1, 1500) !== null ? [['Distancia', `${detail.hole.yards} yd`] as [string, React.ReactNode]] : []), ['Ventaja · SI', recordedNumber(detail.hole.strokeIndex, 1, 18) ?? '—'],
    ['Putts', detail.putts ?? 'Sin capturar'], ...(detail.hole.par !== 3 && detail.fir !== null ? [['FIR', detail.fir ? 'Fairway' : 'Fairway fallado'] as [string, React.ReactNode]] : []),
    ...(detail.stat.teeDirection ? [['Salida', ({ far_left: 'Muy a la izquierda', left: 'Izquierda', center: 'Centro', right: 'Derecha', far_right: 'Muy a la derecha' })[detail.stat.teeDirection]] as [string, React.ReactNode]] : []),
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
    {header}<div className="premiumCardIdentity"><p>{dateLabel(props.date)}{props.lifecycle ? ` · ${lifecycleCopy[props.lifecycle]}` : ''}</p><h2>{props.course.name}</h2><span>{player?.name ?? 'Jugador'}{tee ? ` · ${tee}` : ''}</span></div>
    <div hidden={Boolean(detail)}><div className="premiumScoreSummary"><div><span>Score gross{summary.scored < summary.holes ? ' parcial' : ''}</span><strong>{summary.gross ?? '—'} <small>{toParText(summary.toPar)}</small></strong></div><p>Par {summary.par} <span>{summary.scored}/{summary.holes} hoyos registrados</span></p></div>
      {props.players.length > 1 && <label className="premiumPlayerSelect">Jugador<select aria-label="Jugador de la tarjeta" value={selected} onChange={event => { setSelected(event.target.value); setNotice(''); }}>{props.players.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>}
      <div className="premiumNineSelector" role="group" aria-label="Sección de tarjeta"><button type="button" aria-pressed={nine === 'front'} disabled={!front.length} onClick={() => { setNine('front'); setPosition(0); }}>Hoyos 1–9</button><button type="button" aria-pressed={nine === 'back'} disabled={!back.length} onClick={() => { setNine('back'); setPosition(0); }}>Hoyos 10–18</button></div>
      <div className="premiumCardHint"><span>Toca el hoyo para ver su detalle</span><span>Desliza ↔</span></div>
      <div key={nine} className="premiumHoleScroll" tabIndex={0} role="region" aria-label={`Tarjeta ${nine === 'front' ? 'ida' : 'vuelta'}, desliza horizontalmente`} onScroll={event => setPosition(Math.min(Math.max(0, visible.length - 1), Math.floor(event.currentTarget.scrollLeft / 60)))}>
        <table className="premiumHoleTable"><caption className="scorecardSrOnly">Resultados por hoyo de {player?.name}; score gross y estadísticas capturadas</caption><thead><tr><th scope="col">Hoyo</th>{visible.map(cell => <th scope="col" key={cell.hole.number}><button type="button" aria-label={`Ver detalle del hoyo ${cell.hole.number}`} onClick={() => props.onHole(cell.hole.number, player!.id)}>{cell.hole.displayLabel ?? cell.hole.number}</button></th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{visible.map(cell => <td key={cell.hole.number}>{row.render(cell)}</td>)}</tr>)}</tbody></table>
      </div><div className="premiumPosition" aria-label={`Posición: hoyo ${visible[position]?.hole.number ?? ''}`}><span>Hoyo {visible[position]?.hole.displayLabel ?? visible[position]?.hole.number} de {summary.holes}</span><div aria-hidden="true">{visible.map((cell, index) => <i key={cell.hole.number} data-current={index === position} />)}</div></div>
      <section className="premiumTotals" aria-label="Resumen Ida Vuelta Total"><table><thead><tr><th scope="col">Resumen</th><th scope="col">Par</th><th scope="col">Score</th><th scope="col">+/−</th>{cells.some(cell => cell.putts !== null) && <th scope="col">Putts</th>}</tr></thead><tbody>{([['IDA / OUT', front], ['VUELTA / IN', back], ['TOTAL', cells]] as const).filter(([, values]) => values.length).map(([label, values]) => { const result = summarizeScorecard(values); return <tr key={label}><th scope="row">{label}</th><td>{result.par}</td><td><strong>{result.gross ?? '—'}</strong>{result.scored < result.holes && result.gross !== null && <span aria-label="Score parcial">*</span>}</td><td>{toParText(result.toPar)}</td>{cells.some(cell => cell.putts !== null) && <td title={`${result.putts.captured}/${result.putts.possible} hoyos con putts`}>{statTotal(result.putts)}</td>}</tr>; })}</tbody></table>
      {(has('fairwayHit') || has('greenInRegulation') || has('penaltyStrokes')) && <div className="premiumStatsTotals">{([['IDA', front], ['VUELTA', back], ['TOTAL', cells]] as const).filter(([, values]) => values.length).map(([label, values]) => { const result = summarizeScorecard(values); return <div key={label}><b>{label}</b>{has('fairwayHit') && <span>FIR <strong>{statTotal(result.fir, true)}</strong></span>}{has('greenInRegulation') && <span>GIR <strong>{statTotal(result.gir, true)}</strong></span>}{has('penaltyStrokes') && <span>Pen. <strong>{statTotal(result.penalties)}</strong></span>}</div>; })}</div>}
      <p>* Captura parcial. FIR/GIR usan sólo los hoyos con dato registrado.</p></section>
      <div className="premiumScoreLegend" aria-label="Leyenda de resultados">{(['eagle','birdie','par','bogey','double'] as const).map((result, index) => <span key={result}><GolfScoreSymbol score={[2,3,4,5,6][index]} result={result} /><small>{GOLF_RESULT_LABELS[result]}</small></span>)}</div>
      {editable && <p className="premiumEditHint">Toca tu score para capturar o corregir el hoyo.</p>}
      {props.onRequestEdit && <button type="button" className="premiumEditAction" onClick={props.onRequestEdit}>Corregir ronda con el flujo autorizado</button>}
    </div>
    {detail && <><div className="premiumHoleResult"><GolfScoreSymbol score={detail.score} result={detail.result} /><div><strong>{GOLF_RESULT_LABELS[detail.result]}</strong><span>{detail.score === null ? 'Score sin capturar' : `${toParText(detail.score - detail.hole.par)} vs. par`}</span></div></div><dl className="premiumHoleFacts">{details.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {player?.accountUserId === props.accountUserId && detail.stat.notes && <p className="premiumHoleNote">{detail.stat.notes}</p>}
      {editable && <button type="button" className="premiumEditAction" onClick={() => setEditing(detail)}>Capturar este hoyo</button>}
      {props.holeMedia?.(detail.hole.number, player!.id)}
      {props.shots?.some(shot => shot.hole === detail.hole.number && shot.playerId === player?.id) ? <section className="premiumHoleShots"><h2>Golpes registrados</h2>{props.shots.filter(shot => shot.hole === detail.hole.number && shot.playerId === player?.id).sort((a,b) => a.sequence - b.sequence).map(shot => <p key={shot.id}><b>Golpe {shot.sequence}</b><span>{shot.clubLabel}{typeof shot.distanceYards === 'number' && Number.isFinite(shot.distanceYards) ? ` · ${Math.round(shot.distanceYards)} yd` : ''}</span></p>)}</section> : <div className="premiumHoleEmpty"><h2>Sin golpes registrados</h2><p>La tarjeta y la captura manual funcionan sin GPS.</p></div>}
    </>}
    {notice && <p role="status" className="premiumSaveNotice">{notice}</p>}
    {editing && editable && <QuickHoleEditor key={`${props.roundId}:${player!.id}:${editing.hole.number}`} cell={editing} playerName={player!.name} clubs={props.clubs} onCancel={() => setEditing(null)} onSave={async draft => { await props.onSaveHole!(editing.hole.number, player!.id, draft); setEditing(null); setNotice(`Hoyo ${editing.hole.number} guardado en este dispositivo. La sincronización usa tu conexión habitual.`); }} />}
  </section>;
}
