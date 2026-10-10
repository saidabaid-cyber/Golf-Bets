"use client";
import type { Player, RoundSnapshot } from "../../lib/types";
import type { SharedGroupFacts, SharedPlayerFacts } from "../../lib/shared-round-bet-capture";
import { counterCaptureQuantity, setCounterDistance, updateCounterBetKeeper } from "../../lib/side-bets";
import { roundCaptureFieldsForPlayer } from "../../lib/round-capture";
import { firstIncompleteRoundCapture } from "../../lib/round-completion";
import { BallFriendHolePanel, CounterBetHolePanel, LobaHolePanel } from "./side-bet-panels";

export function sharedPuttsRequired(round: RoundSnapshot, playerId: string, hole: number) {
  return Boolean(round.betConfig && roundCaptureFieldsForPlayer({ mode: "quick", playerId, playedHoleIndex: round.order?.indexOf(hole) ?? 0,
    bets: round.betConfig, supplementalBets: round.supplementalBets || [] }).includes("putts"));
}
export function sharedBetPending(round: RoundSnapshot) {
  if (!round.betConfig || round.presentation?.playMode === "score_only") return null;
  return firstIncompleteRoundCapture({ players: round.players || [], order: round.order || [], scores: round.scores || {}, bets: round.betConfig,
    segments: round.segments || [], supplementalBets: round.supplementalBets || [], putts: round.putts || {}, counterBetEvents: round.counterBetEvents || [],
    counterBetKeepers: round.counterBetKeepers || { vipers: {}, camels: {}, fish: {} }, lobaHoles: round.lobaHoles || {}, ballFriendSetup: round.ballFriendSetup || {} });
}

export function SharedPlayerBetCapture({ round, player, hole, draft, onChange }: { round: RoundSnapshot; player: Player; hole: number;
  draft?: SharedPlayerFacts; onChange: (next: SharedPlayerFacts) => void }) {
  const bets = round.betConfig;
  if (!bets || round.presentation?.playMode === "score_only") return null;
  const active = (key: "camels" | "fish" | "units" | "vipers") => bets[key].enabled && bets[key].participantIds.includes(player.id);
  const change = (key: keyof SharedPlayerFacts, value: string) => onChange({ ...draft, [key]: value === "" ? null : Number(value) });
  return <details><summary>Eventos de mis apuestas</summary><p>Guarda con tu score. Las unidades naturales se calculan automáticamente; aquí captura sólo las adicionales.</p>
    {(["camels", "fish"] as const).filter(active).map(key => <label key={key}>{key === "camels" ? "Entradas a bunker" : "Entradas al agua / área de penalidad"}<input aria-label={`${key === "camels" ? "Bunkers" : "Agua"} ${player.name} hoyo ${hole}`} type="number" inputMode="numeric" min={0} max={20}
      value={draft && Object.hasOwn(draft, key) ? draft[key] ?? "" : counterCaptureQuantity(round.counterBetEvents || [], key, hole, player.id) ?? ""} placeholder="0 si no ocurrió" onChange={e => change(key, e.target.value)} /></label>)}
    {active("units") && <label>Unidades manuales<input aria-label={`Unidades ${player.name} hoyo ${hole}`} type="number" inputMode="numeric" min={-100} max={100} value={draft && Object.hasOwn(draft, "units") ? draft.units ?? "" : round.unitEvents?.filter(e => e.hole === hole && e.playerId === player.id).reduce((sum, e) => sum + e.amount, 0) ?? ""} onChange={e => change("units", e.target.value)} /></label>}
    {active("vipers") && <label>Desempate de Víbora · centímetros<input aria-label={`Distancia Víbora ${player.name} hoyo ${hole}`} type="number" inputMode="decimal" min={0} max={100000} value={draft && Object.hasOwn(draft, "viperDistance") ? draft.viperDistance ?? "" : round.counterBetEvents?.find(e => e.kind === "vipers" && e.hole === hole && e.playerId === player.id)?.distanceToHole ?? ""} placeholder="Sólo si hay empate" onChange={e => change("viperDistance", e.target.value)} /></label>}
  </details>;
}

