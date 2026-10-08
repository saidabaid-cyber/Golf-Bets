"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AdvancedStatsByHole, Course, Player, PlayerTeeAssignmentSnapshot, PuttsByHole, RoundLifecycleState, RoundShotSnapshot } from "../../lib/types";
import { canQuickEditPlayer, GOLF_RESULT_LABELS, recordedNumber, scorecardCells, summarizeScorecard, toParText, type GolfResult, type QuickEditAccess, type QuickHoleDraft, type RecordedTotal, type ScorecardCell } from "../../lib/premium-scorecard";
import type { ScoreRows } from "../../lib/score-capture";
import type { ScorecardView } from "../../lib/scorecard-view";
import { QuickHoleEditor } from "./quick-hole-editor";

export type PremiumScorecardProps = {
  roundId: string; course: Course; players: Player[]; order: number[]; scores: ScoreRows;
  originLabel?: string;
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
  const [nine, setNine] = useState<"front" | "back" | "all" | "total">(props.order.some(number => number <= 9) ? "front" : "back");
  const [expandedHole,setExpandedHole]=useState<{hole:number;playerId:string}|null>(null);
  const [editing, setEditing] = useState<ScorecardCell | null>(null), [notice, setNotice] = useState(''), [fullName, setFullName] = useState(false);
  const scroll = useRef<HTMLDivElement>(null), horizontalPositions = useRef(new Map<string, number>());
  const playerId = props.view.kind === 'hole' ? props.view.playerId : selected;
  const player = props.players.find(value => value.id === playerId) ?? props.players[0];
  const cells = useMemo(() => player ? scorecardCells({ course: props.course, order: props.order, scores: props.scores, putts: props.putts, advancedStats: props.advancedStats, playerId: player.id }) : [], [props.course, props.order, props.scores, props.putts, props.advancedStats, player]);
  const summary = summarizeScorecard(cells);
  const front = cells.filter(cell => cell.hole.number <= 9), back = cells.filter(cell => cell.hole.number >= 10);
  const visible = nine === 'total' ? [] : nine === 'all' ? cells : nine === 'front' ? front : back;
  const groups = ([['OUT', front], ['IN', back], ['TOTAL', cells]] as const).filter(([, values]) => values.length);
  const totals = nine === 'total' || nine === 'all' ? groups : [[nine === 'front' ? 'OUT' : 'IN', visible]] as const;
  const scrollKey = `${playerId}:${nine}`;
  useLayoutEffect(() => {
    if (props.view.kind === 'card' && scroll.current) scroll.current.scrollLeft = horizontalPositions.current.get(scrollKey) ?? 0;
  }, [scrollKey, props.view.kind]);
  const editable = Boolean(player && props.access && props.onSaveHole && canQuickEditPlayer(props.access, player));
  const has = (key: keyof ScorecardCell['stat']) => cells.some(cell => cell.stat[key] !== undefined);
  const countTotal = (values: readonly ScorecardCell[], key: keyof ScorecardCell['stat']) => {
    const known = values.map(cell => recordedNumber(cell.stat[key], 0, 50)).filter((value): value is number => value !== null);
    return statTotal({ value: known.length ? known.reduce((a, b) => a + b, 0) : null, captured: known.length, possible: values.length });
  };
  const rows: Array<{ label: string; render: (cell: ScorecardCell) => React.ReactNode; total?: (values: readonly ScorecardCell[]) => React.ReactNode }> = [
    ...(cells.some(cell => recordedNumber(cell.hole.yards, 1, 1500) !== null) ? [{ label: 'Distancia · yd', render: (cell: ScorecardCell) => <Captured value={recordedNumber(cell.hole.yards, 1, 1500)} />, total: (values: readonly ScorecardCell[]) => { const known = values.map(cell => recordedNumber(cell.hole.yards, 1, 1500)).filter((n): n is number => n !== null); return statTotal({ value: known.length ? known.reduce((a,b) => a+b,0) : null, captured: known.length, possible: values.length }); } }] : []),
    ...(cells.some(cell => recordedNumber(cell.hole.strokeIndex, 1, 18) !== null) ? [{ label: 'Stroke index', render: (cell: ScorecardCell) => <Captured value={recordedNumber(cell.hole.strokeIndex, 1, 18)} /> }] : []),
    { label: 'Par', render: cell => cell.hole.par, total: values => summarizeScorecard(values).par },
    { label: 'Score gross', render: cell => <button type="button" className="scorecardScoreButton" aria-label={`${editable ? 'Editar' : 'Ver'} score del hoyo ${cell.hole.number}: ${cell.score ?? 'sin capturar'}, ${GOLF_RESULT_LABELS[cell.result]}`} onClick={() => editable ? setEditing(cell) : props.onHole(cell.hole.number, player!.id)}><GolfScoreSymbol score={cell.score} result={cell.result} /></button>, total: values => { const result = summarizeScorecard(values); return <><strong>{result.gross ?? '—'}{result.gross !== null && result.scored < result.holes ? '*' : ''}</strong><small>{toParText(result.toPar)}</small></>; } },
    { label: 'Putts', render: cell => <Captured value={cell.putts} />, total: values => statTotal(summarizeScorecard(values).putts) },
    ...(has('firstPuttDistanceFeet') ? [{ label: '1er putt · ft', render: (cell: ScorecardCell) => <Captured value={cell.stat.firstPuttDistanceFeet} /> }] : []),
    ...(has('fairwayHit') || has('teeDirection') ? [{ label: 'FIR / Salida', render: (cell: ScorecardCell) => <span className="scorecardTeeFact"><Hit value={cell.fir} applicable={cell.hole.par !== 3} />{cell.stat.teeDirection && cell.stat.teeDirection !== 'center' ? <span title={directionLabels[cell.stat.teeDirection]} aria-label={directionLabels[cell.stat.teeDirection]}>{directionSymbols[cell.stat.teeDirection]}</span> : cell.fir === null && cell.stat.teeDirection === 'center' ? <span title="Salida al centro" aria-label="Salida al centro">↑</span> : null}</span>, total: (values: readonly ScorecardCell[]) => statTotal(summarizeScorecard(values).fir, true) }] : []),
    ...(has('teeClub') ? [{ label: 'Bastón', render: (cell: ScorecardCell) => cell.stat.teeClub ? <span className="scorecardClub" title={cell.stat.teeClub} aria-label={cell.stat.teeClub}>{cell.stat.teeClub}</span> : <Missing /> }] : []),
    ...(has('greenInRegulation') ? [{ label: 'GIR', render: (cell: ScorecardCell) => <Hit value={cell.gir} />, total: (values: readonly ScorecardCell[]) => statTotal(summarizeScorecard(values).gir, true) }] : []),
    ...(has('penaltyStrokes') ? [{ label: 'Penalidades', render: (cell: ScorecardCell) => <Captured value={cell.stat.penaltyStrokes} />, total: (values: readonly ScorecardCell[]) => statTotal(summarizeScorecard(values).penalties) }] : []),
    ...(has('outOfBounds') || has('outOfBoundsCount') ? [{ label: 'OB', render: (cell: ScorecardCell) => <Captured value={cell.stat.outOfBoundsCount ?? (cell.stat.outOfBounds === undefined ? undefined : Number(cell.stat.outOfBounds))} />, total: (values: readonly ScorecardCell[]) => { const known = values.map(cell => cell.stat.outOfBoundsCount ?? (cell.stat.outOfBounds === undefined ? null : Number(cell.stat.outOfBounds))); return statTotal({ value: known.some(n => n !== null) ? known.reduce<number>((a,b) => a+(b??0),0) : null, captured: known.filter(n => n !== null).length, possible: values.length }); } }] : []),
    ...(has('bunkerCount') ? [{ label: 'Bunker', render: (cell: ScorecardCell) => <Captured value={cell.stat.bunkerCount} />, total: (values: readonly ScorecardCell[]) => countTotal(values, 'bunkerCount') }] : []),
    ...(has('penaltyAreaCount') ? [{ label: 'Área penal.', render: (cell: ScorecardCell) => <Captured value={cell.stat.penaltyAreaCount} />, total: (values: readonly ScorecardCell[]) => countTotal(values, 'penaltyAreaCount') }] : []),
  ];
  const holeNumber = props.view.kind === 'hole' ? props.view.hole : null;
  const detail = cells.find(cell => cell.hole.number === holeNumber);
  const inlineDetail=expandedHole?.playerId===playerId?cells.find(cell=>cell.hole.number===expandedHole.hole):undefined;
  const factCell=detail??inlineDetail;
  const tee = props.assignments?.find(value => value.playerId === player?.id)?.teeName ?? props.course.teeName;
  const header = <header className="premiumCardHeader"><button type="button" aria-label={detail ? 'Volver a tarjeta' : `Volver a ${props.originLabel ?? 'ronda'}`} onClick={props.onBack}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7" /></svg></button><h1>{detail ? `Hoyo ${detail.hole.displayLabel ?? detail.hole.number}` : 'Tarjeta de golf'}</h1><span className="premiumCardStatus">{editable ? 'Editable' : 'Solo lectura'}</span></header>;
  const details: Array<[string, React.ReactNode]> = factCell ? [
    ...(recordedNumber(factCell.hole.strokeIndex, 1, 18) !== null ? [['Ventaja · SI', factCell.hole.strokeIndex] as [string, React.ReactNode]] : []),
    ...(factCell.hole.par === 3 ? [['FIR', 'No aplicable · par 3'] as [string, React.ReactNode]] : factCell.fir !== null ? [['FIR', factCell.fir ? 'Fairway' : 'Fairway fallado'] as [string, React.ReactNode]] : []),
    ...(factCell.stat.teeDirection ? [['Salida', directionLabels[factCell.stat.teeDirection]] as [string, React.ReactNode]] : []),
    ...(factCell.stat.landingLie ? [['Posición de bola', { fairway: 'Fairway', rough: 'Rough', bunker: 'Bunker', water_ob: 'Agua / OB' }[factCell.stat.landingLie]] as [string, React.ReactNode]] : []),
    ...(factCell.gir !== null ? [['GIR', factCell.gir ? 'Sí' : 'No'] as [string, React.ReactNode]] : []),
    ...(factCell.stat.bunkerCount !== undefined ? [['Bunker', factCell.stat.bunkerCount] as [string, React.ReactNode]] : []),
    ...(factCell.stat.greenSideBunkerCount !== undefined ? [['Bunker de green', factCell.stat.greenSideBunkerCount] as [string, React.ReactNode]] : []),
    ...(factCell.stat.fairwayBunkerCount !== undefined ? [['Bunker de fairway', factCell.stat.fairwayBunkerCount] as [string, React.ReactNode]] : []),
    ...(factCell.stat.penaltyStrokes !== undefined ? [['Penalidades', factCell.stat.penaltyStrokes] as [string, React.ReactNode]] : []),
    ...(factCell.stat.penaltyAreaCount !== undefined ? [['Área de penalidad', factCell.stat.penaltyAreaCount] as [string, React.ReactNode]] : []),
    ...(factCell.stat.outOfBoundsCount !== undefined || factCell.stat.outOfBounds !== undefined ? [['OB', factCell.stat.outOfBoundsCount ?? Number(factCell.stat.outOfBounds)] as [string, React.ReactNode]] : []),
    ...(factCell.stat.teeClub ? [['Bastón de salida', factCell.stat.teeClub] as [string, React.ReactNode]] : []),
    ...(factCell.stat.teeDistance !== undefined ? [['Distancia de salida', `${factCell.stat.teeDistance} yd`] as [string, React.ReactNode]] : []),
    ...(factCell.stat.firstPuttDistanceFeet !== undefined ? [['Primer putt', `${factCell.stat.firstPuttDistanceFeet} ft`] as [string, React.ReactNode]] : []),
  ] : [];
  return <section className="premiumScorecard" aria-label={detail ? `Detalle del hoyo ${detail.hole.number}` : 'Tarjeta de golf'}>
    {header}<div className={`premiumCardIdentity${detail ? ' premiumHoleIdentity' : ''}`}><div className="premiumIdentityText"><button type="button" className="premiumCourseName" title={props.course.name} aria-label={`Nombre completo del campo: ${props.course.name}`} aria-expanded={fullName} onClick={() => setFullName(value => !value)}><h2>{props.course.name}</h2></button><p>{dateLabel(props.date)}{tee ? <span title={tee}> · {tee}</span> : null}</p><span title={player?.name}>{player?.name ?? 'Jugador'}{props.lifecycle ? ` · ${lifecycleCopy[props.lifecycle]}` : ''}</span></div>
      {!detail && <div className="premiumScoreSummary" aria-label="Resultado de la tarjeta"><span>Score{summary.scored < summary.holes ? ' parcial' : ''}</span><strong>{summary.gross ?? '—'}</strong><small>{toParText(summary.toPar)} <span>vs. par</span></small></div>}
    </div>{fullName && <p className="premiumFullName">{props.course.name}{tee ? ` · ${tee}` : ''}</p>}
    <div hidden={Boolean(detail)}>
      {props.players.length > 1 && <label className="premiumPlayerSelect">Jugador<select aria-label="Jugador de la tarjeta" value={selected} onChange={event => { setSelected(event.target.value); setNotice(''); }}>{props.players.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>}
      <div className="premiumNineSelector" role="group" aria-label="Sección de tarjeta">{([['front', 'Ida / OUT', front], ['back', 'Vuelta / IN', back], ['all', cells.length > 9 ? '18 HOYOS' : '9 HOYOS', cells], ['total', 'TOTAL', cells]] as const).map(([key, label, values]) => { const result = summarizeScorecard(values); return <button type="button" key={key} aria-pressed={nine === key} disabled={!values.length} onClick={() => setNine(key)}>{label}<span>{result.gross ?? '—'} · {toParText(result.toPar)}{result.scored < result.holes && result.gross !== null ? '*' : ''}</span></button>; })}</div>
      <div className="premiumCardHint"><span>{summary.scored}/{summary.holes} hoyos · Par {summary.par}</span><span>Desliza ↔ · Toca un hoyo</span></div>
      <div ref={scroll} key={scrollKey} className={`premiumHoleScroll${nine === 'total' ? ' premiumTotalGrid' : ''}`} tabIndex={0} role="region" aria-label={`Tarjeta ${nine === 'total' ? 'totales OUT IN TOTAL' : nine === 'all' ? '18 hoyos' : nine === 'front' ? 'ida' : 'vuelta'}, desliza horizontalmente`} onScroll={event => { horizontalPositions.current.set(scrollKey, event.currentTarget.scrollLeft); }}>
        <table className="premiumHoleTable"><caption className="scorecardSrOnly">Resultados por hoyo de {player?.name}; score gross y estadísticas capturadas. Ida 1–9, Vuelta 10–18.</caption><thead><tr><th scope="col">Hoyo</th>{visible.map(cell => <th scope="col" key={cell.hole.number}><button type="button" aria-label={`Ver detalle del hoyo ${cell.hole.number}`} aria-expanded={inlineDetail?.hole.number===cell.hole.number} onClick={() => setExpandedHole({hole:cell.hole.number,playerId:player!.id})}>{cell.hole.displayLabel ?? cell.hole.number}</button></th>)}{totals.map(([label]) => <th scope="col" className="scorecardAggregate" key={label}>{label}</th>)}</tr></thead><tbody>{rows.filter(row => nine !== 'total' || row.total).map(row => <tr key={row.label}><th scope="row">{row.label}</th>{visible.map(cell => <td key={cell.hole.number}>{row.render(cell)}</td>)}{totals.map(([label, values]) => <td key={label} className="scorecardAggregate">{row.total?.(values) ?? <span aria-label="No se suma">—</span>}</td>)}</tr>)}</tbody></table>
      </div>
      <button type="button" className="premiumHoleDetailsToggle" aria-expanded={Boolean(inlineDetail)} onClick={()=>setExpandedHole(inlineDetail?null:visible[0]?{hole:visible[0].hole.number,playerId:player!.id}:cells[0]?{hole:cells[0].hole.number,playerId:player!.id}:null)}>Detalles del hoyo{inlineDetail?` ${inlineDetail.hole.number}`:''}<span aria-hidden="true">{inlineDetail?'⌃':'⌄'}</span></button>
      {inlineDetail&&<section className="premiumInlineHole" aria-label={`Detalles desplegados del hoyo ${inlineDetail.hole.number}`}><header><h2>Hoyo {inlineDetail.hole.displayLabel??inlineDetail.hole.number}</h2><button type="button" aria-label="Cerrar detalles del hoyo" onClick={()=>setExpandedHole(null)}>×</button></header>
        <div className="premiumHoleResult"><GolfScoreSymbol score={inlineDetail.score} result={inlineDetail.result}/><div><strong>{GOLF_RESULT_LABELS[inlineDetail.result]}</strong><span>{inlineDetail.score===null?'Score sin capturar':`${toParText(inlineDetail.score-inlineDetail.hole.par)} vs. par`}</span></div></div>
        <dl className="premiumHolePrimary"><div><dt>Par</dt><dd>{inlineDetail.hole.par}</dd></div>{recordedNumber(inlineDetail.hole.yards,1,1500)!==null&&<div><dt>Distancia</dt><dd>{inlineDetail.hole.yards} yd</dd></div>}{inlineDetail.putts!==null&&<div><dt>Putts</dt><dd>{inlineDetail.putts}</dd></div>}</dl>
        {inlineDetail.stat.teeDirection&&<div className="premiumTeeDirection" aria-label="Dirección de salida registrada">{(['left','center','right'] as const).map(direction=><span key={direction} data-selected={inlineDetail.stat.teeDirection===direction||inlineDetail.stat.teeDirection===`far_${direction}`}>{directionLabels[direction]}</span>)}</div>}
        {details.length>0&&<dl className="premiumHoleFacts">{details.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
        {props.shots?.some(shot=>shot.hole===inlineDetail.hole.number&&shot.playerId===player?.id)&&<section className="premiumHoleShots"><h3>Golpes registrados</h3>{props.shots.filter(shot=>shot.hole===inlineDetail.hole.number&&shot.playerId===player?.id).sort((a,b)=>a.sequence-b.sequence).map(shot=><p key={shot.id}><b>Golpe {shot.sequence}</b><span>{shot.clubLabel}{typeof shot.distanceYards==='number'&&Number.isFinite(shot.distanceYards)?` · ${Math.round(shot.distanceYards)} yd`:''}</span></p>)}</section>}
        <button type="button" className="premiumDetailLink" onClick={()=>props.onHole(inlineDetail.hole.number,player!.id)}>Ver detalle completo ›</button>
        {editable&&<button type="button" className="premiumDetailLink" onClick={()=>setEditing(inlineDetail)}>Capturar este hoyo ›</button>}
      </section>}
      <p className="premiumDataNote">— Sin capturar · N/A No aplicable · 0 Capturado.<br />* Total parcial. FIR/GIR: aciertos sobre hoyos capturados.</p>
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
