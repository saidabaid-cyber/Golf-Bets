import type { ProviderResult } from "../../lib/golf-providers";

export type ScoreExportPayload = {
  operationId: string;
  roundId: string;
  playerId: string;
  playedOn: string;
  courseId: string;
  teeId: string;
  teeName: string;
  grossScores: number[];
  courseHandicap?: number;
};

export type ScoreExportReceipt = { providerRoundId: string; acceptedAt: string };

export interface ScoreExportProvider {
  readonly id: string;
  readonly authorized: boolean;
  exportScore(payload: ScoreExportPayload): Promise<ProviderResult<ScoreExportReceipt>>;
}

export function validateScoreExportPayload(payload: ScoreExportPayload) {
  return Boolean(payload.operationId && payload.roundId && payload.playerId && payload.courseId && payload.teeId
    && (payload.grossScores.length === 9 || payload.grossScores.length === 18)
    && payload.grossScores.every((score) => Number.isInteger(score) && score >= 1 && score <= 20));
}

export const disabledScoreExportProvider: ScoreExportProvider = {
  id: "score-export-disabled",
  authorized: false,
  async exportScore() {
    return { ok: false, code: "not_authorized", message: "La exportación requiere un proveedor autorizado y permanece apagada.", providerId: this.id };
  },
};
