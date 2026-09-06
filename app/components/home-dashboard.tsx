"use client";

import type { GolfInsights, PersonalActivity, ScoredRoundInsight } from "../../lib/golf-insights";
import { profileHandicapLabel } from "../../lib/account-state";

export type ActiveRoundSummary = {
  courseName: string;
  roundDate: string;
  status: "setup" | "live" | "review";
  totalHoles: 9 | 18;
  currentHole?: number;
  playedHoles?: number;
  playerCount: number;
};

export type HomeDashboardProps = {
  displayName: string;
  avatarUrl?: string | null;
  handicap: number | null;
  activeRound?: ActiveRoundSummary | null;
  latestRound?: ScoredRoundInsight | null;
  insights: GolfInsights;
  groupCount: number;
  activity: PersonalActivity[];
  onContinueRound: () => void;
  onNewRound: () => void;
  onOpenProfile: () => void;
  onOpenHistory: () => void;
  onOpenBalances: () => void;
  onOpenStats: () => void;
  onOpenGroups: () => void;
  onOpenSocial: () => void;
  onOpenCourses: () => void;
  onOpenRules: () => void;
  onOpenRound: (roundId: string) => void;
  onOpenActivity: (activity: PersonalActivity) => void;
};

function signedMoney(value: number) {
  const rounded = Math.round(value);
  if (rounded === 0) return "$0";
  return `${rounded > 0 ? "+" : "−"}$${Math.abs(rounded).toLocaleString("es-MX")}`;
}

function formatAverage(value: number | undefined) {
  return value === undefined ? "—" : value.toFixed(1);
}

function formatRelative(value: number) {
  if (value === 0) return "E";
  return `${value > 0 ? "+" : ""}${value}`;
}

function shortDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00-06:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" }).format(date);
}

function activeRoundLabel(round: ActiveRoundSummary) {
  if (round.status === "review") return "Lista para revisar";
  if (round.status === "setup") return "Configuración pendiente";
  if (round.currentHole) return `Hoyo ${round.currentHole} de ${round.totalHoles}`;
  return "Ronda en juego";
}

function ActivityPreview({ item, onOpen }: { item: PersonalActivity; onOpen: () => void }) {
  return <button type="button" className="betaActivityPreview" onClick={onOpen}>
    <span className={`betaActivityMark ${item.kind}`} aria-hidden="true">{item.kind === "round" ? "旗" : "●"}</span>
    <span><b>{item.title}</b><small>{item.detail}</small></span>
    <time dateTime={item.occurredAt}>{shortDate(item.occurredAt)}</time>
  </button>;
}

