"use client";

import type { ActiveRoundSummary } from "./home-dashboard";

export type PlayHubProps = {
  activeRound?: ActiveRoundSummary | null;
  onContinueRound: () => void;
  onEditRound?: () => void;
  onAiRound: () => void;
  onNewRound: () => void;
  onOpenHistory: () => void;
  onOpenBalances: () => void;
  onOpenPersonalHistory: () => void;
  onOpenStats: () => void;
  onOpenCourses: () => void;
  onOpenGroups: () => void;
  onOpenRules: () => void;
  onOpenStandings: () => void;
  onOpenResults: () => void;
};

function roundProgress(round: ActiveRoundSummary) {
  if (round.status === "review") return "Captura terminada · falta revisar y guardar";
  if (round.status === "setup") return `Configura ${round.totalHoles} hoyos y ${round.playerCount || "los"} jugadores`;
  const current = round.currentHole ? `Hoyo ${round.currentHole}` : "En juego";
  const progress = typeof round.playedHoles === "number" ? ` · ${round.playedHoles}/${round.totalHoles} capturados` : "";
  return `${current}${progress}`;
}

export function PlayHub({ activeRound, onContinueRound, onEditRound, onAiRound, onNewRound, onOpenHistory, onOpenBalances, onOpenPersonalHistory, onOpenStats, onOpenCourses, onOpenGroups, onOpenRules, onOpenStandings, onOpenResults }: PlayHubProps) {
  return <section className="betaPlayHub" aria-labelledby="beta-play-title">
    <section className="hero betaPlayHero">
      <div><span className="eyebrow">THE BACKYARD · JUGAR</span><h1 id="beta-play-title">Tu próxima salida.</h1><p>Empieza rápido o regresa exactamente a la ronda que dejaste abierta.</p></div>
      <div className="betaPlayHeroActions"><button type="button" className="primary big" onClick={onAiRound}>✨ Configurar con Backyard AI</button><button type="button" className="secondary" onClick={onNewRound}>Manual</button></div>
    </section>

    {activeRound ? <section className="card betaOpenRoundCard">
      <div className="betaOpenRoundHead"><span className={`betaRoundStatus ${activeRound.status}`}>{activeRound.status === "review" ? "POR REVISAR" : activeRound.status === "setup" ? "CONFIGURANDO" : "EN JUEGO"}</span><time dateTime={activeRound.roundDate}>{activeRound.roundDate}</time></div>
      <h2>{activeRound.courseName}</h2>
      <p>{roundProgress(activeRound)}</p>
      <div className="betaOpenRoundMeta"><span>{activeRound.totalHoles} hoyos</span><span>{activeRound.playerCount} jugador{activeRound.playerCount === 1 ? "" : "es"}</span></div>
      <div className="betaOpenRoundActions"><button type="button" className="primary big" onClick={onContinueRound}>{activeRound.status === "review" ? "Revisar resultados" : activeRound.status === "setup" ? "Continuar configuración" : "Volver al hoyo"}</button>{onEditRound && activeRound.status !== "setup" && <button type="button" className="secondary big" onClick={onEditRound}>Editar configuración</button>}</div>
      {activeRound.status === "live" && <nav className="betaRoundShortcuts" aria-label="Atajos de la ronda activa"><button type="button" onClick={onContinueRound}>Tarjeta</button><button type="button" onClick={onOpenStandings}>Cómo vamos</button><button type="button" onClick={onOpenResults}>Resultados</button><button type="button" onClick={onOpenRules}>Reglas</button></nav>}
    </section> : <section className="card betaNoOpenRound">
      <span className="betaEmptyFlag" aria-hidden="true">⚑</span><h2>No hay una ronda abierta.</h2><p>Dime quién juega, dónde y qué modalidades usan. Backyard preparará la misma ronda que el modo manual.</p><button type="button" className="primary big" onClick={onAiRound}>✨ Configurar con Backyard AI</button><button type="button" className="textButton" onClick={onNewRound}>Prefiero configurar manualmente</button>
    </section>}

    <section className="betaPlayTools" aria-labelledby="beta-play-tools-title">
      <div className="sectionTitle"><div><h2 id="beta-play-tools-title">Antes y después de jugar</h2><p>Herramientas conectadas a tus datos actuales.</p></div></div>
      <div className="betaPlayToolGrid">
        <button type="button" onClick={onOpenCourses}><span aria-hidden="true">⌖</span><div><b>Campos</b><small>Buscar, elegir y editar</small></div><strong aria-hidden="true">›</strong></button>
        <button type="button" onClick={onOpenGroups}><span aria-hidden="true">◎</span><div><b>Armar grupos</b><small>Jugadores frecuentes y sorteo</small></div><strong aria-hidden="true">›</strong></button>
        <button type="button" onClick={onOpenHistory}><span aria-hidden="true">↺</span><div><b>Histórico</b><small>Tarjetas y resultados guardados</small></div><strong aria-hidden="true">›</strong></button>
        <button type="button" onClick={onOpenBalances}><span aria-hidden="true">$</span><div><b>Balances</b><small>Ledger y cuentas sugeridas</small></div><strong aria-hidden="true">›</strong></button>
        <button type="button" onClick={onOpenPersonalHistory}><span aria-hidden="true">↔</span><div><b>Personales</b><small>Histórico contra tus rivales</small></div><strong aria-hidden="true">›</strong></button>
        <button type="button" onClick={onOpenStats}><span aria-hidden="true">↗</span><div><b>Mis stats</b><small>Sólo rondas con datos completos</small></div><strong aria-hidden="true">›</strong></button>
        <button type="button" onClick={onOpenRules}><span aria-hidden="true">?</span><div><b>Reglas de golf</b><small>Consulta el árbitro y las fuentes</small></div><strong aria-hidden="true">›</strong></button>
        <div className="betaPlayFuture" aria-disabled="true"><span aria-hidden="true">🏆</span><div><b>Polla Live</b><small>Torneos y seguimiento grupal</small></div><strong>Próximamente</strong></div>
      </div>
    </section>

    <aside className="betaPlayPromise"><b>Tu score se guarda primero en este dispositivo.</b><span>Si pierdes señal, puedes seguir capturando y la sincronización se reintentará al volver la conexión.</span></aside>
  </section>;
}
