import type { NormalizedGhinScore } from "./core";

export type GhinMatch = "GHIN_ONLY" | "EXACT_MATCH" | "HIGH_CONFIDENCE_MATCH" | "MATCH_REVIEW_REQUIRED";
export type ProviderScoreRecord = NormalizedGhinScore & {
  id: string;
  linkedRoundId: string | null;
  linkedLocalId: string | null;
  match: GhinMatch;
  candidateRoundIds: string[];
  importedAt: string;
  postingFingerprint: string | null;
  outOfSync: boolean;
};
export type ReconciliationRound = {
  id: string; localId: string; golferId: string; playedOn: string;
  courseId: string | null; courseName: string; teeId: string | null; teeName: string;
  holes: number; gross: number; adjustedGross: number | null; materialScoreHash?: string;
};
export type PostingAssociation = { roundId: string; providerScoreId: string | null; fingerprint: string };
export type ReconciliationDecision = {
  score: NormalizedGhinScore & { id: string }; match: GhinMatch;
  linkedRoundId: string | null; candidateRoundIds: string[]; postingFingerprint: string | null;
};
export const ghinPlayedDate = (value: string | null) => {
  const date = value?.slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date ? date : null;
};
const normalize = (value: string | null) => (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
function scoresAgree(score: NormalizedGhinScore, round: ReconciliationRound) {
  // Never compare an adjusted total to a raw total: that can link a different card.
  return score.grossScore !== null ? score.grossScore === round.gross
    && (score.adjustedGrossScore === null || round.adjustedGross === null || score.adjustedGrossScore === round.adjustedGross)
    : score.adjustedGrossScore !== null && round.adjustedGross !== null && score.adjustedGrossScore === round.adjustedGross;
}
function supportingMatch(score: NormalizedGhinScore, round: ReconciliationRound) {
  if (!ghinPlayedDate(score.playedOn) || ghinPlayedDate(score.playedOn) !== ghinPlayedDate(round.playedOn)
    || score.holes !== round.holes || !scoresAgree(score, round)) return false;
  const course = score.courseId && round.courseId ? score.courseId === round.courseId
    : !!normalize(score.courseName) && normalize(score.courseName) === normalize(round.courseName);
  const tee = score.teeId && round.teeId ? score.teeId === round.teeId
    : !!normalize(score.teeName) && normalize(score.teeName) === normalize(round.teeName);
  return course && tee;
}
/** Provider-owned summaries never become writable Backyard snapshots. Missing
 * IDs/name-supported candidates require review; only a unique ID match links. */
export function reconcileGhinScores(input: {
  golferId: string; scores: readonly NormalizedGhinScore[]; rounds: readonly ReconciliationRound[];
  existing: readonly Pick<ProviderScoreRecord, "id" | "linkedRoundId" | "postingFingerprint">[];
  posts: readonly PostingAssociation[];
}) {
  const seen = new Set<string>(), decisions: ReconciliationDecision[] = [];
  let ignoredInvalid = 0;
  const rounds = input.rounds.filter(r => r.golferId === input.golferId);
  for (const item of input.scores) {
    if (!item.id || item.id.length > 240 || !ghinPlayedDate(item.playedOn)
      || (item.holes !== 9 && item.holes !== 18)
      || ![item.grossScore, item.adjustedGrossScore].some(n => n !== null && Number.isInteger(n) && n >= 9 && n <= 250)) {
      ignoredInvalid++; continue;
    }
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const score = { ...item, id: item.id };
    const previous = input.existing.find(r => r.id === score.id);
    const post = input.posts.find(r => r.providerScoreId === score.id);
    const exactIds = [...new Set([previous?.linkedRoundId, post?.roundId].filter((id): id is string => !!id))];
    if (exactIds.length === 1 && rounds.some(r => r.id === exactIds[0])) {
      decisions.push({ score, match: "EXACT_MATCH", linkedRoundId: exactIds[0], candidateRoundIds: [], postingFingerprint: post?.fingerprint ?? previous?.postingFingerprint ?? null });
      continue;
    }
    if (exactIds.length) {
      decisions.push({ score, match: "MATCH_REVIEW_REQUIRED", linkedRoundId: null, candidateRoundIds: exactIds, postingFingerprint: null });
      continue;
    }
    const candidates = rounds.filter(r => supportingMatch(score, r));
    const high = candidates.length === 1 && !!score.courseId && !!score.teeId
      && !!candidates[0].courseId && !!candidates[0].teeId;
    const linkedPost = high ? input.posts.find(p => p.roundId === candidates[0].id) : undefined;
    decisions.push({ score, match: high ? "HIGH_CONFIDENCE_MATCH" : candidates.length ? "MATCH_REVIEW_REQUIRED" : "GHIN_ONLY",
      linkedRoundId: high ? candidates[0].id : null, candidateRoundIds: high ? [] : candidates.map(r => r.id), postingFingerprint: linkedPost?.fingerprint ?? null });
  }
  // Two external cards proposing one physical round are ambiguous as a set.
  // Preserve an already-confirmed association; do not silently merge the other.
  const grouped = new Map<string, ReconciliationDecision[]>();
  for (const d of decisions) if (d.linkedRoundId) grouped.set(d.linkedRoundId, [...(grouped.get(d.linkedRoundId) ?? []), d]);
  for (const [id, group] of grouped) if (group.length > 1) for (const d of group) {
    if (d.match === "EXACT_MATCH" && group.filter(r => r.match === "EXACT_MATCH").length === 1) continue;
    d.match = "MATCH_REVIEW_REQUIRED"; d.candidateRoundIds = [id]; d.linkedRoundId = null;
  }
  return { decisions, ignoredInvalid };
}

export type GhinImportSummary = {
  fetched: number; importedNew: number; matched: number; ambiguous: number;
  ignoredInvalid: number; total: number; ghinOnly: number; syncedAt: string;
};
export type ProviderGrossTotals = { rounds: number; sum: number; best: number | null };
export type GhinImportPage = {
  items: ProviderScoreRecord[]; links: ProviderScoreRecord[]; total: number; nextCursor: string | null; summary: GhinImportSummary | null;
  grossTotals: Record<9 | 18, ProviderGrossTotals>;
  filters: { years: string[]; courses: string[] };
};

export type UnifiedHistoryEntry = {
  id: string; date: string; courseName: string; teeName: string | null; holes: number | null;
  gross: number | null; lifecycle?: string; origin: "BACKYARD" | "GHIN" | "BACKYARD + GHIN";
  backyardId: string | null; provider: ProviderScoreRecord | null;
};
export function unifiedGhinHistory(backyard: readonly Omit<UnifiedHistoryEntry, "origin" | "provider" | "backyardId">[], provider: readonly ProviderScoreRecord[]) {
  const rows: UnifiedHistoryEntry[] = backyard.map(r => {
    const linked = provider.find(p => p.linkedLocalId === r.id || p.linkedRoundId === r.id) ?? null;
    return { ...r, backyardId: r.id, origin: linked ? "BACKYARD + GHIN" : "BACKYARD", provider: linked };
  });
  for (const p of provider) {
    if (rows.some(r => r.provider?.id === p.id)) continue;
    rows.push({ id: `ghin:${p.id}`, date: ghinPlayedDate(p.playedOn) ?? "", courseName: p.courseName ?? "Campo no disponible",
      teeName: p.teeName, holes: p.holes, gross: p.grossScore, origin: p.linkedRoundId ? "BACKYARD + GHIN" : "GHIN",
      backyardId: p.linkedLocalId, provider: p });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
/** Aggregate only evidence-backed provider gross totals, never hole statistics. */
export function unifiedGrossMetrics(rows: readonly UnifiedHistoryEntry[], holes: 9 | 18) {
  const valid = rows.filter(r => r.holes === holes && r.gross !== null && Number.isFinite(r.gross));
  return { rounds: valid.length, average: valid.length ? valid.reduce((s, r) => s + r.gross!, 0) / valid.length : null,
    best: valid.length ? Math.min(...valid.map(r => r.gross!)) : null };
}
export function combineProviderGrossTotals(backyard: readonly {gross:number}[], provider?:ProviderGrossTotals) {
  const rounds=backyard.length+(provider?.rounds??0),sum=backyard.reduce((s,r)=>s+r.gross,0)+(provider?.sum??0);
  const candidates=[...backyard.map(r=>r.gross),...(provider?.best!==null&&provider?.best!==undefined?[provider.best]:[])];
  return {rounds,average:rounds?sum/rounds:null,best:candidates.length?Math.min(...candidates):null};
}
