import { playOrder } from "../../engine";
import type {
  AcceptedScorecardCell,
  ActiveScorecardRound,
  ScorecardCellObservation,
  ScorecardConfidencePolicy,
  ScorecardExtraction,
  ScorecardPlayerMappingOverride,
  ScorecardPlayerMatch,
  ScorecardTotalKind,
  ScorecardValidationIssue,
  ScorecardValidationOverrides,
  ScorecardValidationResult,
} from "../schemas/scorecard";
import { scorecardConfidencePolicy } from "./confidence";
import { matchScorecardCourse, matchScorecardPlayers, normalizeScorecardMatchText } from "./matching";

export type ScorecardValidationOptions = {
  confidence?: Partial<ScorecardConfidencePolicy>;
  minScore?: number;
  maxScore?: number;
  /** Scores this many strokes over par are reviewed even when OCR confidence is high. */
  parReviewMargin?: number;
};

type AcceptedByKey = Map<string, AcceptedScorecardCell>;

const SCORECARD_STRUCTURAL_ROW_LABELS = new Set([
  "par",
  "hcp",
  "hdcp",
  "handicap",
  "si",
  "stroke index",
  "hole",
  "hoyo",
]);

function isScorecardStructuralRow(playerName: string) {
  return SCORECARD_STRUCTURAL_ROW_LABELS.has(normalizeScorecardMatchText(playerName));
}

function cellKey(playerId: string, hole: number) {
  return `${playerId}:${hole}`;
}

function totalKey(playerId: string, kind: ScorecardTotalKind) {
  return `${playerId}:${kind}`;
}

function issue(input: Omit<ScorecardValidationIssue, "message"> & { message?: string }): ScorecardValidationIssue {
  return { ...input, message: input.message || input.code };
}

function validIntegerScore(value: unknown, minScore: number, maxScore: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minScore && value <= maxScore;
}

function optionsWithDefaults(options: ScorecardValidationOptions) {
  const minScore = Number.isSafeInteger(options.minScore) && (options.minScore as number) >= 1 ? options.minScore as number : 1;
  const maxScore = Number.isSafeInteger(options.maxScore) && (options.maxScore as number) >= minScore ? options.maxScore as number : 20;
  const parReviewMargin = Number.isSafeInteger(options.parReviewMargin) && (options.parReviewMargin as number) >= 1
    ? options.parReviewMargin as number
    : 8;
  return { minScore, maxScore, parReviewMargin, confidence: scorecardConfidencePolicy(options.confidence) };
}

function roundValidationErrors(round: ActiveScorecardRound) {
  const errors: string[] = [];
  if (!round || typeof round !== "object") return ["La ronda activa no existe."];
  if (!round.roundId?.trim()) errors.push("La ronda activa no tiene ID.");
  if (round.startHole !== 1 && round.startHole !== 10) errors.push("La salida debe ser por el hoyo 1 o 10.");
  if (round.roundHoles !== 9 && round.roundHoles !== 18) errors.push("La ronda debe tener 9 o 18 hoyos.");
  if (!Array.isArray(round.players) || !round.players.length) errors.push("La ronda no tiene jugadores.");
  else {
    const ids = round.players.map((player) => player.id?.trim()).filter(Boolean);
    if (ids.length !== round.players.length || new Set(ids).size !== ids.length) errors.push("Los IDs de jugadores son inválidos o están duplicados.");
    if (round.players.some((player) => !player.name?.trim())) errors.push("Todos los jugadores necesitan nombre.");
  }
  if (!round.course?.id?.trim() || !round.course?.name?.trim() || !Array.isArray(round.course?.holes)) errors.push("El campo activo está incompleto.");
  return errors;
}

