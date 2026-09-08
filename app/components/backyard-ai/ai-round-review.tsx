"use client";

import type { SupplementalBet } from "../../../lib/types";
import type { RoundSetupQuestion } from "../../../lib/backyard-ai/schemas/actions";
import type { RoundSetupDraft, RoundSetupDraftIssue } from "../../../lib/backyard-ai/schemas/round-setup";
import { groupNassauReviewItems } from "../../../lib/backyard-ai/round-review/group-nassau";
import styles from "./backyard-ai.module.css";

export type AiRoundReviewProps = {
  draft: RoundSetupDraft;
  questions: RoundSetupQuestion[];
  issues: RoundSetupDraftIssue[];
  canConfirm: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onConversationalChange: () => void;
  onResolveQuestion: (question: RoundSetupQuestion) => void;
  onManualEdit: () => void;
};

function money(value: number) {
  return `$${Math.round(value).toLocaleString("es-MX")}`;
}

function supplementalLabel(bet: SupplementalBet) {
  return ({
    individual_nassau: "Nassau individual",
    dollar_stroke: "Dollar a Stroke",
    individual_pressures: "Presiones individuales",
    team_pressures: "Presiones por parejas",
    chicago: "Chicago",
    vegas: "Vegas",
    minimum_putts: "Menos Putts",
  } as const)[bet.type];
}

type BetReview = { id: string; title: string; detail: string };

function roundingLabel(value: string | undefined) {
  return ({ partial: "decimales parciales", round: "redondeo entero", decimal: "decimales", half_up: ".5 sube", half_down: ".5 baja", six_up: ".6 sube", four_down: ".4 baja" } as Record<string, string>)[value || ""] || "redondeo heredado";
}

function participants(draft: RoundSetupDraft, participantIds: readonly string[]) {
  const selected = new Set(participantIds);
  const selectedNames = draft.players.filter((player) => selected.has(player.id)).map((player) => player.name);
  const excludedNames = draft.players.filter((player) => !selected.has(player.id)).map((player) => player.name);
  if (!selectedNames.length) return "Sin participantes";
  if (!excludedNames.length) return "Todos";
  if (excludedNames.length <= selectedNames.length) return `Todos menos ${excludedNames.join(", ")}`;
  return selectedNames.join(", ");
}

function hcpDetail(hcpPct: number | undefined, decimals?: string) {
  return [`HCP ${hcpPct ?? 100}%`, decimals ? roundingLabel(decimals) : ""].filter(Boolean).join(" · ");
}

function componentNames(components: Record<string, boolean>) {
  const labels: Record<string, string> = { match1: "Match ida", medal1: "Medal ida", match2: "Match vuelta", medal2: "Medal vuelta", match18: "Match 18", medal18: "Medal 18" };
  return Object.entries(components).filter(([, enabled]) => enabled).map(([key]) => labels[key] || key).join(", ") || "Sin componentes";
}

function pairNames(draft: RoundSetupDraft, ids: readonly string[]) {
  const names = new Map(draft.players.map((player) => [player.id, player.name]));
  return ids.map((id) => names.get(id) || "Jugador").join("/");
}

