import { createBackyardIndexRoundSnapshot, snapshotBackyardIndexRound } from "./backyard-index";
import { parseIndexPreference, type BackyardIndexPreference } from "./backyard-index-preferences";
import type { BackyardIndexPccEvidence, RoundSnapshot } from "./types";

/** This boundary receives only frozen round data. It never reads today's catalog. */
export function captureCompletedRoundIndex(
  input: RoundSnapshot,
  accountUserId: string,
  preference: BackyardIndexPreference | null,
  priorRound?: RoundSnapshot,
): RoundSnapshot {
  const round = structuredClone(input);
  const player = round.players?.find((candidate) => candidate.accountUserId === accountUserId);
  if (!player || !accountUserId || accountUserId === "guest") return round;
  const prior = priorRound?.backyardIndexSnapshots?.find((item) => item.accountUserId === accountUserId);
  const existing = round.backyardIndexSnapshots?.find((item) => item.accountUserId === accountUserId);
  const frozen = existing || prior;
  const settings = parseIndexPreference(preference, accountUserId);
  const enabledAtClose = frozen?.activation?.enabled ?? (frozen?.eligible ? true : settings?.enabled === true);
  const activation = frozen?.activation || {
    enabled: enabledAtClose,
    preferenceUpdatedAt: settings?.updatedAt || round.completedAt || round.updatedAt || new Date().toISOString(),
    localPccZeroDeclaredAt: settings?.localPccZeroDeclaredAt || null,
  };
  const assignment = round.playerTeeAssignments?.find((item) => item.playerId === player.id);
  // Historical corrections may use their earlier evidence, never a newly edited template.
  const ratedTeeEvidence = frozen?.ratedTeeEvidence || assignment?.indexRatingEvidence;
  const inheritedPcc = frozen?.pccEvidence;
  const sameDate = frozen?.playedAt === round.date && (!priorRound || priorRound.date === round.date);
  const declarationApplies = enabledAtClose && activation.localPccZeroDeclaredAt
    && Number.isFinite(Date.parse(activation.localPccZeroDeclaredAt));
  const pccEvidence: BackyardIndexPccEvidence | undefined = inheritedPcc
    ? inheritedPcc.kind === "DECLARED_LOCAL_ZERO" && !sameDate ? undefined : inheritedPcc
    : declarationApplies && !priorRound
      ? { kind: "DECLARED_LOCAL_ZERO", value: 0, declaredAt: activation.localPccZeroDeclaredAt!, declaredByAccountUserId: accountUserId }
      : undefined;
  if (!enabledAtClose) {
    const details = createBackyardIndexRoundSnapshot(round, player.id, { ratedTeeEvidence, pccEvidence });
    const { scoreDifferential: unusedDifferential, ...withoutDifferential } = details;
    void unusedDifferential;
    return { ...round, backyardIndexSnapshots: [
      ...(round.backyardIndexSnapshots || []).filter((item) => item.accountUserId !== accountUserId),
      { ...withoutDifferential, eligible: false, reasons: ["INDEX_NOT_ENABLED"], activation },
    ] };
  }
  const captured = snapshotBackyardIndexRound(round, accountUserId, { priorRound, ratedTeeEvidence, pccEvidence });
  return { ...captured, backyardIndexSnapshots: captured.backyardIndexSnapshots?.map((item) => item.accountUserId === accountUserId ? { ...item, activation } : item) };
}