/** Existing group editors, visible to the organizer. Every change remains a
 * local draft until the same explicit save/outbox as the score is acknowledged. */
export function SharedGroupBetCapture({ round, hole, draft, onChange }: { round: RoundSnapshot; hole: number; draft?: SharedGroupFacts; onChange: (next: SharedGroupFacts) => void }) {
  const bets = round.betConfig, players = round.players || [], order = round.order || [];
  if (!bets || round.presentation?.playMode === "score_only") return null;
  const change = (patch: SharedGroupFacts) => onChange({ ...draft, ...patch });
  let events = round.counterBetEvents || [], keepers = round.counterBetKeepers || { vipers: {}, camels: {}, fish: {} };
  for (const d of draft?.counterDistances || []) events = setCounterDistance(events, "vipers", d.hole, d.playerId, d.distance);
  for (const k of draft?.keepers || []) keepers = updateCounterBetKeeper(keepers, k.kind, k.period, k.playerId, order);
  const external = round.personalBets?.filter(b => b.enabled !== false && b.rivalMode === "external") || [];
  const hasControls = bets.loba.enabled || bets.ballFriend.enabled || bets.foursome.enabled || external.length || [bets.vipers, bets.camels, bets.fish].some(b => b.enabled);
  if (!hasControls) return null;
  return <details><summary>Decisiones de apuestas · Organizador</summary><p>Se guardan en esta misma ronda; los demás jugadores conservan el control de sus scores.</p>
    <LobaHolePanel config={bets.loba} players={players} hole={hole} capture={draft?.loba || round.lobaHoles?.[hole] || { fireMultiplier: 1, unitCounts: {} }} onChange={loba => change({ loba })} showValidation />
    <BallFriendHolePanel config={bets.ballFriend} players={players} hole={hole} capture={draft?.ballFriend || round.ballFriendSetup?.[hole] || { teamA: [] }} onChange={ballFriend => change({ ballFriend })} showValidation />
    {bets.foursome.enabled && (draft?.segments || round.segments || []).map((s, index, segments) => <fieldset key={s.id}><legend>Foursome · H{order[s.startIndex]}–H{order[s.endIndex]}</legend><p>Pareja base</p>{players.filter(p => bets.foursome.participantIds.includes(p.id)).map(p => <label key={p.id}><input type="checkbox" checked={s.basePair.includes(p.id)} onChange={e => { const basePair = e.target.checked ? [...s.basePair, p.id].slice(-2) : s.basePair.filter(id => id !== p.id); change({ segments: segments.map((row, i) => i === index ? { ...row, basePair } : row) }); }} />{p.name}</label>)}</fieldset>)}
    {external.map(b => <label key={b.id}>Personal · Score de {b.rivalName} · H{hole}<input type="number" inputMode="numeric" min={1} max={20} value={draft?.externalScores && Object.hasOwn(draft.externalScores, b.id) ? draft.externalScores[b.id] ?? "" : b.externalScores?.[hole] ?? ""} onChange={e => change({ externalScores: { ...draft?.externalScores, [b.id]: e.target.value === "" ? null : Number(e.target.value) } })} /></label>)}
    {(["vipers", "camels", "fish"] as const).map(kind => <CounterBetHolePanel key={kind} resolutionOnly kind={kind} config={bets[kind]} players={players} events={events} hole={hole} order={order} keepers={keepers} onQuantity={() => undefined}
      onDistance={(eventHole, playerId, distance) => change({ counterDistances: [...(draft?.counterDistances || []).filter(d => d.hole !== eventHole || d.playerId !== playerId), { playerId, hole: eventHole, distance }] })}
      onKeeper={(playerId, period) => change({ keepers: [...(draft?.keepers || []).filter(k => k.kind !== kind || k.period !== period), { kind, playerId, period }] })} />)}
  </details>;
}
