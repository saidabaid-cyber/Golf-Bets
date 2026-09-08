"use client";

import { useEffect, useState } from "react";

import type {
  ActiveScorecardRound,
  ScorecardCellOverride,
  ScorecardPlayerMappingOverride,
  ScorecardValidationIssue,
  ScorecardValidationOverrides,
} from "../../../lib/backyard-ai/schemas/scorecard";
import styles from "./backyard-ai.module.css";

export type ScorecardCorrectionProps = {
  round: ActiveScorecardRound;
  issues: ScorecardValidationIssue[];
  overrides: ScorecardValidationOverrides;
  onChange: (overrides: ScorecardValidationOverrides) => void;
};

function upsertCell(values: ScorecardCellOverride[], next: ScorecardCellOverride) {
  return [...values.filter((item) => item.playerId !== next.playerId || item.hole !== next.hole), next];
}

function upsertMapping(values: ScorecardPlayerMappingOverride[], next: ScorecardPlayerMappingOverride) {
  const key = next.extractedName.trim().toLocaleLowerCase("es-MX");
  return [...values.filter((item) => item.extractedName.trim().toLocaleLowerCase("es-MX") !== key), next];
}

function ScoreCellCorrectionControl({
  playerId,
  playerName,
  hole,
  candidateValue,
  savedValue,
  onCommit,
}: {
  playerId: string;
  playerName: string;
  hole: number;
  candidateValue?: number;
  savedValue?: number;
  onCommit: (next: ScorecardCellOverride) => void;
}) {
  const [text, setText] = useState(String(savedValue ?? candidateValue ?? ""));
  useEffect(() => setText(String(savedValue ?? candidateValue ?? "")), [candidateValue, savedValue]);
  const value = Number(text);
  const valid = Number.isInteger(value) && value >= 1 && value <= 20;
  const commit = () => {
    if (valid) onCommit({ playerId, hole, value });
  };

  return <div className={styles.issueControl}>
    <input
      aria-label={`Confirmar score de ${playerName} en hoyo ${hole}`}
      type="number"
      min={1}
      max={20}
      inputMode="numeric"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter") commit(); }}
    />
    <button type="button" className="secondary" disabled={!valid} onClick={commit}>
      {savedValue === undefined && value === candidateValue ? `Confirmar ${candidateValue}` : "Aplicar"}
    </button>
  </div>;
}

export function ScorecardCorrection({ round, issues, overrides, onChange }: ScorecardCorrectionProps) {
  return <section className={`card ${styles.issues}`} aria-labelledby="scorecard-doubts-title">
    <div className="sectionTitle"><div><h2 id="scorecard-doubts-title">Sólo necesito confirmar esto</h2><p>{issues.length} duda{issues.length === 1 ? "" : "s"}; el resto de la tarjeta permanece oculto porque ya pasó la validación.</p></div></div>
    {issues.map((current) => {
      if (current.resolution === "cell_value" && current.playerId && current.hole) {
        const saved = overrides.cells?.find((item) => item.playerId === current.playerId && item.hole === current.hole)?.value;
        return <div className={styles.issue} key={current.id}>
          <span><b>{current.playerName || "Jugador"} · Hoyo {current.hole}</b><small>{current.message}</small></span>
          <ScoreCellCorrectionControl
            playerId={current.playerId}
            playerName={current.playerName || "jugador"}
            hole={current.hole}
            candidateValue={current.candidateValue ?? undefined}
            savedValue={saved}
            onCommit={(next) => onChange({ ...overrides, cells: upsertCell(overrides.cells || [], next) })}
          />
        </div>;
      }
      if (current.resolution === "player_mapping" && current.extractedPlayerName) {
        const saved = overrides.playerMappings?.find((item) => item.extractedName === current.extractedPlayerName)?.playerId || "";
        return <label className={styles.issue} key={current.id}>
          <span><b>¿Quién es “{current.extractedPlayerName}”?</b><small>{current.message}</small></span>
          <select aria-label={`Relacionar ${current.extractedPlayerName}`} value={saved} onChange={(event) => event.target.value && onChange({ ...overrides, playerMappings: upsertMapping(overrides.playerMappings || [], { extractedName: current.extractedPlayerName!, playerId: event.target.value }) })}>
            <option value="">Seleccionar…</option>
            {[...round.players].sort((left, right) => {
              const candidates = new Set(current.candidatePlayerIds || []);
              return Number(candidates.has(right.id)) - Number(candidates.has(left.id));
            }).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
          </select>
        </label>;
      }
      if (current.resolution === "course_confirmation") {
        if (current.code === "par_mismatch" && current.hole) {
          const accepted = overrides.acceptParMismatches?.includes(current.hole);
          return <div className={styles.issue} key={current.id}>
            <span><b>Par del hoyo {current.hole}</b><small>{current.message}</small></span>
            <button type="button" className="secondary" disabled={accepted} onClick={() => onChange({ ...overrides, acceptParMismatches: [...new Set([...(overrides.acceptParMismatches || []), current.hole!])] })}>{accepted ? "Confirmado" : `Usar Par ${current.expectedValue}`}</button>
          </div>;
        }
        return <div className={styles.issue} key={current.id}>
          <span><b>Campo de la tarjeta</b><small>{current.message}</small></span>
          <button type="button" className="secondary" onClick={() => onChange({ ...overrides, acceptCourseMismatch: true })}>Sí, es {round.course.name}</button>
        </div>;
      }
      if (current.resolution === "total_confirmation" && current.playerId && current.totalKind) {
        const accepted = overrides.acceptTotalMismatches?.some((entry) => entry.playerId === current.playerId && entry.kind === current.totalKind);
        return <div className={styles.issue} key={current.id}>
          <span><b>{current.playerName} · {current.totalKind.toLocaleUpperCase("es-MX")}</b><small>{current.message}</small></span>
          <button type="button" className="secondary" disabled={accepted} onClick={() => onChange({ ...overrides, acceptTotalMismatches: [...(overrides.acceptTotalMismatches || []), { playerId: current.playerId!, kind: current.totalKind! }] })}>{accepted ? "Confirmado" : "Conservar suma de hoyos"}</button>
        </div>;
      }
      return <div className={styles.issue} key={current.id}>
        <span><b>Necesita revisión manual</b><small>{current.message}</small></span>
        <small>{current.resolution === "new_photo" ? "Agrega otra foto más clara." : "Vuelve a la ronda para corregir la configuración."}</small>
      </div>;
    })}
  </section>;
}