function activeBetReviews(draft: RoundSetupDraft) {
  const reviews: BetReview[] = [];
  const add = (id: string, title: string, detail: string) => reviews.push({ id, title, detail });
  const core = (id: string, enabled: boolean | undefined, label: string, value: number, participantIds: string[], extras: string[]) => {
    if (enabled) add(id, `${label} · ${money(value)} · ${participants(draft, participantIds)}`, extras.filter(Boolean).join(" · "));
  };
  core("rabbits", draft.bets.rabbits.enabled, "Conejos", draft.bets.rabbits.value, draft.bets.rabbits.participantIds, [draft.bets.rabbits.mode === "three_hole_blocks" ? "Bloques de 3" : "Continuo", hcpDetail(draft.bets.rabbits.hcpPct, draft.bets.rabbits.decimals)]);
  core("skins", draft.bets.skins.enabled, "Skins", draft.bets.skins.value, draft.bets.skins.participantIds, [draft.bets.skins.mode === "no_carry" || draft.bets.skins.accumulate === false ? "Sin carry" : "Carry", hcpDetail(draft.bets.skins.hcpPct, draft.bets.skins.decimals)]);
  core("units", draft.bets.units.enabled, "Unidades", draft.bets.units.value, draft.bets.units.participantIds, [`Copa ${money(draft.bets.units.copaValue ?? draft.bets.units.value)}`]);
  if (draft.bets.monkey?.enabled) core("monkey", true, "Monkey", draft.bets.monkey.value, draft.bets.monkey.participantIds, [`HCP ${draft.bets.monkey.hcpPct ?? 100}%`]);
  if (draft.bets.foursome.enabled) {
    const mode = draft.bets.foursome.mode === "points" ? `Puntos ${money(draft.bets.foursome.pointValue)}` : draft.bets.foursome.mode === "fixed_points" ? `Fijo ${money(draft.bets.foursome.fixedValue)} + puntos ${money(draft.bets.foursome.pointValue)}` : `Fijo ${money(draft.bets.foursome.fixedValue)}`;
    const segmentPairs = draft.segments.map((segment) => `H${segment.startIndex + 1}–H${segment.endIndex + 1}: ${pairNames(draft, segment.basePair)}`).join(" · ");
    const pressure = (draft.bets.foursome.pressureMultiplier ?? 1) > 1 ? `Presión ${draft.bets.foursome.pressureMultiplier}x` : "Sin presión";
    add("foursome", `Foursome · ${mode} · ${participants(draft, draft.bets.foursome.participantIds)}`, [`Segmentos de ${draft.bets.foursome.segmentSize}`, segmentPairs, hcpDetail(draft.bets.foursome.hcpPct, draft.bets.foursome.decimals), draft.bets.foursome.baseMode === "moving" ? "Base móvil" : "Base fija", pressure].filter(Boolean).join(" · "));
  }
  if (draft.bets.ballFriend.enabled) {
    const pairings = [...new Set(Object.entries(draft.ballFriendSetup).map(([hole, setup]) => `H${hole}: ${pairNames(draft, setup.teamA)}${setup.restPlayerId ? ` · descansa ${pairNames(draft, [setup.restPlayerId])}` : ""}`))];
    add("ball-friend", `Bola Amiga · ${money(draft.bets.ballFriend.value)} · ${participants(draft, draft.bets.ballFriend.participantIds)}`, [pairings.slice(0, 4).join(" · "), pairings.length > 4 ? `${pairings.length} rotaciones configuradas` : "", hcpDetail(draft.bets.ballFriend.hcpPct, draft.bets.ballFriend.decimals), draft.bets.ballFriend.baseMode === "moving" ? "Base móvil" : "Base fija", `Máximo ${draft.bets.ballFriend.maxScore}`].filter(Boolean).join(" · "));
  }
  const pollaComponents = [
    ["polla-first", "Polla · primera vuelta", draft.bets.polla.first9],
    ["polla-second", "Polla · segunda vuelta", draft.bets.polla.second9],
    ["polla-total", "Polla · total 18", draft.bets.polla.total18],
  ] as const;
  if (draft.presentation?.groupNassauTerm === "nassau") {
    for (const item of groupNassauReviewItems(draft.bets.polla)) {
      const collapsed = item.id === "nassau";
      add(
        item.id,
        `${item.label} · ${money(item.config.value)}${collapsed ? "" : ` · ${participants(draft, item.config.participantIds)}`}`,
        [collapsed ? item.componentLabels.join(" · ") : "", collapsed ? participants(draft, item.config.participantIds) : "", hcpDetail(item.config.hcpPct, item.config.decimals)].filter(Boolean).join(" · "),
      );
    }
  } else {
    for (const [id, label, config] of pollaComponents) if (config.enabled) add(id, `${label} · ${money(config.value)} · ${participants(draft, config.participantIds)}`, hcpDetail(config.hcpPct, config.decimals));
  }
  core("mini-polla", draft.bets.miniPolla.enabled, "Mini Polla", draft.bets.miniPolla.value, draft.bets.miniPolla.participantIds, [hcpDetail(draft.bets.miniPolla.hcpPct, draft.bets.miniPolla.decimals)]);
  for (const [id, label, config] of [
    ["vipers", "Viboritas", draft.bets.vipers],
    ["camels", "Camellos", draft.bets.camels],
    ["fish", "Peces", draft.bets.fish],
  ] as const) if (config.enabled) add(id, `${label} · ${money(config.value)} · ${participants(draft, config.participantIds)}`, [`Por vueltas`, config.secondNinePressed ? `Segunda vuelta presionada ${config.secondNineMultiplier ?? 2}x` : "Sin presión en segunda vuelta"].join(" · "));
  if (draft.bets.loba.enabled) add("loba", `Loba · ${money(draft.bets.loba.value)} · ${participants(draft, draft.bets.loba.participantIds)}`, [`HCP ${draft.bets.loba.hcpPct ?? 100}%`, draft.bets.loba.unitsEnabled ? `Unidades ${money(draft.bets.loba.unitValue)}${draft.bets.loba.duplicateUnitsByMode ? " · duplican por modalidad" : ""}` : "Sin unidades"].join(" · "));

  for (const bet of draft.personalBets.filter((candidate) => candidate.enabled !== false)) {
    const advantage = bet.advantageReceiver === "none" || !bet.advantageStrokes ? "Sin golpes pactados" : `${bet.advantageReceiver === "owner" ? "Principal" : bet.rivalName} recibe ${bet.advantageStrokes}`;
    add(`personal-${bet.id}`, `Personal · ${bet.rivalName} · ${money(bet.baseValue)}`, [advantage, componentNames(bet.components), bet.carryEnabled ? "Carry" : "Sin carry", (bet.pressureMultiplier ?? 1) > 1 ? `Presión ${bet.pressureMultiplier}x` : "Sin presión"].join(" · "));
  }
  for (const bet of draft.supplementalBets.filter((candidate) => candidate.enabled)) {
    if (bet.type === "individual_nassau") add(`supplemental-${bet.id}`, `${supplementalLabel(bet)} · ${pairNames(draft, [bet.playerAId, bet.playerBId])} · ${money(bet.value)}`, [`Ventaja ${bet.advantageStrokes || 0}`, componentNames(bet.components), bet.carryEnabled ? "Carry" : "Sin carry"].join(" · "));
    else if (bet.type === "dollar_stroke") add(`supplemental-${bet.id}`, `${supplementalLabel(bet)} · ${pairNames(draft, [bet.playerAId, bet.playerBId])} · ${money(bet.valuePerStroke)}/golpe`, `Ventaja ${bet.advantageStrokes || 0}`);
    else if (bet.type === "individual_pressures") add(`supplemental-${bet.id}`, `${supplementalLabel(bet)} · ${money(bet.value)} · ${participants(draft, bet.participantIds)}`, [hcpDetail(bet.hcpPct, bet.decimals), bet.carryEnabled ? "Carry" : "Sin carry", bet.matchPlayEnabled ? "Match Play adicional" : "Sin Match Play adicional"].join(" · "));
    else if (bet.type === "team_pressures") add(`supplemental-${bet.id}`, `${supplementalLabel(bet)} · ${money(bet.value)} · ${participants(draft, bet.participantIds)}`, [`${pairNames(draft, bet.teamA)} vs ${pairNames(draft, bet.participantIds.filter((id) => !bet.teamA.includes(id)))}`, bet.virtualMode === "standard" ? (bet.metric === "low_high" ? "Low + High" : bet.metric === "low" ? "Low" : "High") : bet.virtualMode === "mudo" ? "Mudo" : "Yo-Yo", hcpDetail(bet.hcpPct, bet.decimals), bet.carryEnabled ? "Carry" : "Sin carry", bet.abandonedPlayerIds?.length ? `Retirados: ${pairNames(draft, bet.abandonedPlayerIds)} · máximo ${bet.abandonedMaxScore}` : ""].filter(Boolean).join(" · "));
    else if (bet.type === "chicago") add(`supplemental-${bet.id}`, `${supplementalLabel(bet)} · ${money(bet.valuePerPoint)}/punto · ${participants(draft, bet.participantIds)}`, [`Cuota ${bet.quotaBase} · HCP ${bet.hcpPct ?? 100}%`, `Birdie+ ${bet.points.birdieOrBetter} · Par ${bet.points.par} · Bogey ${bet.points.bogey} · Doble+ ${bet.points.doubleBogeyOrWorse}`].join(" · "));
    else if (bet.type === "vegas") add(`supplemental-${bet.id}`, `${supplementalLabel(bet)} · ${money(bet.valuePerUnit)}/unidad · ${participants(draft, bet.participantIds)}`, [`${pairNames(draft, bet.teamA)} vs ${pairNames(draft, bet.participantIds.filter((id) => !bet.teamA.includes(id)))}`, hcpDetail(bet.hcpPct, bet.decimals), bet.rotation === "fixed" ? "Parejas fijas" : bet.rotation === "each_hole" ? "Rotación por hoyo" : `Rotación cada ${bet.blockSize}`, bet.birdiePenalty ? "Penalización Birdie/Bogey" : "Sin penalización Birdie/Bogey"].join(" · "));
    else if (bet.type === "minimum_putts") add(`supplemental-${bet.id}`, `${supplementalLabel(bet)} · ante ${money(bet.ante)} · ${participants(draft, bet.participantIds)}`, `${bet.holes} hoyos`);
  }
  for (const bet of draft.manualBets.filter((candidate) => candidate.enabled !== false)) {
    const sum = Object.values(bet.amounts).reduce((total, value) => total + value, 0);
    add(`manual-${bet.id}`, `${bet.name} · manual`, Math.abs(sum) < 0.001 ? "Ledger en suma cero" : "Ledger pendiente de cuadrar");
  }
  return reviews;
}

