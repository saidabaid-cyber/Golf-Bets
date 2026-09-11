"use client";

import { buildCaddieHoleContext, missingCaddieInputs, type CaddieShotPhase } from "../../features/caddie/domain";
import { planHasFeature, type PlanId } from "../../lib/plans";
import type { Hole } from "../../lib/types";
import styles from "./round-caddie-card.module.css";

export function RoundCaddieCard({ planId, hole, phase, gpsAvailable, bagClubCount }: {
  planId: PlanId;
  hole: Hole;
  phase: CaddieShotPhase;
  gpsAvailable: boolean;
  bagClubCount: number;
}) {
  const blackAccess = planHasFeature(planId, "caddie_ai");
  const context = buildCaddieHoleContext({ hole, shotPhase: phase, gpsAvailable, bagClubCount });
  const missing = missingCaddieInputs(context);

  if (!blackAccess) return <section className={styles.locked} aria-label="Caddie AI disponible con Backyard Black">
    <div className={styles.monogram} aria-hidden="true">B</div>
    <div><span>CADDIE AI</span><b>BLACK</b><p>Tu estrategia hoyo por hoyo.</p><small>Disponible con Backyard Black.</small></div>
  </section>;

  return <section className={styles.active} aria-label="Caddie AI Backyard Black">
    <header><div><span>CADDIE AI</span><b>BLACK</b></div><em>{phase === "TEE_SHOT" ? "SALIDA" : phase === "APPROACH" ? "APPROACH" : "ALREDEDOR"}</em></header>
    <p>Hoyo {context.hole} · Par {context.par}{context.yards ? ` · ${context.yards} yd` : ""}</p>
    <small>No genero estrategia hasta tener datos suficientes. Falta: {missing.join(", ")}.</small>
  </section>;
}
