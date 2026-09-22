"use client";

import type { VisionOverrides, VisionReview, VisionRound } from "../../lib/scorecard-vision/review";
import { ScorecardCorrection } from "./backyard-ai/scorecard-correction";

export function ScorecardVisionReview({ review, round, overrides, busy, onChange, onConfirm, onCancel }: {
  review: VisionReview;
  round: VisionRound;
  overrides: VisionOverrides;
  busy: boolean;
  onChange: (next: VisionOverrides) => void;
  onConfirm: (confirmationKey: string) => void;
  onCancel: () => void;
}) {
  return <section className="card" aria-labelledby="vision-review-title" aria-busy={busy}>
    <div className="sectionTitle"><h2 id="vision-review-title">Revisar lectura de tarjeta</h2><button type="button" aria-label="Cerrar revisión de tarjeta" disabled={busy} onClick={onCancel}>×</button></div>
    <p>Compara cada valor con la foto. Puedes corregir también los valores de confianza alta. Nada se importa hasta confirmar.</p>
    <p>Campo leído: {review.detectedCourse?.value ?? "Sin lectura"} {review.detectedCourse ? `· ${Math.round(review.detectedCourse.confidence * 100)}% de confianza` : ""}</p>
    {!review.detectedCourse && <label><input type="checkbox" checked={Boolean(overrides.acceptCourseMismatch)} disabled={busy} onChange={e => onChange({ ...overrides, acceptCourseMismatch: e.target.checked })} /> La foto corresponde a {round.course.name}</label>}
    <p>Tee leído: {review.detectedTee?.value ?? "Sin lectura; requiere confirmación"}</p>
    <label>Tee de la tarjeta
      <select value={overrides.confirmedTeeId ?? ""} disabled={busy} onChange={e => onChange({ ...overrides, confirmedTeeId: e.target.value || undefined })}>
        <option value="">Confirmar tee…</option>
        {(round.tees ?? []).map(tee => <option key={tee.id} value={tee.id}>{tee.name}</option>)}
      </select>
    </label>
    {review.warnings.length > 0 && <ul aria-label="Advertencias de lectura">{review.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    {review.validation.issues.length > 0 && <ScorecardCorrection round={round} issues={review.validation.issues} overrides={overrides} recognizedScoreCount={review.validation.acceptedCells.length} expectedScoreCount={round.players.length * review.validation.expectedHoles.length} onChange={next => onChange({ ...overrides, ...next })} />}
    <div style={{ overflowX: "auto", maxWidth: "100%" }} role="region" aria-label="Corrección de valores leídos" tabIndex={0}>
      <table><thead><tr><th>Jugador</th><th>Hoyo</th><th>Score</th><th>Confianza</th></tr></thead>
        <tbody>{review.validation.acceptedCells.map(cell => <tr key={`${cell.playerId}:${cell.hole}`}>
          <th scope="row">{cell.playerName}</th><td>{cell.hole}</td>
          <td><input aria-label={`Score ${cell.playerName} hoyo ${cell.hole}`} type="number" min={1} max={20} step={1} inputMode="numeric" disabled={busy} value={cell.value} onChange={e => {
            const value = e.target.value === "" ? 0 : Number(e.target.value);
            onChange({ ...overrides, cells: [...(overrides.cells ?? []).filter(item => !(item.playerId === cell.playerId && item.hole === cell.hole)), { playerId: cell.playerId, hole: cell.hole, value }] });
          }} /></td>
          <td>{cell.acceptedFrom === "user_override" ? "Corregido por ti" : `${Math.round(cell.confidence * 100)}%`}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p>Totales impresos: {[...review.frontTotal, ...review.backTotal, ...review.total].map(item => `${item.playerName} ${item.kind}: ${item.value ?? "ilegible"} (${Math.round(item.confidence * 100)}%)`).join(" · ") || "Sin lectura"}</p>
    {!review.ready && <p role="status">Resuelve los campos pendientes para confirmar la importación.</p>}
    <button type="button" className="primary" disabled={!review.ready || busy} onClick={() => onConfirm(review.confirmationKey)}>Confirmar importación</button>
    <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancelar</button>
  </section>;
}