function teamSummary(draft: RoundSetupDraft) {
  const names = new Map(draft.players.map((player) => [player.id, player.name]));
  const setup = Object.values(draft.ballFriendSetup)[0];
  if (draft.bets.ballFriend.enabled && setup?.teamA.length) {
    const teamA = setup.teamA.map((id) => names.get(id) || "Jugador").join(" / ");
    const teamB = draft.bets.ballFriend.participantIds.filter((id) => !setup.teamA.includes(id)).map((id) => names.get(id) || "Jugador").join(" / ");
    return `${teamA} vs ${teamB || "resto del grupo"}`;
  }
  if (draft.bets.foursome.enabled && draft.segments[0]?.basePair.length) {
    return `Pareja base: ${draft.segments[0].basePair.map((id) => names.get(id) || "Jugador").join(" / ")}`;
  }
  return "Sin equipos fijos";
}

function missingItems(draft: RoundSetupDraft, questions: RoundSetupQuestion[], issues: RoundSetupDraftIssue[]) {
  const items = new Map<string, { label: string; detail: string; question?: RoundSetupQuestion }>();
  const add = (key: string, label: string, detail: string, question?: RoundSetupQuestion) => { if (!items.has(key)) items.set(key, { label, detail, question }); };
  for (const question of questions) {
    if (question.field === "course.tee") add("tee", "Tee", question.prompt, question);
    else if (question.field === "course") add("course", "Campo", question.prompt, question);
    else if (question.field === "players.handicaps" && question.playerTargets?.length) {
      question.playerTargets.forEach((player) => add(`hcp:${player.id}`, `${player.label} HCP`, question.prompt, question));
    } else if (question.field === "players") add("players", "Jugadores", question.prompt, question);
    else add(`question:${question.field}`, question.prompt, "Respóndelo en la conversación.", question);
  }
  for (const issue of issues) {
    if (issue.code === "round-course") add("course", "Campo", issue.message);
    else if (issue.code === "round-tee") add("tee", "Tee", issue.message);
    else if (issue.code === "active-bet-handicaps" && [...items.keys()].some((key) => key.startsWith("hcp:"))) continue;
    else add(`issue:${issue.code}`, issue.message, "También puedes resolverlo en la edición manual.");
  }
  if (!draft.players.length) add("players", "Jugadores", "Agrega los participantes de la ronda.");
  return [...items.values()];
}

