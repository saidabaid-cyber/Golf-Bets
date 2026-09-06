"use client";

import { useId, useMemo, useState } from "react";
import { buildBalanceLedger, compareLedgerEntries } from "../../lib/balance-ledger";
import type { LedgerEntry } from "../../lib/balance-ledger";
import type { RoundSnapshot } from "../../lib/types";
import styles from "./balance-ledger-panel.module.css";

const MXN_FORMATTER = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function money(value: number) {
  const normalized = Object.is(value, -0) ? 0 : value;
  const sign = normalized > 0 ? "+" : normalized < 0 ? "−" : "";
  return `${sign}${MXN_FORMATTER.format(Math.abs(normalized))}`;
}

function balanceTone(value: number) {
  if (value > 0) return styles.positive;
  if (value < 0) return styles.negative;
  return styles.neutral;
}

function heroBalanceTone(value: number) {
  if (value > 0) return styles.heroPositive;
  if (value < 0) return styles.heroNegative;
  return styles.heroNeutral;
}

function displayName(entry: LedgerEntry, currentUserId?: string) {
  return currentUserId && entry.accountUserId === currentUserId ? `${entry.name} (tú)` : entry.name;
}

export function BalanceLedgerPanel({
  history,
  currentUserId,
}: {
  history: RoundSnapshot[];
  currentUserId?: string;
}) {
  const titleId = useId();
  const leftSelectId = useId();
  const rightSelectId = useId();
  const ledger = useMemo(() => buildBalanceLedger(history), [history]);
  const [selectedLeft, setSelectedLeft] = useState("");
  const [selectedRight, setSelectedRight] = useState("");

  const entryByKey = useMemo(
    () => new Map(ledger.entries.map((entry) => [entry.key, entry])),
    [ledger.entries],
  );
  const currentUserKey = currentUserId ? `account:${currentUserId}` : "";
  const preferredLeft = entryByKey.has(currentUserKey) ? currentUserKey : ledger.entries[0]?.key || "";
  const leftKey = entryByKey.has(selectedLeft) ? selectedLeft : preferredLeft;
  const rightFallback = ledger.entries.find((entry) => entry.key !== leftKey)?.key || "";
  const rightKey = selectedRight !== leftKey && entryByKey.has(selectedRight)
    ? selectedRight
    : rightFallback;
  const comparison = leftKey && rightKey
    ? compareLedgerEntries(ledger, leftKey, rightKey)
    : undefined;
  const leftEntry = entryByKey.get(leftKey);
  const rightEntry = entryByKey.get(rightKey);
  const currentUserEntry = entryByKey.get(currentUserKey);
  const legacyRounds = ledger.rounds.filter((round) => !round.settleable).length;
  const exactRounds = ledger.rounds.length - legacyRounds;

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <header className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>HISTÓRICO DE APUESTAS</span>
          <h1 id={titleId}>Balances</h1>
          <p>Resultados acumulados entre jugadores, calculados desde las rondas guardadas.</p>
        </div>
        <div className={styles.heroMetric}>
          <span>{currentUserEntry ? "Tu balance" : "Rondas válidas"}</span>
          <strong className={currentUserEntry ? heroBalanceTone(currentUserEntry.balance) : styles.heroNeutral}>
            {currentUserEntry ? money(currentUserEntry.balance) : ledger.rounds.length.toLocaleString("es-MX")}
          </strong>
          <small>{currentUserEntry ? `${currentUserEntry.rounds} ${currentUserEntry.rounds === 1 ? "ronda" : "rondas"}` : `${ledger.entries.length} jugadores`}</small>
        </div>
      </header>

      {ledger.issues.length > 0 ? (
        <div className={styles.warning} role="status">
          <strong>{ledger.issues.length === 1 ? "Una ronda necesita revisión" : `${ledger.issues.length} rondas necesitan revisión`}</strong>
          <span>Se excluyeron resultados incompletos o no finitos para evitar mostrar balances incorrectos.</span>
        </div>
      ) : null}

      {legacyRounds > 0 ? (
        <div className={styles.notice} role="note">
          <strong>Hay {legacyRounds} {legacyRounds === 1 ? "ronda legacy" : "rondas legacy"}</strong>
          <span>Solo conservan el resultado del dueño. Se incluyen en su balance, pero no generan sugerencias entre jugadores.</span>
        </div>
      ) : null}

      {ledger.entries.length === 0 ? (
        <div className={styles.empty}>
          <span aria-hidden="true">⛳</span>
          <h2>Aún no hay balances</h2>
          <p>Cuando termines rondas con resultados de apuestas, aparecerán aquí.</p>
        </div>
      ) : (
        <>
          <section className={styles.section} aria-labelledby={`${titleId}-players`}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.kicker}>ACUMULADO</span>
                <h2 id={`${titleId}-players`}>Jugadores</h2>
              </div>
              <small>{exactRounds} {exactRounds === 1 ? "ronda con ledger completo" : "rondas con ledger completo"}</small>
            </div>
            <div className={styles.entryList}>
              {ledger.entries.map((entry) => (
                <article
                  className={`${styles.entry} ${currentUserId && entry.accountUserId === currentUserId ? styles.currentEntry : ""}`}
                  key={entry.key}
                >
                  <div className={styles.entryMain}>
                    <div className={styles.avatar} aria-hidden="true">{entry.name.trim().slice(0, 1).toLocaleUpperCase("es-MX") || "?"}</div>
                    <div className={styles.entryName}>
                      <h3>{displayName(entry, currentUserId)}</h3>
                      <span>{entry.kind === "guest" ? "Invitado en esta ronda" : "Cuenta vinculada"}</span>
                    </div>
                    <strong className={balanceTone(entry.balance)}>{money(entry.balance)}</strong>
                  </div>
                  <dl className={styles.stats}>
                    <div><dt>Rondas</dt><dd>{entry.rounds}</dd></div>
                    <div><dt>Ganadas</dt><dd>{entry.wins}</dd></div>
                    <div><dt>Perdidas</dt><dd>{entry.losses}</dd></div>
                    <div><dt>Empatadas</dt><dd>{entry.ties}</dd></div>
                  </dl>
                  {entry.legacyBalance !== 0 ? (
                    <p className={styles.legacyLine}>Incluye {money(entry.legacyBalance)} de histórico legacy.</p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className={styles.section} aria-labelledby={`${titleId}-suggestions`}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.kicker}>REFERENCIA POR RONDA</span>
                <h2 id={`${titleId}-suggestions`}>Ajustes matemáticos</h2>
              </div>
            </div>
            {ledger.suggestedTransfers.length > 0 ? (
              <ol className={styles.transferList}>
                {ledger.suggestedTransfers.map((transfer) => {
                  const from = entryByKey.get(transfer.fromKey);
                  const to = entryByKey.get(transfer.toKey);
                  if (!from || !to) return null;
                  return (
                    <li key={`${transfer.roundId}-${transfer.fromKey}-${transfer.toKey}`}>
                      <span>
                        <small>{transfer.courseName} · {transfer.date}</small>
                        <span><b>{displayName(from, currentUserId)}</b> → <b>{displayName(to, currentUserId)}</b></span>
                      </span>
                      <strong>{money(transfer.amount).replace(/^\+/, "")}</strong>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className={styles.inlineEmpty}>No hay ajustes matemáticos en las rondas con ledger completo.</p>
            )}
            <p className={styles.referenceNote}>Cada referencia se calcula dentro de una sola ronda. Puede haber sido liquidada fuera de The Backyard.</p>
          </section>

          {ledger.entries.length > 1 ? (
            <section className={styles.section} aria-labelledby={`${titleId}-comparison`}>
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.kicker}>COINCIDENCIAS</span>
                  <h2 id={`${titleId}-comparison`}>Comparar jugadores</h2>
                </div>
              </div>
              <div className={styles.selectors}>
                <label htmlFor={leftSelectId}>Jugador 1
                  <select id={leftSelectId} value={leftKey} onChange={(event) => setSelectedLeft(event.target.value)}>
                    {ledger.entries.map((entry) => <option key={entry.key} value={entry.key} disabled={entry.key === rightKey}>{displayName(entry, currentUserId)}</option>)}
                  </select>
                </label>
                <span aria-hidden="true">VS</span>
                <label htmlFor={rightSelectId}>Jugador 2
                  <select id={rightSelectId} value={rightKey} onChange={(event) => setSelectedRight(event.target.value)}>
                    {ledger.entries.map((entry) => <option key={entry.key} value={entry.key} disabled={entry.key === leftKey}>{displayName(entry, currentUserId)}</option>)}
                  </select>
                </label>
              </div>
              {comparison && leftEntry && rightEntry ? (
                <div className={styles.comparison} aria-live="polite">
                  <div className={styles.comparisonNames}>
                    <div><span>{displayName(leftEntry, currentUserId)}</span><small>Balance en rondas compartidas</small><strong className={balanceTone(comparison.leftBalance)}>{money(comparison.leftBalance)}</strong></div>
                    <b>{comparison.roundsTogether} {comparison.roundsTogether === 1 ? "ronda juntos" : "rondas juntos"}</b>
                    <div><span>{displayName(rightEntry, currentUserId)}</span><small>Balance en rondas compartidas</small><strong className={balanceTone(comparison.rightBalance)}>{money(comparison.rightBalance)}</strong></div>
                  </div>
                  {comparison.bilateralRounds > 0 ? <>
                    <p className={styles.bilateralLabel}>{comparison.bilateralRounds} {comparison.bilateralRounds === 1 ? "ronda de solo estos dos" : "rondas de solo estos dos"}</p>
                    <dl className={styles.comparisonStats}>
                      <div><dt>Ganó {leftEntry.name}</dt><dd>{comparison.leftAhead}</dd></div>
                      <div><dt>Empates</dt><dd>{comparison.ties}</dd></div>
                      <div><dt>Ganó {rightEntry.name}</dt><dd>{comparison.rightAhead}</dd></div>
                    </dl>
                  </> : <p className={styles.referenceNote}>No hay rondas de solo estos dos para asignar ganadas o perdidas.</p>}
                  {comparison.roundsTogether > comparison.bilateralRounds ? <p className={styles.referenceNote}>Las rondas con más jugadores cuentan en el balance compartido, no como duelo directo.</p> : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      <p className={styles.disclaimer}>
        Este resumen es informativo. The Backyard no registra pagos, no mueve dinero y estos cálculos no constituyen prueba de deuda.
      </p>
    </section>
  );
}
