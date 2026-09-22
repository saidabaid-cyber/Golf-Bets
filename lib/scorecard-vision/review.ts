import type { ActiveScorecardRound, ScorecardExtraction, ScorecardTextObservation, ScorecardValidationOverrides, ScorecardValidationResult } from "../backyard-ai/schemas/scorecard";
import { normalizeScorecardExtraction } from "../backyard-ai/scorecard/extractor";
import { validateScorecardExtraction } from "../backyard-ai/scorecard/validator";

export const SCORECARD_VISION_VERSION = 1 as const;
export type VisionRound = ActiveScorecardRound & {
  /** Frozen tees selected for this round, never guessed from a color. */
  tees?: Array<{ id: string; name: string }>;
};
export type VisionEvidence = {
  version: typeof SCORECARD_VISION_VERSION;
  extraction: ScorecardExtraction;
  detectedTee: ScorecardTextObservation | null;
  provenance: "provider" | "synthetic_fixture";
};
export type VisionOverrides = ScorecardValidationOverrides & { confirmedTeeId?: string };
export type VisionReview = {
  version: typeof SCORECARD_VISION_VERSION;
  sourceImageId: string;
  sourceImageIds: string[];
  detectedCourse: ScorecardExtraction["course"];
  detectedPlayers: ScorecardExtraction["players"];
  detectedTee: ScorecardTextObservation | null;
  perHoleScores: ScorecardExtraction["cells"];
  frontTotal: ScorecardExtraction["totals"];
  backTotal: ScorecardExtraction["totals"];
  total: ScorecardExtraction["totals"];
  confidence: Array<{ field: string; value: number }>;
  warnings: string[];
  unresolvedFields: string[];
  ready: boolean;
  validation: ScorecardValidationResult;
  /** Exact immutable content binding, not a security token or authorization. */
  confirmationKey: string;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function normalize(value: string) { return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }

/** Evidence-only pipeline. Reuses the established score/par/total/player validator;
 * neither this function nor a provider can persist a round or calculate money. */
export function reviewScorecardVision(evidence: VisionEvidence, round: VisionRound, overrides: VisionOverrides = {}): VisionReview {
  const normalized = normalizeScorecardExtraction(evidence.extraction);
  if (evidence.version !== 1 || !normalized.ok) throw new Error("invalid_vision_evidence");
  const card = normalized.extraction;
  if (!Array.isArray(evidence.extraction.sourceIds) || card.sourceIds.some(id => !evidence.extraction.sourceIds.includes(id))) throw new Error("invalid_vision_source");
  const validation = validateScorecardExtraction(card, round, overrides);
  const unresolvedFields = validation.issues.map(issue => issue.id);
  const warnings = validation.issues.map(issue => issue.message);
  const tees = round.tees ?? [];
  const selectedTee = tees.find(tee => tee.id === overrides.confirmedTeeId);
  const detectedTee = evidence.detectedTee;
  if (detectedTee && (!Number.isFinite(detectedTee.confidence) || detectedTee.confidence < 0 || detectedTee.confidence > 1 || !detectedTee.value?.trim() || !card.sourceIds.includes(detectedTee.source?.photoId))) throw new Error("invalid_vision_tee");
  const teeMatches = detectedTee ? tees.filter(tee => normalize(tee.name) === normalize(detectedTee.value)) : [];
  if (!selectedTee && !(teeMatches.length === 1 && detectedTee!.confidence >= 0.9)) {
    unresolvedFields.push("tee");
    warnings.push(tees.length ? "Confirma un tee existente de esta ronda. La lectura no permite determinarlo con certeza." : "Configura un tee válido en la ronda antes de importar.");
  }
  if (overrides.confirmedTeeId && !selectedTee) {
    unresolvedFields.push("tee:invalid_override");
    warnings.push("El tee elegido no pertenece a esta ronda.");
  }
  if (card.course === null && !overrides.acceptCourseMismatch) {
    unresolvedFields.push("course:absent");
    warnings.push("Confirma que la foto corresponde al campo seleccionado.");
  }
  const corrections = validation.acceptedCells.filter(cell => {
    const previous = round.digitalScores?.[cell.hole]?.[cell.playerId];
    return typeof previous === "number" && previous !== cell.value;
  });
  if (corrections.length) warnings.push(`La confirmación cambiará ${corrections.length} scores ya capturados. Los resultados se recalcularán con el motor existente.`);
  if (evidence.provenance === "synthetic_fixture") warnings.push("Lectura sintética de prueba; no proviene de reconocimiento de una foto.");
  const confidence = [
    ...(card.course ? [{ field: "course", value: card.course.confidence }] : []),
    ...(detectedTee ? [{ field: "tee", value: detectedTee.confidence }] : []),
    ...card.players.map(p => ({ field: `player:${p.playerName}`, value: p.confidence })),
    ...card.cells.map(c => ({ field: `score:${c.playerName}:${c.hole}`, value: c.confidence })),
    ...card.totals.map(t => ({ field: `total:${t.playerName}:${t.kind}`, value: t.confidence })),
  ];
  return {
    version: 1, sourceImageId: card.sourceIds[0], sourceImageIds: [...card.sourceIds],
    detectedCourse: card.course, detectedPlayers: card.players, detectedTee,
    perHoleScores: card.cells, frontTotal: card.totals.filter(t => t.kind === "out"),
    backTotal: card.totals.filter(t => t.kind === "in"), total: card.totals.filter(t => t.kind === "total"),
    confidence, warnings, unresolvedFields, ready: validation.ready && unresolvedFields.length === 0, validation,
    confirmationKey: canonical({ version: 1, evidence, round, overrides }),
  };
}

export type VisionImportResult =
  | { ok: false; reason: "confirmation_required" | "stale_review" | "unresolved_fields" | "fixture_not_importable" }
  | { ok: true; roundId: string; validation: ScorecardValidationResult; sourceImageIds: string[] };

/** Returns an import command only after human confirmation of this exact preview.
 * The existing owner-authorized persistence path still owns the actual write. */
export function confirmScorecardVision(input: {
  evidence: VisionEvidence; currentRound: VisionRound; overrides: VisionOverrides;
  confirmed: boolean; confirmationKey: string;
}): VisionImportResult {
  if (!input.confirmed) return { ok: false, reason: "confirmation_required" };
  const current = reviewScorecardVision(input.evidence, input.currentRound, input.overrides);
  if (current.confirmationKey !== input.confirmationKey) return { ok: false, reason: "stale_review" };
  if (!current.ready) return { ok: false, reason: "unresolved_fields" };
  if (input.evidence.provenance === "synthetic_fixture") return { ok: false, reason: "fixture_not_importable" };
  return { ok: true, roundId: input.currentRound.roundId, validation: structuredClone(current.validation), sourceImageIds: [...current.sourceImageIds] };
}

export interface ScorecardVisionProvider {
  readonly configured: boolean;
  extract(source: { sourceImageId: string; image: Blob }): Promise<unknown>;
}

/** No fallback OCR and no fabricated result when no real provider is configured. */
export async function detectScorecardVision(provider: ScorecardVisionProvider | null, source: { sourceImageId: string; image: Blob }) {
  if (!provider?.configured) return { status: "BLOCKED_EXTERNAL" as const, evidence: null };
  if (!source.sourceImageId.trim() || source.sourceImageId.length > 240 || !source.image.size || source.image.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(source.image.type)) throw new Error("invalid_vision_image");
  const result = normalizeScorecardExtraction(await provider.extract(source), source.sourceImageId);
  if (!result.ok) throw new Error("invalid_vision_evidence");
  return { status: "PASS" as const, evidence: { version: 1, extraction: result.extraction, detectedTee: null, provenance: "provider" } satisfies VisionEvidence };
}