function validMappingOverrides(
  overrides: readonly ScorecardPlayerMappingOverride[],
  round: ActiveScorecardRound,
  issues: ScorecardValidationIssue[],
) {
  const accepted = new Map<string, ScorecardPlayerMappingOverride>();
  for (const override of overrides) {
    const normalizedName = normalizeScorecardMatchText(override.extractedName || "");
    const player = round.players.find((candidate) => candidate.id === override.playerId);
    if (!normalizedName || !player) {
      issues.push(issue({
        id: `override:mapping:${normalizedName || "empty"}`,
        code: "invalid_override",
        severity: "blocking",
        resolution: "player_mapping",
        extractedPlayerName: override.extractedName,
        candidatePlayerIds: round.players.map((candidate) => candidate.id),
        message: "La corrección de jugador no apunta a un jugador de la ronda.",
      }));
      continue;
    }
    const previous = accepted.get(normalizedName);
    if (previous && previous.playerId !== override.playerId) {
      issues.push(issue({
        id: `override:mapping:${normalizedName}:conflict`,
        code: "invalid_override",
        severity: "blocking",
        resolution: "player_mapping",
        extractedPlayerName: override.extractedName,
        candidatePlayerIds: round.players.map((candidate) => candidate.id),
        message: `La corrección de “${override.extractedName}” apunta a dos jugadores distintos.`,
      }));
      accepted.delete(normalizedName);
      continue;
    }
    accepted.set(normalizedName, { extractedName: override.extractedName, playerId: override.playerId });
  }
  return [...accepted.values()];
}

function matchByExtractedName(matches: readonly ScorecardPlayerMatch[]) {
  return new Map(matches.map((match) => [normalizeScorecardMatchText(match.extractedName), match]));
}

function highestConfidence<T extends { confidence: number }>(values: readonly T[]) {
  return [...values].sort((left, right) => right.confidence - left.confidence)[0];
}

function acceptCell(target: AcceptedByKey, cell: AcceptedScorecardCell) {
  target.set(cellKey(cell.playerId, cell.hole), cell);
}

function expectedSections(expectedHoles: readonly number[]) {
  const sections: Array<{ kind: ScorecardTotalKind; holes: number[] }> = [];
  const out = expectedHoles.filter((hole) => hole <= 9);
  const inward = expectedHoles.filter((hole) => hole >= 10);
  if (out.length) sections.push({ kind: "out", holes: out });
  if (inward.length) sections.push({ kind: "in", holes: inward });
  sections.push({ kind: "total", holes: [...expectedHoles] });
  return sections;
}

/**
 * Validates image evidence against the active round. It never calculates bets
 * and never mutates the live scorecard; the caller explicitly merges acceptedScores.
 */