export function HomeDashboard({
  displayName,
  avatarUrl,
  handicap,
  activeRound,
  latestRound,
  insights,
  groupCount,
  activity,
  onContinueRound,
  onNewRound,
  onOpenProfile,
  onOpenHistory,
  onOpenBalances,
  onOpenStats,
  onOpenGroups,
  onOpenSocial,
  onOpenCourses,
  onOpenRules,
  onOpenRound,
  onOpenActivity,
}: HomeDashboardProps) {
  const safeName = displayName.trim() || "Golfista";
  const initial = safeName[0]?.toLocaleUpperCase("es-MX") || "G";

  return <section className="betaHomeScreen" aria-labelledby="beta-home-title">
    <section className="betaHomeHero">
      <div className="betaHomeIdentity">
        <button type="button" className="betaHomeAvatar" onClick={onOpenProfile} aria-label="Abrir mi perfil">
          {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : initial}
        </button>
        <div><span className="eyebrow">THE BACKYARD · GOLF</span><h1 id="beta-home-title">Hola, {safeName}.</h1><p>Tu golf, tu grupo y las cuentas claras.</p></div>
      </div>
      <button type="button" className="betaHcpBadge" onClick={onOpenProfile} aria-label="Abrir perfil para consultar o editar handicap">
        <span>HCP manual</span><strong>{handicap === null ? "—" : profileHandicapLabel(handicap)}</strong>
      </button>
    </section>

    <section className={`betaRoundCommand ${activeRound ? "active" : "new"}`} aria-label={activeRound ? "Ronda abierta" : "Nueva ronda"}>
      <div>
        <span className="eyebrow">{activeRound ? "RONDA ABIERTA" : "LISTO PARA JUGAR"}</span>
        <h2>{activeRound ? activeRound.courseName : "Arma tu siguiente ronda"}</h2>
        <p>{activeRound ? `${activeRoundLabel(activeRound)} · ${activeRound.playerCount} jugador${activeRound.playerCount === 1 ? "" : "es"}` : "Campo, jugadores, HCP y apuestas en un flujo rápido."}</p>
      </div>
      <div className="betaRoundCommandActions">
        <button type="button" className="primary big" onClick={activeRound ? onContinueRound : onNewRound}>
          {activeRound?.status === "review" ? "Revisar ronda" : activeRound ? "Continuar ronda" : "Nueva ronda"}
        </button>
        {activeRound && <button type="button" className="secondary" onClick={onNewRound}>Nueva ronda</button>}
      </div>
    </section>

    <section className="betaHomeStats" aria-label="Resumen de golf">
      <article><span>Rondas</span><b>{insights.rounds}</b><small>{insights.scoredRounds} con score completo</small></article>
      <article><span>Promedio</span><b>{formatAverage(insights.averageScore)}</b><small>{insights.scoreScopeHoles ? `score bruto · ${insights.scoreScopeHoles} hoyos` : "score bruto"}</small></article>
      <article><span>Apuestas</span><b className={insights.betBalance === undefined ? "" : insights.betBalance >= 0 ? "good" : "bad"}>{insights.betBalance === undefined ? "—" : signedMoney(insights.betBalance)}</b><small>{insights.betRounds ? `${insights.betRounds} resultado${insights.betRounds === 1 ? "" : "s"} verificado${insights.betRounds === 1 ? "" : "s"}` : "sin resultado verificable"}</small></article>
      <article><span>Grupos</span><b>{groupCount}</b><small>guardados</small></article>
    </section>

    <section className="card betaQuickCard">
      <div className="sectionTitle"><div><h2>Accesos rápidos</h2><p>Todo a un toque.</p></div></div>
      <div className="betaQuickGrid">
        <button type="button" onClick={onNewRound}><span aria-hidden="true">＋</span><b>Nueva ronda</b></button>
        <button type="button" onClick={onOpenHistory}><span aria-hidden="true">↺</span><b>Histórico</b></button>
        <button type="button" onClick={onOpenBalances}><span aria-hidden="true">$</span><b>Balances</b></button>
        <button type="button" onClick={onOpenStats}><span aria-hidden="true">↗</span><b>Stats</b></button>
        <button type="button" onClick={onOpenGroups}><span aria-hidden="true">◎</span><b>Grupos</b></button>
        <button type="button" onClick={onOpenCourses}><span aria-hidden="true">⚑</span><b>Campos</b></button>
        <button type="button" onClick={onOpenRules}><span aria-hidden="true">?</span><b>Reglas</b></button>
      </div>
    </section>

    {latestRound ? <section className="card betaLatestRound">
      <div className="sectionTitle"><div><span className="eyebrow">ÚLTIMA TARJETA COMPLETA</span><h2>{latestRound.courseName}</h2><p>{shortDate(latestRound.date)} · {latestRound.holeCount} hoyos · {latestRound.teeName || "Tee sin nombre"}</p></div><button type="button" className="textButton" onClick={onOpenHistory}>Ver histórico</button></div>
      <button type="button" className="betaLatestRoundBody" onClick={() => onOpenRound(latestRound.id)} aria-label={`Abrir ronda en ${latestRound.courseName}`}>
        <span><small>Score</small><strong>{latestRound.gross}</strong></span>
        <span><small>vs par</small><strong>{formatRelative(latestRound.relativeToPar)}</strong></span>
        <span><small>Neto</small><strong>{latestRound.net ?? "—"}</strong></span>
        <span><small>Apuestas</small><strong className={latestRound.betResult === undefined ? "" : latestRound.betResult >= 0 ? "good" : "bad"}>{latestRound.betResult === undefined ? "—" : signedMoney(latestRound.betResult)}</strong></span>
      </button>
    </section> : <section className="card betaHomeEmptyRound"><h2>{insights.rounds ? "Tus rondas siguen en Histórico." : "Tu primera tarjeta empieza aquí."}</h2><p>{insights.rounds ? "Aún no hay una tarjeta completa para mostrar score y estadísticas confiables en Inicio." : "Cuando cierres una ronda, verás aquí score, campo y resultado de apuestas."}</p><button type="button" className="primary" onClick={insights.rounds ? onOpenHistory : onNewRound}>{insights.rounds ? "Revisar histórico" : "Crear primera ronda"}</button></section>}

    <section className="card betaHomeActivity">
      <div className="sectionTitle"><div><h2>Actividad reciente</h2><p>Rondas y grupos de tu espacio.</p></div><button type="button" className="textButton" onClick={onOpenSocial}>Ver todo</button></div>
      {activity.length ? <div className="betaActivityPreviewList">{activity.slice(0, 3).map((item) => <ActivityPreview key={item.id} item={item} onOpen={() => onOpenActivity(item)} />)}</div> : <div className="empty">Todavía no hay actividad. Crea una ronda o guarda un grupo para empezar.</div>}
    </section>
  </section>;
}
