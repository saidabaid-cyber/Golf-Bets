import type {
  ActiveScorecardCourse,
  ActiveScorecardPlayer,
  ScorecardCourseMatch,
  ScorecardPlayerMappingOverride,
  ScorecardPlayerMatch,
  ScorecardTextObservation,
} from "../schemas/scorecard";

export function normalizeScorecardMatchText(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function editDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function scorecardTextSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeScorecardMatchText(left);
  const normalizedRight = normalizeScorecardMatchText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  const distance = editDistance(normalizedLeft, normalizedRight);
  return Math.max(0, 1 - distance / Math.max(normalizedLeft.length, normalizedRight.length));
}

function playerNames(player: ActiveScorecardPlayer) {
  return [player.name, ...(player.aliases || [])]
    .map(normalizeScorecardMatchText)
    .filter(Boolean);
}

function uniqueByNormalizedName(names: readonly string[]) {
  const seen = new Set<string>();
  return names.filter((name) => {
    const normalized = normalizeScorecardMatchText(name);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/** Deterministic, conservative player matching. Low-confidence fuzzy matches remain reviewable. */
export function matchScorecardPlayers(
  extractedNames: readonly string[],
  players: readonly ActiveScorecardPlayer[],
  overrides: readonly ScorecardPlayerMappingOverride[] = [],
  observationConfidenceByName: ReadonlyMap<string, number> = new Map(),
): ScorecardPlayerMatch[] {
  const overrideMap = new Map(overrides.map((override) => [normalizeScorecardMatchText(override.extractedName), override.playerId]));
  return uniqueByNormalizedName(extractedNames).map((extractedName): ScorecardPlayerMatch => {
    const normalized = normalizeScorecardMatchText(extractedName);
    const observationConfidence = observationConfidenceByName.get(normalized) ?? 1;
    const overridePlayerId = overrideMap.get(normalized);
    if (overridePlayerId) {
      const player = players.find((candidate) => candidate.id === overridePlayerId);
      if (player) return {
        extractedName,
        status: "matched",
        playerId: player.id,
        playerName: player.name,
        confidence: 1,
        method: "override",
        candidatePlayerIds: [player.id],
      };
    }

    const exactName = players.filter((player) => normalizeScorecardMatchText(player.name) === normalized);
    if (exactName.length === 1) return {
      extractedName,
      status: "matched",
      playerId: exactName[0].id,
      playerName: exactName[0].name,
      confidence: observationConfidence,
      method: "exact",
      candidatePlayerIds: [exactName[0].id],
    };
    if (exactName.length > 1) return {
      extractedName,
      status: "ambiguous",
      confidence: observationConfidence,
      candidatePlayerIds: exactName.map((player) => player.id),
    };

    const exactAlias = players.filter((player) => (player.aliases || []).some((alias) => normalizeScorecardMatchText(alias) === normalized));
    if (exactAlias.length === 1) return {
      extractedName,
      status: "matched",
      playerId: exactAlias[0].id,
      playerName: exactAlias[0].name,
      confidence: observationConfidence,
      method: "alias",
      candidatePlayerIds: [exactAlias[0].id],
    };
    if (exactAlias.length > 1) return {
      extractedName,
      status: "ambiguous",
      confidence: observationConfidence,
      candidatePlayerIds: exactAlias.map((player) => player.id),
    };

    const isSingleName = !normalized.includes(" ");
    const namePartMatches = isSingleName
      ? players.filter((player) => playerNames(player).some((name) => name.split(" ").includes(normalized)))
      : players.filter((player) => playerNames(player).some((name) => name.startsWith(`${normalized} `) || name.endsWith(` ${normalized}`)));
    if (namePartMatches.length === 1) return {
      extractedName,
      status: "matched",
      playerId: namePartMatches[0].id,
      playerName: namePartMatches[0].name,
      confidence: Math.sqrt(0.94 * observationConfidence),
      method: "unique-name-part",
      candidatePlayerIds: [namePartMatches[0].id],
    };
    if (namePartMatches.length > 1) return {
      extractedName,
      status: "ambiguous",
      confidence: Math.sqrt(0.94 * observationConfidence),
      candidatePlayerIds: namePartMatches.map((player) => player.id),
    };

    const ranked = players.map((player) => ({
      player,
      confidence: Math.max(...playerNames(player).map((name) => scorecardTextSimilarity(normalized, name)), 0),
    })).sort((left, right) => right.confidence - left.confidence);
    const best = ranked[0];
    const second = ranked[1];
    const bestCombined = best ? Math.sqrt(best.confidence * observationConfidence) : 0;
    if (!best || bestCombined < 0.72) return {
      extractedName,
      status: "unknown",
      confidence: bestCombined,
      candidatePlayerIds: ranked.map((candidate) => candidate.player.id),
    };
    if (second && best.confidence - second.confidence < 0.08) return {
      extractedName,
      status: "ambiguous",
      confidence: bestCombined,
      candidatePlayerIds: ranked.filter((candidate) => best.confidence - candidate.confidence < 0.08).map((candidate) => candidate.player.id),
    };
    return {
      extractedName,
      status: "matched",
      playerId: best.player.id,
      playerName: best.player.name,
      confidence: bestCombined,
      method: "fuzzy",
      candidatePlayerIds: [best.player.id],
    };
  });
}

export function matchScorecardCourse(
  observation: ScorecardTextObservation | null,
  course: ActiveScorecardCourse,
  autoMatchThreshold: number,
  acceptMismatch = false,
): ScorecardCourseMatch {
  if (!observation) return { status: "absent", confidence: 1 };
  if (acceptMismatch) return { status: "overridden", extractedName: observation.value, confidence: 1 };
  const candidates = [course.name, ...(course.aliases || [])];
  const similarities = candidates.map((candidate) => scorecardTextSimilarity(observation.value, candidate));
  const best = Math.max(...similarities, 0);
  const combined = Math.sqrt(best * observation.confidence);
  if (best === 1 && combined >= autoMatchThreshold) return { status: "matched", extractedName: observation.value, confidence: combined };
  if (best === 1) return { status: "doubtful", extractedName: observation.value, confidence: combined };
  if (combined >= autoMatchThreshold) return { status: "matched", extractedName: observation.value, confidence: combined };
  if (best >= 0.72 || observation.confidence < autoMatchThreshold) return { status: "doubtful", extractedName: observation.value, confidence: combined };
  return { status: "mismatch", extractedName: observation.value, confidence: combined };
}