export function validateScorecardExtraction(
  extraction: ScorecardExtraction,
  round: ActiveScorecardRound,
  overrides: ScorecardValidationOverrides = {},
  options: ScorecardValidationOptions = {},
): ScorecardValidationResult {
  const config = optionsWithDefaults(options);
  const issues: ScorecardValidationIssue[] = [];
  const invalidRound = roundValidationErrors(round);
  if (invalidRound.length) {
    invalidRound.forEach((message, index) => issues.push(issue({
      id: `round:${index}`,
      code: "invalid_round",
      severity: "blocking",
      resolution: "round_setup",
      message,
    })));
    return {
      ready: false,
      expectedHoles: [],
      acceptedScores: {},
      acceptedCells: [],
      issues,
      playerMatches: [],
      courseMatch: { status: "absent", confidence: 0 },
      evidence: { detectedCellCount: 0, numericCellCount: 0, averageCellConfidence: 0, sourcePhotoCount: 0 },
    };
  }

  const expectedHoles = playOrder(round.startHole).slice(0, round.roundHoles);
  const expectedHoleSet = new Set(expectedHoles);
  const expectedPlayerLabels = new Set(round.players.flatMap((player) => [player.name, ...(player.aliases || [])])
    .map((name) => normalizeScorecardMatchText(name)));
  const isUnexpectedStructuralRow = (playerName: string) => isScorecardStructuralRow(playerName)
    && !expectedPlayerLabels.has(normalizeScorecardMatchText(playerName));
  // Vision models occasionally duplicate the printed PAR/HCP rows into `cells`
  // even when they also return the dedicated `pars` collection. Those rows are
  // scorecard structure, not unknown players and must never create corrections.
  const scoreCells = extraction.cells.filter((cell) => !isUnexpectedStructuralRow(cell.playerName));
  const scorePlayers = extraction.players.filter((player) => !isUnexpectedStructuralRow(player.playerName));
  const scoreTotals = extraction.totals.filter((total) => !isUnexpectedStructuralRow(total.playerName));
  const holeByNumber = new Map(round.course.holes.map((hole) => [hole.number, hole]));
  const missingCourseHoles = expectedHoles.filter((hole) => {
    const courseHole = holeByNumber.get(hole);
    return !courseHole || !Number.isSafeInteger(courseHole.par) || courseHole.par < 1 || courseHole.par > 10;
  });
  if (missingCourseHoles.length) {
    issues.push(issue({
      id: "round:course-holes",
      code: "invalid_round",
      severity: "blocking",
      resolution: "round_setup",
      holes: missingCourseHoles,
      message: `El campo activo no tiene Par válido para H${missingCourseHoles.join(", H")}.`,
    }));
  }
  if (!scoreCells.length) {
    issues.push(issue({
      id: "extraction:no-cells",
      code: "no_scorecard_evidence",
      severity: "blocking",
      resolution: "new_photo",
      message: "No pude encontrar celdas de score visibles. Toma otra foto más clara de la tarjeta.",
    }));
  }

  const mappingOverrides = validMappingOverrides(overrides.playerMappings || [], round, issues);
  const extractedNames = [
    ...scorePlayers.map((player) => player.playerName),
    ...scoreCells.map((cell) => cell.playerName),
    ...scoreTotals.map((total) => total.playerName),
  ];
  const playerObservationConfidence = new Map<string, number>();
  for (const player of scorePlayers) {
    const key = normalizeScorecardMatchText(player.playerName);
    playerObservationConfidence.set(key, Math.max(playerObservationConfidence.get(key) ?? 0, player.confidence));
  }
  const playerMatches = matchScorecardPlayers(extractedNames, round.players, mappingOverrides, playerObservationConfidence);
  const matchMap = matchByExtractedName(playerMatches);
  for (const match of playerMatches) {
    if (match.status === "unknown") issues.push(issue({
      id: `player:${normalizeScorecardMatchText(match.extractedName)}:unknown`,
      code: "unknown_player",
      severity: "blocking",
      resolution: "player_mapping",
      extractedPlayerName: match.extractedName,
      confidence: match.confidence,
      candidatePlayerIds: match.candidatePlayerIds,
      message: `No pude relacionar “${match.extractedName}” con un jugador de esta ronda.`,
    }));
    else if (match.status === "ambiguous") issues.push(issue({
      id: `player:${normalizeScorecardMatchText(match.extractedName)}:ambiguous`,
      code: "ambiguous_player",
      severity: "blocking",
      resolution: "player_mapping",
      extractedPlayerName: match.extractedName,
      confidence: match.confidence,
      candidatePlayerIds: match.candidatePlayerIds,
      message: `“${match.extractedName}” puede corresponder a más de un jugador.`,
    }));
    else if (match.method !== "override" && match.confidence < config.confidence.playerAutoMatch) issues.push(issue({
      id: `player:${normalizeScorecardMatchText(match.extractedName)}:confidence`,
      code: "player_match_low_confidence",
      severity: "doubtful",
      resolution: "player_mapping",
      playerId: match.playerId,
      playerName: match.playerName,
      extractedPlayerName: match.extractedName,
      confidence: match.confidence,
      candidatePlayerIds: match.candidatePlayerIds,
      message: `Confirma que “${match.extractedName}” es ${match.playerName}.`,
    }));
  }

  const courseObservations = extraction.courses?.length ? extraction.courses : extraction.course ? [extraction.course] : [];
  const courseMatches = courseObservations.map((observation) => matchScorecardCourse(observation, round.course, config.confidence.courseAutoMatch, overrides.acceptCourseMismatch));
  const courseMatch = courseMatches.find((match) => match.status === "mismatch")
    ?? courseMatches.find((match) => match.status === "doubtful")
    ?? courseMatches[0]
    ?? { status: "absent" as const, confidence: 1 };
  const distinctVisibleCourses = [...new Set(courseObservations
    .filter((observation) => observation.confidence >= config.confidence.courseAutoMatch)
    .map((observation) => normalizeScorecardMatchText(observation.value)))];
  const conflictingCourses = !overrides.acceptCourseMismatch
    && distinctVisibleCourses.length > 1
    && courseMatches.some((match) => match.status === "mismatch");
  if (conflictingCourses) issues.push(issue({
    id: "course:conflicting-photos",
    code: "conflicting_course_observations",
    severity: "blocking",
    resolution: "course_confirmation",
    confidence: Math.min(...courseObservations.map((observation) => observation.confidence)),
    message: `Las fotos muestran campos distintos (${courseObservations.map((observation) => `“${observation.value}”`).join(" / ")}). Confirma que todas pertenecen a ${round.course.name} o vuelve a escanear.`,
  }));
  else if (courseMatch.status === "doubtful") issues.push(issue({
    id: "course:doubtful",
    code: "course_low_confidence",
    severity: "doubtful",
    resolution: "course_confirmation",
    confidence: courseMatch.confidence,
    message: `Confirma que la tarjeta es de ${round.course.name}.`,
  }));
  else if (courseMatch.status === "mismatch") issues.push(issue({
    id: "course:mismatch",
    code: "course_mismatch",
    severity: "blocking",
    resolution: "course_confirmation",
    confidence: courseMatch.confidence,
    message: `La tarjeta parece ser de “${courseMatch.extractedName}”, no de ${round.course.name}.`,
  }));

  const usableMatch = (name: string) => {
    const match = matchMap.get(normalizeScorecardMatchText(name));
    if (!match || match.status !== "matched" || !match.playerId) return null;
    if (match.method !== "override" && match.confidence < config.confidence.playerAutoMatch) return null;
    return match;
  };
  const cellsByKey = new Map<string, ScorecardCellObservation[]>();
  for (const cell of scoreCells) {
    if (!expectedHoleSet.has(cell.hole)) continue;
    const match = usableMatch(cell.playerName);
    if (!match?.playerId) continue;
    const key = cellKey(match.playerId, cell.hole);
    cellsByKey.set(key, [...(cellsByKey.get(key) || []), cell]);
  }

  const cellOverrides = new Map<string, { playerId: string; hole: number; value: number }>();
  for (const override of overrides.cells || []) {
    const player = round.players.find((candidate) => candidate.id === override.playerId);
    const key = cellKey(override.playerId, override.hole);
    if (!player || !expectedHoleSet.has(override.hole) || !validIntegerScore(override.value, config.minScore, config.maxScore)) {
      issues.push(issue({
        id: `override:cell:${key}`,
        code: "invalid_override",
        severity: "blocking",
        resolution: "cell_value",
        playerId: override.playerId,
        playerName: player?.name,
        hole: override.hole,
        candidateValue: override.value,
        message: `La corrección de H${override.hole} no es válida para esta ronda.`,
      }));
      continue;
    }
    const previous = cellOverrides.get(key);
    if (previous && previous.value !== override.value) {
      issues.push(issue({
        id: `override:cell:${key}:conflict`,
        code: "invalid_override",
        severity: "blocking",
        resolution: "cell_value",
        playerId: player.id,
        playerName: player.name,
        hole: override.hole,
        message: `${player.name}, H${override.hole}: hay dos correcciones distintas.`,
      }));
      cellOverrides.delete(key);
      continue;
    }
    cellOverrides.set(key, override);
  }

  const acceptedByKey: AcceptedByKey = new Map();
  const unresolvedCellNames = scoreCells.some((cell) => expectedHoleSet.has(cell.hole) && !usableMatch(cell.playerName));
  for (const player of round.players) {
    for (const hole of expectedHoles) {
      const key = cellKey(player.id, hole);
      const corrected = cellOverrides.get(key);
      if (corrected) {
        acceptCell(acceptedByKey, {
          playerId: player.id,
          playerName: player.name,
          hole,
          value: corrected.value,
          confidence: 1,
          acceptedFrom: "user_override",
        });
        continue;
      }

      const digitalRaw = round.digitalScores?.[hole]?.[player.id];
      const hasDigital = digitalRaw !== undefined && digitalRaw !== null;
      const digital = validIntegerScore(digitalRaw, config.minScore, config.maxScore) ? digitalRaw : null;
      if (hasDigital && digital === null) {
        issues.push(issue({
          id: `round:digital:${key}`,
          code: "invalid_round",
          severity: "blocking",
          resolution: "round_setup",
          playerId: player.id,
          playerName: player.name,
          hole,
          candidateValue: typeof digitalRaw === "number" ? digitalRaw : null,
          message: `${player.name}, H${hole}: el score digital existente es inválido.`,
        }));
      }

      const observations = cellsByKey.get(key) || [];
      const numeric = observations.filter((cell): cell is ScorecardCellObservation & { value: number } => cell.value !== null);
      const highest = highestConfidence(numeric);

      if (digital !== null) {
        // A digital score is evidence, not permission to hide a contradictory
        // card. Ask for the one disputed cell even when OCR itself is unsure.
        if (highest && highest.value !== digital) {
          issues.push(issue({
            id: `cell:${key}:digital-mismatch`,
            code: "digital_score_mismatch",
            severity: "blocking",
            resolution: "cell_value",
            playerId: player.id,
            playerName: player.name,
            extractedPlayerName: highest.playerName,
            hole,
            candidateValue: highest.value,
            expectedValue: digital,
            confidence: highest.confidence,
            source: highest.source,
            message: `${player.name}, H${hole}: la tarjeta parece decir ${highest.value} y el score digital dice ${digital}.`,
          }));
          continue;
        }
        const same = highestConfidence(numeric.filter((cell) => cell.value === digital));
        acceptCell(acceptedByKey, {
          playerId: player.id,
          playerName: player.name,
          hole,
          value: digital,
          confidence: 1,
          acceptedFrom: same ? "digital_and_extraction" : "digital",
          ...(same ? { source: same.source } : {}),
        });
        continue;
      }

      if (!highest) {
        if (observations.length) {
          const unreadable = highestConfidence(observations);
          issues.push(issue({
            id: `cell:${key}:unreadable`,
            code: "unreadable_score",
            severity: "blocking",
            resolution: "cell_value",
            playerId: player.id,
            playerName: player.name,
            extractedPlayerName: unreadable.playerName,
            hole,
            candidateValue: null,
            confidence: unreadable.confidence,
            source: unreadable.source,
            message: `${player.name}, H${hole}: no pude leer el score.`,
          }));
        } else if (!unresolvedCellNames) {
          issues.push(issue({
            id: `cell:${key}:missing`,
            code: "missing_score",
            severity: "blocking",
            resolution: "cell_value",
            playerId: player.id,
            playerName: player.name,
            hole,
            message: `${player.name}, H${hole}: falta el score.`,
          }));
        }
        continue;
      }

      const strongestByValue = new Map<number, ScorecardCellObservation & { value: number }>();
      for (const candidate of numeric) {
        const previous = strongestByValue.get(candidate.value);
        if (!previous || candidate.confidence > previous.confidence) strongestByValue.set(candidate.value, candidate);
      }
      const valueCandidates = [...strongestByValue.values()].sort((left, right) => right.confidence - left.confidence);
      const competing = valueCandidates.find((candidate, index) => index > 0 && (candidate.confidence >= config.confidence.cellAutoAccept || highest.confidence < config.confidence.cellAutoAccept));
      if (competing) {
        issues.push(issue({
          id: `cell:${key}:conflict`,
          code: "conflicting_score_observations",
          severity: "blocking",
          resolution: "cell_value",
          playerId: player.id,
          playerName: player.name,
          extractedPlayerName: highest.playerName,
          hole,
          candidateValue: highest.value,
          confidence: highest.confidence,
          source: highest.source,
          message: `${player.name}, H${hole}: dos fotos muestran scores distintos (${valueCandidates.map((candidate) => candidate.value).join(" / ")}).`,
        }));
        continue;
      }
      if (!validIntegerScore(highest.value, config.minScore, config.maxScore)) {
        issues.push(issue({
          id: `cell:${key}:range`,
          code: "score_out_of_range",
          severity: "blocking",
          resolution: "cell_value",
          playerId: player.id,
          playerName: player.name,
          extractedPlayerName: highest.playerName,
          hole,
          candidateValue: highest.value,
          confidence: highest.confidence,
          source: highest.source,
          message: `${player.name}, H${hole}: ${highest.value} está fuera del rango ${config.minScore}–${config.maxScore}.`,
        }));
        continue;
      }
      if (highest.confidence < config.confidence.cellAutoAccept) {
        issues.push(issue({
          id: `cell:${key}:confidence`,
          code: "low_confidence_score",
          severity: "doubtful",
          resolution: "cell_value",
          playerId: player.id,
          playerName: player.name,
          extractedPlayerName: highest.playerName,
          hole,
          candidateValue: highest.value,
          confidence: highest.confidence,
          source: highest.source,
          message: `${player.name}, H${hole}: parece ${highest.value}, pero necesito confirmarlo.`,
        }));
        continue;
      }
      const par = holeByNumber.get(hole)?.par;
      if (typeof par === "number" && highest.value > par + config.parReviewMargin) {
        issues.push(issue({
          id: `cell:${key}:par`,
          code: "score_implausible_for_par",
          severity: "doubtful",
          resolution: "cell_value",
          playerId: player.id,
          playerName: player.name,
          extractedPlayerName: highest.playerName,
          hole,
          candidateValue: highest.value,
          expectedValue: par,
          confidence: highest.confidence,
          source: highest.source,
          message: `${player.name}, H${hole}: leí ${highest.value} en un Par ${par}; confírmalo.`,
        }));
        continue;
      }
      acceptCell(acceptedByKey, {
        playerId: player.id,
        playerName: player.name,
        hole,
        value: highest.value,
        confidence: highest.confidence,
        acceptedFrom: "extraction",
        source: highest.source,
      });
    }
  }

  const acceptedParMismatches = new Set((overrides.acceptParMismatches || []).filter((hole) => Number.isInteger(hole) && expectedHoleSet.has(hole)));
  for (const parObservation of extraction.pars) {
    if (!expectedHoleSet.has(parObservation.hole) || parObservation.value === null) continue;
    const expectedPar = holeByNumber.get(parObservation.hole)?.par;
    if (expectedPar !== undefined && parObservation.value !== expectedPar && !acceptedParMismatches.has(parObservation.hole)) issues.push(issue({
      id: `par:${parObservation.hole}:mismatch`,
      code: "par_mismatch",
      severity: parObservation.confidence >= config.confidence.parCheck ? "blocking" : "doubtful",
      resolution: "course_confirmation",
      hole: parObservation.hole,
      candidateValue: parObservation.value,
      expectedValue: expectedPar,
      confidence: parObservation.confidence,
      source: parObservation.source,
      message: `H${parObservation.hole}: la tarjeta muestra Par ${parObservation.value} y la ronda usa Par ${expectedPar}.`,
    }));
  }

  const acceptedTotalOverrides = new Set((overrides.acceptTotalMismatches || []).map((entry) => totalKey(entry.playerId, entry.kind)));
  const totalsByKey = new Map<string, typeof extraction.totals>();
  for (const total of scoreTotals) {
    const match = usableMatch(total.playerName);
    if (!match?.playerId) continue;
    const key = totalKey(match.playerId, total.kind);
    totalsByKey.set(key, [...(totalsByKey.get(key) || []), total]);
  }
  for (const player of round.players) {
    for (const section of expectedSections(expectedHoles)) {
      const key = totalKey(player.id, section.kind);
      if (acceptedTotalOverrides.has(key)) continue;
      const totals = (totalsByKey.get(key) || []).filter((total) => total.value !== null && total.confidence >= config.confidence.totalCheck);
      if (!totals.length) continue;
      const sectionCells = section.holes.map((hole) => acceptedByKey.get(cellKey(player.id, hole)));
      if (sectionCells.some((cell) => !cell)) continue;
      const computed = sectionCells.reduce((sum, cell) => sum + (cell?.value || 0), 0);
      const strongestByValue = new Map<number, (typeof totals)[number] & { value: number }>();
      for (const total of totals) {
        if (total.value === null) continue;
        const previous = strongestByValue.get(total.value);
        if (!previous || total.confidence > previous.confidence) strongestByValue.set(total.value, total as (typeof totals)[number] & { value: number });
      }
      const candidates = [...strongestByValue.values()].sort((left, right) => right.confidence - left.confidence);
      if (candidates.length > 1) {
        issues.push(issue({
          id: `total:${key}:conflict`,
          code: "conflicting_total_observations",
          severity: "blocking",
          resolution: "total_confirmation",
          playerId: player.id,
          playerName: player.name,
          totalKind: section.kind,
          candidateValue: candidates[0].value,
          expectedValue: computed,
          confidence: candidates[0].confidence,
          source: candidates[0].source,
          message: `${player.name}: distintas fotos muestran ${section.kind.toLocaleUpperCase("en-US")} distintos (${candidates.map((candidate) => candidate.value).join(" / ")}).`,
        }));
      } else if (candidates[0] && candidates[0].value !== computed) {
        issues.push(issue({
          id: `total:${key}:mismatch`,
          code: "total_mismatch",
          severity: "blocking",
          resolution: "total_confirmation",
          playerId: player.id,
          playerName: player.name,
          totalKind: section.kind,
          candidateValue: candidates[0].value,
          expectedValue: computed,
          confidence: candidates[0].confidence,
          source: candidates[0].source,
          message: `${player.name}: ${section.kind.toLocaleUpperCase("en-US")} escrito ${candidates[0].value}, pero los hoyos suman ${computed}.`,
        }));
      }
    }
  }

  const acceptedCells = [...acceptedByKey.values()].sort((left, right) => {
    const holeDifference = expectedHoles.indexOf(left.hole) - expectedHoles.indexOf(right.hole);
    return holeDifference || round.players.findIndex((player) => player.id === left.playerId) - round.players.findIndex((player) => player.id === right.playerId);
  });
  const acceptedScores: Record<number, Record<string, number>> = {};
  for (const cell of acceptedCells) acceptedScores[cell.hole] = { ...(acceptedScores[cell.hole] || {}), [cell.playerId]: cell.value };
  const uniqueIssues = [...new Map(issues.map((entry) => [entry.id, entry])).values()];
  const expectedCellCount = round.players.length * expectedHoles.length;
  const numericCellCount = scoreCells.filter((cell) => cell.value !== null).length;
  const averageCellConfidence = scoreCells.length
    ? scoreCells.reduce((sum, cell) => sum + cell.confidence, 0) / scoreCells.length
    : 0;
  return {
    ready: uniqueIssues.length === 0 && acceptedCells.length === expectedCellCount,
    expectedHoles,
    acceptedScores,
    acceptedCells,
    issues: uniqueIssues,
    playerMatches,
    courseMatch,
    evidence: {
      detectedCellCount: scoreCells.length,
      numericCellCount,
      averageCellConfidence,
      sourcePhotoCount: new Set(extraction.sourceIds).size,
    },
  };
}
