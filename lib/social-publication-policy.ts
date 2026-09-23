type RoundPublicationCandidate = {
  id?: unknown;
  lifecycleState?: unknown;
  completedAt?: unknown;
};

/** Immediate Social reconciliation is useful only after a canonical round is
 * completed. The database trigger remains the durable publication reference;
 * active drafts must not create a failing secondary retry on every cloud save. */
export function hasCompletedRoundPublicationCandidate(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const round = candidate as RoundPublicationCandidate;
    return typeof round.id === "string" && Boolean(round.id.trim())
      && round.lifecycleState === "completed"
      && typeof round.completedAt === "string"
      && Number.isFinite(Date.parse(round.completedAt));
  });
}