export function AiRoundReview({ draft, questions, issues, canConfirm, busy, onConfirm, onConversationalChange, onResolveQuestion, onManualEdit }: AiRoundReviewProps) {
  const bets = activeBetReviews(draft);
  const pending = missingItems(draft, questions, issues);
  const courseName = draft.course?.name ?? draft.courseIdentity?.name;
  const readiness = canConfirm ? "LISTO" : courseName && draft.players.length && pending.every((item) => item.label === "Tee" || item.label.endsWith(" HCP")) ? "CASI LISTO" : "FALTA INFORMACIÓN";
  return <section className={`card ${styles.review}`} aria-labelledby="ai-round-review-title">
    <header className={styles.reviewHeader}>
      <div><span className="eyebrow">REVISA Y CONFIRMA</span><h2 id="ai-round-review-title">TU RONDA</h2></div>
      <span className={styles.confidence} data-ready={canConfirm}>{readiness}</span>
    </header>
    <div className={styles.reviewGrid}>
      <div className={styles.reviewItem}><span>Campo</span><strong>{courseName || "Por confirmar"}</strong><small>{draft.courseSelected && draft.course?.teeName ? draft.course.teeName : "Tee por confirmar"}</small></div>
      <div className={styles.reviewItem}><span>Fecha y salida</span><strong>{draft.date}</strong><small>{draft.roundHoles} hoyos · salida por el {draft.startHole}</small></div>
      <div className={styles.reviewItem} data-wide="true"><span>Jugadores</span><strong>{draft.players.map((player) => player.name).join(" · ") || "Por confirmar"}</strong><small>{draft.players.map((player) => `${player.name}: HCP ${player.handicap ?? "—"}`).join(" · ")}</small></div>
      <div className={styles.reviewItem}><span>Ventajas</span><strong>{draft.handicapBasis === "relative" ? "Entre jugadores" : "Sobre campo"}</strong><small>El motor conserva el HCP de cada modalidad.</small></div>
      <div className={styles.reviewItem}><span>Equipos</span><strong>{teamSummary(draft)}</strong><small>Editable antes de iniciar.</small></div>
      <div className={styles.reviewItem} data-wide="true"><span>Apuestas, montos y configuración</span>{bets.length ? <div className={styles.betReviewList}>{bets.map((bet) => <div className={styles.betReviewRow} key={bet.id}><strong>{bet.title}</strong><small>{bet.detail}</small></div>)}</div> : <strong>Sólo score</strong>}<small>{bets.length ? "Los cálculos se harán únicamente con el motor determinista." : "No se activó ninguna apuesta."}</small></div>
    </div>
    {pending.length > 0 && <div className={styles.missingList} role="alert"><b>FALTA COMPLETAR</b><ul>{pending.map((item) => <li key={`${item.label}:${item.detail}`}><button type="button" disabled={busy} onClick={() => item.question ? onResolveQuestion(item.question) : onManualEdit()}><span aria-hidden="true">☐</span><span><strong>{item.label}</strong><small>{item.detail}</small></span></button></li>)}</ul></div>}
    <div className={styles.reviewActions}>
      <button type="button" className="primary big" disabled={busy || !canConfirm} onClick={onConfirm}>INICIAR RONDA</button>
      <button type="button" className="secondary big" disabled={busy} onClick={onConversationalChange}>CAMBIAR ALGO</button>
    </div>
    <button type="button" className="textButton" disabled={busy} onClick={onManualEdit}>Abrir edición manual avanzada</button>
  </section>;
}
