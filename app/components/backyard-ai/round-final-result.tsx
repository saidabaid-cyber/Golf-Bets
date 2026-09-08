import type { DeterministicRoundRecap } from "../../../lib/backyard-ai/recap/round-recap";
import type { Player, Transfer } from "../../../lib/types";
import styles from "./backyard-ai.module.css";

export type RoundFinalResultPlayer = Pick<Player, "id" | "name"> & {
  gross?: number;
  net?: number;
};

export type RoundFinalResultProps = {
  players: RoundFinalResultPlayer[];
  balances: Readonly<Record<string, number>>;
  transfers: readonly Transfer[];
  recap: DeterministicRoundRecap;
};

const currency = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function money(value: number) {
  return currency.format(value);
}

function signedMoney(value: number | undefined) {
  if (!Number.isFinite(value)) return "—";
  const amount = value ?? 0;
  return `${amount > 0 ? "+" : ""}${money(amount)}`;
}

function scoreSummary(player: RoundFinalResultPlayer) {
  const scores = [
    Number.isFinite(player.gross) ? `Bruto ${player.gross}` : undefined,
    Number.isFinite(player.net) ? `Neto ${player.net}` : undefined,
  ].filter(Boolean);
  return scores.join(" · ");
}

export function RoundFinalResult({ players, balances, transfers, recap }: RoundFinalResultProps) {
  const playerNames = new Map(players.map((player) => [player.id, player.name]));

  return <div className={styles.screen}>
    <section className="hero resultHero" aria-labelledby="round-finished-title">
      <div>
        <div className="eyebrow">RESULTADO FINAL</div>
        <h1 id="round-finished-title">RONDA TERMINADA</h1>
        <p>Scores confirmados y resultados calculados por el motor de The Backyard.</p>
      </div>
    </section>

    <section className="card finalPlayerSummary" aria-labelledby="final-player-results-title">
      <div className="sectionTitle"><div>
        <h2 id="final-player-results-title">Resultado por jugador</h2>
        <p>Balance final de todas las modalidades ya calculadas.</p>
      </div></div>
      {players.length > 0 ? players.map((player) => {
        const balance = balances[player.id];
        const scores = scoreSummary(player);
        return <div className="transfer" key={player.id}>
          <span><b>{player.name}</b>{scores ? <small>{scores}</small> : null}</span>
          <strong className={Number.isFinite(balance) ? balance > 0 ? "good" : balance < 0 ? "bad" : "" : ""}>{signedMoney(balance)}</strong>
        </div>;
      }) : <div className="empty">No hay jugadores en el resultado confirmado.</div>}
    </section>

    <section className={styles.recap} aria-labelledby="round-recap-title" data-provenance={recap.provenance}>
      <span className="eyebrow">BACKYARD AI RECAP</span>
      <h2 id="round-recap-title">{recap.headline}</h2>
      {recap.highlights.length > 0 ? <ul>{recap.highlights.map((highlight, index) => <li key={`${index}-${highlight}`}>{highlight}</li>)}</ul> : null}
    </section>

    <section className="card settlementCard" aria-labelledby="round-settlement-title">
      <div className="sectionTitle"><div>
        <h2 id="round-settlement-title">CÓMO LIQUIDAR</h2>
        <p>Pagos mínimos sugeridos por el motor después de netear los resultados.</p>
      </div></div>
      {transfers.length > 0 ? transfers.map((transfer, index) => <div className="transfer" key={`${transfer.fromPlayerId}-${transfer.toPlayerId}-${index}`}>
        <span><b>{playerNames.get(transfer.fromPlayerId) || "Jugador"}</b> → <b>{playerNames.get(transfer.toPlayerId) || "Jugador"}</b></span>
        <strong>{Number.isFinite(transfer.amount) ? money(transfer.amount) : "—"}</strong>
      </div>) : <div className="empty">No hay pagos pendientes.</div>}
      <p className={styles.legalNote}>The Backyard sólo registra y calcula acuerdos privados entre jugadores. No recibe, custodia ni procesa fondos; no actúa como sportsbook ni casa de apuestas.</p>
    </section>
  </div>;
}
