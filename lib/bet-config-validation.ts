import { isValidRoundHandicapValue, missingHandicapsForActiveBets } from "./handicap-base";
import type {
  BetConfig,
  FoursomeSegment,
  ManualBet,
  PersonalBet,
  Player,
  RoundHandicapBasis,
  SupplementalBet,
} from "./types";
import { isFiniteZeroSum } from "./settlement-integrity";

export type BetConfigurationIssue = {
  code: string;
  sectionId: string;
  message: string;
};

export type RoundBetConfiguration = {
  players: Player[];
  ownerId: string;
  bets: BetConfig;
  segments: FoursomeSegment[];
  personalBets: PersonalBet[];
  supplementalBets: SupplementalBet[];
  manualBets: ManualBet[];
  roundHoles: 9 | 18;
  startHole: 1 | 10;
  handicapBasis?: RoundHandicapBasis;
};

const NASSAU_COMPONENT_KEYS = ["match1", "medal1", "match2", "medal2", "match18", "medal18"] as const;
const NASSAU_FIRST_NINE_COMPONENT_KEYS = ["match1", "medal1"] as const;
const HANDICAP_MODES = new Set(["partial", "round", "decimal", "half_up", "half_down", "six_up", "four_down"]);

function hasApplicableNassauComponent(components: PersonalBet["components"] | undefined, roundHoles: 9 | 18) {
  const keys: readonly (keyof PersonalBet["components"])[] = roundHoles === 18
    ? NASSAU_COMPONENT_KEYS
    : NASSAU_FIRST_NINE_COMPONENT_KEYS;
  return keys.some((key) => Boolean(components?.[key]));
}

function hasValidNassauComponents(components: PersonalBet["components"] | undefined, roundHoles: 9 | 18) {
  const requiredKeys = roundHoles === 18 ? NASSAU_COMPONENT_KEYS : NASSAU_FIRST_NINE_COMPONENT_KEYS;
  return Boolean(components)
    && typeof components === "object"
    && !Array.isArray(components)
    && requiredKeys.every((key) => typeof components[key] === "boolean");
}

function currentParticipantIds(players: Player[], participantIds: string[] | undefined) {
  const available = new Set(players.map((player) => player.id));
  return [...new Set(Array.isArray(participantIds) ? participantIds : [])].filter((id) => available.has(id));
}

function hasCleanParticipantIds(players: Player[], participantIds: string[] | undefined) {
  if (!Array.isArray(participantIds)) return false;
  const available = new Set(players.map((player) => player.id));
  return participantIds.length === new Set(participantIds).size && participantIds.every((id) => available.has(id));
}

function activeParticipantIssue(
  issues: BetConfigurationIssue[],
  players: Player[],
  enabled: boolean | undefined,
  participantIds: string[] | undefined,
  minimum: number,
  code: string,
  sectionId: string,
  label: string,
) {
  if (!enabled) return;
  if (!hasCleanParticipantIds(players, participantIds)) {
    issues.push({ code: `${code}-selection`, sectionId, message: `${label}: vuelve a seleccionar los jugadores; hay participantes repetidos o que ya no están en la ronda.` });
  }
  const count = currentParticipantIds(players, participantIds).length;
  if (count < minimum) {
    issues.push({ code, sectionId, message: `${label}: selecciona al menos ${minimum} jugadores.` });
  }
}

function positiveStakeIssue(
  issues: BetConfigurationIssue[],
  enabled: boolean | undefined,
  value: number,
  code: string,
  sectionId: string,
  label: string,
) {
  if (enabled && Number.isFinite(value) && value === 0) {
    issues.push({ code, sectionId, message: `${label}: el valor debe ser mayor a $0 para poder liquidarse.` });
  }
}

function percentageIssue(
  issues: BetConfigurationIssue[],
  enabled: boolean | undefined,
  value: number | undefined,
  code: string,
  sectionId: string,
  label: string,
  required = true,
) {
  if (enabled && (value === undefined ? required : !Number.isFinite(value) || value < 0 || value > 100)) {
    issues.push({ code, sectionId, message: `${label}: el porcentaje HCP debe estar entre 0 y 100.` });
  }
}

function invalidStake(value: number) {
  return !Number.isFinite(value) || value < 0;
}

function decimalModeIssue(
  issues: BetConfigurationIssue[],
  enabled: boolean | undefined,
  value: unknown,
  code: string,
  sectionId: string,
  label: string,
) {
  if (enabled && value !== "partial" && value !== "round") {
    issues.push({ code, sectionId, message: `${label}: vuelve a seleccionar cómo se redondea el HCP.` });
  }
}

function handicapModeIssue(
  issues: BetConfigurationIssue[],
  enabled: boolean | undefined,
  value: unknown,
  code: string,
  sectionId: string,
  label: string,
) {
  if (enabled && (typeof value !== "string" || !HANDICAP_MODES.has(value))) {
    issues.push({ code, sectionId, message: `${label}: vuelve a seleccionar el modo de HCP.` });
  }
}

function enabledFlagIssue(
  issues: BetConfigurationIssue[],
  value: unknown,
  code: string,
  sectionId: string,
  label: string,
  allowMissing: boolean,
) {
  if (typeof value !== "boolean" && !(allowMissing && value === undefined)) {
    issues.push({ code, sectionId, message: `${label}: vuelve a confirmar si la apuesta está activa.` });
  }
}

function featureBooleanIssue(
  issues: BetConfigurationIssue[],
  enabled: boolean | undefined,
  value: unknown,
  code: string,
  sectionId: string,
  label: string,
) {
  if (enabled && typeof value !== "boolean") {
    issues.push({ code, sectionId, message: `${label}: vuelve a confirmar esta opción.` });
  }
}

function activeInstanceIdentityIssue<T extends { id: string; enabled?: boolean }>(
  issues: BetConfigurationIssue[],
  entries: T[],
  isActive: (entry: T) => boolean,
  code: string,
  sectionId: string,
  label: string,
) {
  const ids = entries.filter(isActive).map((entry) => entry.id);
  if (ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length) {
    issues.push({
      code,
      sectionId,
      message: `${label}: vuelve a guardar la configuración; hay apuestas con identidad vacía o repetida.`,
    });
  }
}

function crossCollectionIdentityIssue(input: RoundBetConfiguration, issues: BetConfigurationIssue[]) {
  const instances = [
    ...input.personalBets.filter((bet) => bet.enabled !== false).map((bet) => ({ id: bet.id, collection: "personal" })),
    ...input.supplementalBets.filter((bet) => bet.enabled !== false && bet.type === "individual_nassau").map((bet) => ({ id: bet.id, collection: "legacy-nassau" })),
  ];
  const collectionsById = new Map<string, Set<string>>();
  for (const instance of instances) {
    if (typeof instance.id !== "string" || !instance.id.trim()) continue;
    const collections = collectionsById.get(instance.id) ?? new Set<string>();
    collections.add(instance.collection);
    collectionsById.set(instance.id, collections);
  }
  if ([...collectionsById.values()].some((collections) => collections.size > 1)) {
    issues.push({
      code: "wager-identities",
      sectionId: "setup-personal-nassau",
      message: "Nassau: hay dos configuraciones distintas con la misma identidad. Elimina una o vuelve a crearla antes de iniciar.",
    });
  }
}

function stakeIssue(
  issues: BetConfigurationIssue[],
  enabled: boolean | undefined,
  value: number,
  code: string,
  sectionId: string,
  label: string,
) {
  if (enabled && invalidStake(value)) {
    issues.push({ code, sectionId, message: `${label}: el importe no puede ser negativo ni inválido.` });
  }
}

function validateMainBets(input: RoundBetConfiguration, issues: BetConfigurationIssue[]) {
  const { bets, players, roundHoles, segments } = input;
  const participantModes = [
    [bets.rabbits, "setup-rabbits", "rabbits-participants", "Conejos"],
    [bets.skins, "setup-skins", "skins-participants", "Skins"],
    [bets.units, "setup-units", "units-participants", "Unidades / Copas"],
    [bets.miniPolla, "setup-mini-polla", "mini-polla-participants", "Mini Polla"],
    [bets.vipers, "setup-vipers", "vipers-participants", "Víboras"],
    [bets.camels, "setup-camels", "camels-participants", "Camellos"],
    [bets.fish, "setup-fish", "fish-participants", "Peces"],
    [bets.loba, "setup-loba", "loba-participants", "Loba"],
  ] as const;
  for (const [config, sectionId, code, label] of participantModes) {
    activeParticipantIssue(issues, players, config.enabled, config.participantIds, 2, code, sectionId, label);
    stakeIssue(issues, config.enabled, config.value, code.replace(/-participants$/, "-stake"), sectionId, label);
  }
  positiveStakeIssue(issues, bets.miniPolla.enabled, bets.miniPolla.value, "mini-polla-positive-stake", "setup-mini-polla", "Mini Polla");
  percentageIssue(issues, bets.rabbits.enabled, bets.rabbits.hcpPct, "rabbits-hcp", "setup-rabbits", "Conejos");
  percentageIssue(issues, bets.skins.enabled, bets.skins.hcpPct, "skins-hcp", "setup-skins", "Skins");
  percentageIssue(issues, bets.miniPolla.enabled, bets.miniPolla.hcpPct, "mini-polla-hcp", "setup-mini-polla", "Mini Polla");
  percentageIssue(issues, bets.loba.enabled, bets.loba.hcpPct, "loba-hcp", "setup-loba", "Loba", false);
  handicapModeIssue(issues, bets.rabbits.enabled, bets.rabbits.decimals, "rabbits-decimals", "setup-rabbits", "Conejos");
  handicapModeIssue(issues, bets.skins.enabled, bets.skins.decimals, "skins-decimals", "setup-skins", "Skins");

  if (bets.rabbits.enabled) {
    const modeIsValid = bets.rabbits.mode === undefined || bets.rabbits.mode === "continuous" || bets.rabbits.mode === "three_hole_blocks";
    if (!modeIsValid) {
      issues.push({ code: "rabbits-mode", sectionId: "setup-rabbits", message: "Conejos: vuelve a seleccionar una modalidad válida." });
    }
    const usesAccumulate = bets.rabbits.mode === undefined || bets.rabbits.mode === "continuous";
    if (usesAccumulate && typeof bets.rabbits.accumulate !== "boolean") {
      issues.push({ code: "rabbits-accumulate", sectionId: "setup-rabbits", message: "Conejos: vuelve a confirmar si los conejos se acumulan." });
    }
  }

  if (bets.skins.enabled) {
    const modeIsValid = bets.skins.mode === undefined || bets.skins.mode === "carry" || bets.skins.mode === "no_carry";
    if (!modeIsValid) {
      issues.push({ code: "skins-mode", sectionId: "setup-skins", message: "Skins: vuelve a seleccionar una modalidad válida." });
    }
    if (bets.skins.mode === undefined && typeof bets.skins.accumulate !== "boolean") {
      issues.push({ code: "skins-accumulate", sectionId: "setup-skins", message: "Skins: vuelve a confirmar si los empates se acumulan." });
    }
  }

  for (const [config, code, sectionId, label] of [
    [bets.vipers, "vipers", "setup-vipers", "Víboras"],
    [bets.camels, "camels", "setup-camels", "Camellos"],
    [bets.fish, "fish", "setup-fish", "Peces"],
  ] as const) {
    if (!config.enabled) continue;
    if (config.secondNinePressed !== undefined && typeof config.secondNinePressed !== "boolean") {
      issues.push({ code: `${code}-second-nine-pressed`, sectionId, message: `${label}: vuelve a confirmar si hay presión en la segunda vuelta.` });
    }
    if (config.secondNinePressed !== false && config.secondNineMultiplier !== undefined && (!Number.isInteger(config.secondNineMultiplier) || config.secondNineMultiplier < 1 || config.secondNineMultiplier > 5)) {
      issues.push({ code: `${code}-second-nine-multiplier`, sectionId, message: `${label}: el multiplicador de segunda vuelta debe estar entre 1x y 5x.` });
    }
  }

  stakeIssue(issues, bets.units.enabled, bets.units.copaValue ?? bets.units.value, "units-copa-stake", "setup-units", "Unidades / Copas");
  if (bets.loba.enabled && bets.loba.unitsEnabled) {
    stakeIssue(issues, true, bets.loba.unitValue, "loba-unit-stake", "setup-loba", "Unidades de Loba");
  }
  featureBooleanIssue(issues, bets.loba.enabled, bets.loba.unitsEnabled, "loba-units-enabled", "setup-loba", "Loba · unidades");
  featureBooleanIssue(issues, bets.loba.enabled && bets.loba.unitsEnabled === true, bets.loba.duplicateUnitsByMode, "loba-duplicate-units", "setup-loba", "Loba · multiplicador de unidades");

  if (bets.monkey?.enabled) {
    if (!hasCleanParticipantIds(players, bets.monkey.participantIds)) {
      issues.push({ code: "monkey-participants-selection", sectionId: "setup-monkey", message: "Monkey: vuelve a seleccionar los jugadores; hay participantes repetidos o que ya no están en la ronda." });
    }
    const count = currentParticipantIds(players, bets.monkey.participantIds).length;
    if (count !== 3) {
      issues.push({ code: "monkey-participants", sectionId: "setup-monkey", message: "Monkey: selecciona exactamente 3 jugadores." });
    }
    stakeIssue(issues, true, bets.monkey.value, "monkey-stake", "setup-monkey", "Monkey");
    percentageIssue(issues, true, bets.monkey.hcpPct, "monkey-hcp", "setup-monkey", "Monkey", false);
  }

  if (bets.foursome.enabled) {
    if (!hasCleanParticipantIds(players, bets.foursome.participantIds)) {
      issues.push({ code: "foursome-participants-selection", sectionId: "setup-foursome", message: "Foursome: vuelve a seleccionar los jugadores; hay participantes repetidos o que ya no están en la ronda." });
    }
    if (input.handicapBasis !== "course" && bets.foursome.baseMode !== undefined && bets.foursome.baseMode !== "fixed" && bets.foursome.baseMode !== "moving") {
      issues.push({ code: "foursome-base-mode", sectionId: "setup-foursome", message: "Foursome: vuelve a seleccionar una base de HCP válida." });
    }
    if (bets.foursome.handicapMethod !== undefined && bets.foursome.handicapMethod !== "excel" && bets.foursome.handicapMethod !== "configured") {
      issues.push({ code: "foursome-handicap-method", sectionId: "setup-foursome", message: "Foursome: vuelve a confirmar la configuración de HCP." });
    }
    if (roundHoles === 18 && bets.foursome.pressureMultiplier === undefined && bets.foursome.pressSecond9 !== undefined && typeof bets.foursome.pressSecond9 !== "boolean") {
      issues.push({ code: "foursome-press-second-nine", sectionId: "setup-foursome", message: "Foursome: vuelve a confirmar la presión de la segunda vuelta." });
    }
    const participantIds = currentParticipantIds(players, bets.foursome.participantIds);
    if (!["fixed", "fixed_points", "points"].includes(bets.foursome.mode)) {
      issues.push({ code: "foursome-mode", sectionId: "setup-foursome", message: "Foursome: selecciona una modalidad válida." });
    }
    const segmentSizeIsValid = [3, 6, 9, 18].includes(bets.foursome.segmentSize);
    if (!segmentSizeIsValid) {
      issues.push({ code: "foursome-segment-size", sectionId: "setup-foursome", message: "Foursome: selecciona un tamaño de tramo válido." });
    }
    if (participantIds.length < 3) {
      issues.push({ code: "foursome-participants", sectionId: "setup-foursome", message: "Foursome: selecciona al menos 3 jugadores." });
    } else if (segmentSizeIsValid) {
      const selected = new Set(participantIds);
      const expectedSegments = Math.ceil(roundHoles / bets.foursome.segmentSize);
      const roundSegments = Array.isArray(segments) ? segments : [];
      const invalidSegments = roundSegments.filter((segment, index) => {
        const pair = Array.isArray(segment?.basePair) ? segment.basePair : [];
        const expectedStart = index * bets.foursome.segmentSize;
        const expectedEnd = Math.min(roundHoles - 1, expectedStart + bets.foursome.segmentSize - 1);
        return segment?.startIndex !== expectedStart || segment?.endIndex !== expectedEnd || pair.length !== 2 || new Set(pair).size !== 2 || pair.some((id) => !selected.has(id));
      });
      if (roundSegments.length !== expectedSegments || invalidSegments.length) {
        issues.push({ code: "foursome-pairs", sectionId: "setup-foursome", message: "Foursome: elige una pareja base válida para cada tramo." });
      }
    }
    if (bets.foursome.mode === "fixed" || bets.foursome.mode === "fixed_points") {
      stakeIssue(issues, true, bets.foursome.fixedValue, "foursome-fixed-stake", "setup-foursome", "Foursome fijo");
    }
    if (bets.foursome.mode === "points" || bets.foursome.mode === "fixed_points") {
      stakeIssue(issues, true, bets.foursome.pointValue, "foursome-point-stake", "setup-foursome", "Foursome por puntos");
    }
    if (bets.foursome.handicapMethod !== "excel") {
      percentageIssue(issues, true, bets.foursome.hcpPct, "foursome-hcp", "setup-foursome", "Foursome");
      decimalModeIssue(issues, true, bets.foursome.decimals, "foursome-decimals", "setup-foursome", "Foursome");
    }
    if (input.handicapBasis !== "course" && bets.foursome.baseMode === "fixed" && bets.foursome.fixedBaseHandicap !== undefined && !isValidRoundHandicapValue(bets.foursome.fixedBaseHandicap)) {
      issues.push({ code: "foursome-fixed-base", sectionId: "setup-foursome", message: "Foursome: vuelve a confirmar la base fija de HCP." });
    }
    const pressureMultiplier = bets.foursome.pressureMultiplier ?? (bets.foursome.pressSecond9 ? 2 : 1);
    if (roundHoles === 18 && (!Number.isInteger(pressureMultiplier) || pressureMultiplier < 1 || pressureMultiplier > 5)) {
      issues.push({ code: "foursome-pressure-multiplier", sectionId: "setup-foursome", message: "Foursome: selecciona un multiplicador de presión entre 1x y 5x." });
    }
    if (roundHoles === 18 && Number.isFinite(pressureMultiplier) && pressureMultiplier > 1 && bets.foursome.pressureNine !== undefined && bets.foursome.pressureNine !== "holes_1_9" && bets.foursome.pressureNine !== "holes_10_18") {
      issues.push({ code: "foursome-pressure-nine", sectionId: "setup-foursome", message: "Foursome: selecciona una vuelta válida para la presión." });
    }
  }

  if (bets.ballFriend.enabled) {
    if (!hasCleanParticipantIds(players, bets.ballFriend.participantIds)) {
      issues.push({ code: "ball-friend-participants-selection", sectionId: "setup-ball-friend", message: "Bola Amiga: vuelve a seleccionar los jugadores; hay participantes repetidos o que ya no están en la ronda." });
    }
    if (input.handicapBasis !== "course" && bets.ballFriend.baseMode !== undefined && bets.ballFriend.baseMode !== "fixed" && bets.ballFriend.baseMode !== "moving") {
      issues.push({ code: "ball-friend-base-mode", sectionId: "setup-ball-friend", message: "Bola Amiga: vuelve a seleccionar una base de HCP válida." });
    }
    const count = currentParticipantIds(players, bets.ballFriend.participantIds).length;
    if (count !== 4 && count !== 5) {
      issues.push({ code: "ball-friend-participants", sectionId: "setup-ball-friend", message: "Bola Amiga: selecciona 4 jugadores, o 5 para rotar el descanso." });
    }
    stakeIssue(issues, true, bets.ballFriend.value, "ball-friend-stake", "setup-ball-friend", "Bola Amiga");
    if (!Number.isInteger(bets.ballFriend.maxScore) || bets.ballFriend.maxScore < 1) {
      issues.push({ code: "ball-friend-max-score", sectionId: "setup-ball-friend", message: "Bola Amiga: define un score máximo de al menos 1." });
    }
    percentageIssue(issues, true, bets.ballFriend.hcpPct, "ball-friend-hcp", "setup-ball-friend", "Bola Amiga");
    decimalModeIssue(issues, true, bets.ballFriend.decimals, "ball-friend-decimals", "setup-ball-friend", "Bola Amiga");
    if (input.handicapBasis !== "course" && bets.ballFriend.baseMode === "fixed" && bets.ballFriend.fixedBaseHandicap !== undefined && !isValidRoundHandicapValue(bets.ballFriend.fixedBaseHandicap)) {
      issues.push({ code: "ball-friend-fixed-base", sectionId: "setup-ball-friend", message: "Bola Amiga: vuelve a confirmar la base fija de HCP." });
    }
  }

  const pollaComponents = [
    [bets.polla.first9, "polla-first", "setup-polla-h1-9", "Polla 1ª vuelta", true],
    [bets.polla.second9, "polla-second", "setup-polla-h10-18", "Polla 2ª vuelta", roundHoles === 18],
    [bets.polla.total18, "polla-total", "setup-polla-18-hoyos", "Polla 18 hoyos", roundHoles === 18],
  ] as const;
  for (const [config, code, sectionId, label, available] of pollaComponents) {
    if (!config.enabled) continue;
    if (!available) {
      issues.push({ code: `${code}-availability`, sectionId, message: `${label}: no corresponde a los hoyos configurados para esta ronda.` });
      continue;
    }
    activeParticipantIssue(issues, players, true, config.participantIds, 2, `${code}-participants`, sectionId, label);
    stakeIssue(issues, true, config.value, `${code}-invalid-stake`, sectionId, label);
    positiveStakeIssue(issues, true, config.value, `${code}-stake`, sectionId, label);
    percentageIssue(issues, true, config.hcpPct, `${code}-hcp`, sectionId, label);
    decimalModeIssue(issues, true, config.decimals, `${code}-decimals`, sectionId, label);
  }

  decimalModeIssue(issues, bets.miniPolla.enabled, bets.miniPolla.decimals, "mini-polla-decimals", "setup-mini-polla", "Mini Polla");
}

function validatePersonalBets(input: RoundBetConfiguration, issues: BetConfigurationIssue[]) {
  const playerIds = new Set(input.players.map((player) => player.id));
  if (input.personalBets.some((bet) => bet.enabled !== false) && !playerIds.has(input.ownerId)) {
    issues.push({ code: "personal-owner", sectionId: "setup-personal-nassau", message: "Apuestas personales: selecciona un jugador principal válido." });
  }
  input.personalBets.forEach((bet, index) => {
    if (bet.enabled === false) return;
    const label = `Apuesta personal ${index + 1}`;
    if (bet.rivalMode !== "group" && bet.rivalMode !== "external") {
      issues.push({ code: `personal-${bet.id}-rival-mode`, sectionId: "setup-personal-nassau", message: `${label}: vuelve a seleccionar el tipo de contrincante.` });
    } else if (bet.rivalMode === "group") {
      if (!bet.rivalPlayerId || !playerIds.has(bet.rivalPlayerId) || bet.rivalPlayerId === input.ownerId) {
        issues.push({ code: `personal-${bet.id}-rival`, sectionId: "setup-personal-nassau", message: `${label}: selecciona un contrincante distinto al jugador principal.` });
      }
    } else {
      if (typeof bet.rivalName !== "string" || !bet.rivalName.trim()) {
        issues.push({ code: `personal-${bet.id}-rival`, sectionId: "setup-personal-nassau", message: `${label}: escribe el nombre del contrincante externo.` });
      }
      if (bet.externalRivalId !== undefined && (typeof bet.externalRivalId !== "string" || !bet.externalRivalId || /\s/.test(bet.externalRivalId))) {
        issues.push({ code: `personal-${bet.id}-external-rival-id`, sectionId: "setup-personal-nassau", message: `${label}: vuelve a seleccionar o guardar el contrincante externo.` });
      }
    }
    if (!hasValidNassauComponents(bet.components, input.roundHoles) || !hasApplicableNassauComponent(bet.components, input.roundHoles)) {
      issues.push({ code: `personal-${bet.id}-components`, sectionId: "setup-personal-nassau", message: `${label}: activa al menos un componente aplicable a esta ronda.` });
    }
    stakeIssue(issues, true, bet.baseValue, `personal-${bet.id}-stake`, "setup-personal-nassau", label);
    if (!Number.isInteger(bet.advantageStrokes) || bet.advantageStrokes < 0) {
      issues.push({ code: `personal-${bet.id}-advantage`, sectionId: "setup-personal-nassau", message: `${label}: revisa los golpes de ventaja.` });
    } else if (bet.advantageStrokes > 0 && bet.advantageReceiver !== "owner" && bet.advantageReceiver !== "rival") {
      issues.push({ code: `personal-${bet.id}-advantage-receiver`, sectionId: "setup-personal-nassau", message: `${label}: indica quién recibe la ventaja.` });
    }
    const pressureMultiplier = bet.nassauVersion === 2
      ? bet.pressureMultiplier
      : bet.pressureMultiplier ?? bet.back9Multiplier ?? 1;
    const usesSecondNinePressure = Boolean(bet.components?.match2 || bet.components?.medal2);
    const validPressureMultiplier = typeof pressureMultiplier === "number"
      && Number.isInteger(pressureMultiplier)
      && pressureMultiplier >= 1
      && pressureMultiplier <= 5;
    if (input.roundHoles === 18 && usesSecondNinePressure && !validPressureMultiplier) {
      issues.push({ code: `personal-${bet.id}-pressure-multiplier`, sectionId: "setup-personal-nassau", message: `${label}: selecciona un multiplicador de presión entre 1x y 5x.` });
    }
    if (input.roundHoles === 18 && usesSecondNinePressure && validPressureMultiplier && pressureMultiplier > 1 && bet.pressureNine !== "holes_1_9" && bet.pressureNine !== "holes_10_18") {
      issues.push({ code: `personal-${bet.id}-pressure-nine`, sectionId: "setup-personal-nassau", message: `${label}: selecciona una vuelta válida para la presión.` });
    }
    const carryIsRelevant = input.roundHoles === 18 && Boolean(
      (bet.components?.match1 && bet.components?.match2)
      || (bet.components?.medal1 && bet.components?.medal2),
    );
    if (bet.nassauVersion === 2 && carryIsRelevant && typeof bet.carryEnabled !== "boolean") {
      issues.push({ code: `personal-${bet.id}-carry`, sectionId: "setup-personal-nassau", message: `${label}: vuelve a confirmar si los empates se acumulan.` });
    }
  });
}

function validateManualBets(input: RoundBetConfiguration, issues: BetConfigurationIssue[]) {
  input.manualBets.forEach((bet, index) => {
    if (bet.enabled === false) return;
    const label = typeof bet.name === "string" && bet.name.trim() ? bet.name.trim() : `Apuesta manual ${index + 1}`;
    if (typeof bet.name !== "string" || !bet.name.trim()) {
      issues.push({ code: `manual-${bet.id}-name`, sectionId: "setup-manuals", message: `${label}: vuelve a escribir el nombre de la apuesta.` });
    }
    if (!bet.amounts || typeof bet.amounts !== "object" || Array.isArray(bet.amounts)) {
      issues.push({ code: `manual-${bet.id}-amount`, sectionId: "setup-manuals", message: `${label}: revisa los importes inválidos.` });
      return;
    }
    const amounts = input.players.map((player) => bet.amounts?.[player.id] ?? 0);
    if (amounts.some((amount) => !Number.isFinite(amount))) {
      issues.push({ code: `manual-${bet.id}-amount`, sectionId: "setup-manuals", message: `${label}: revisa los importes inválidos.` });
      return;
    }
    if (!isFiniteZeroSum(amounts)) {
      issues.push({ code: `manual-${bet.id}-balance`, sectionId: "setup-manuals", message: `${label}: los importes deben sumar $0.` });
    }
  });
}

function validateHeadToHead(
  players: Player[],
  playerAId: string,
  playerBId: string,
  label: string,
  code: string,
  sectionId: string,
  issues: BetConfigurationIssue[],
) {
  const available = new Set(players.map((player) => player.id));
  if (!playerAId || !playerBId || playerAId === playerBId || !available.has(playerAId) || !available.has(playerBId)) {
    issues.push({ code, sectionId, message: `${label}: selecciona dos jugadores distintos de la ronda.` });
  }
}

function validateSupplementalBets(input: RoundBetConfiguration, issues: BetConfigurationIssue[]) {
  input.supplementalBets.forEach((bet, index) => {
    if (bet.enabled === false) return;
    const suffix = `${index + 1}`;
    const sectionId = `setup-${bet.type}`;
    switch (bet.type) {
      case "individual_nassau":
        validateHeadToHead(input.players, bet.playerAId, bet.playerBId, `Nassau individual ${suffix}`, `supplemental-${bet.id}-players`, sectionId, issues);
        stakeIssue(issues, true, bet.value, `supplemental-${bet.id}-stake`, sectionId, `Nassau individual ${suffix}`);
        if (!Number.isInteger(bet.advantageStrokes) || bet.advantageStrokes < 0) {
          issues.push({ code: `supplemental-${bet.id}-advantage`, sectionId, message: `Nassau individual ${suffix}: revisa los golpes de ventaja.` });
        } else if (bet.advantageStrokes > 0 && bet.advantageReceiverId !== bet.playerAId && bet.advantageReceiverId !== bet.playerBId) {
          issues.push({ code: `supplemental-${bet.id}-advantage-receiver`, sectionId, message: `Nassau individual ${suffix}: indica cuál de los dos jugadores recibe la ventaja.` });
        }
        if (!hasValidNassauComponents(bet.components, input.roundHoles) || !hasApplicableNassauComponent(bet.components, input.roundHoles)) {
          issues.push({ code: `supplemental-${bet.id}-components`, sectionId, message: `Nassau individual ${suffix}: activa al menos un componente aplicable a esta ronda.` });
        }
        featureBooleanIssue(issues, true, bet.carryEnabled, `supplemental-${bet.id}-carry`, sectionId, `Nassau individual ${suffix} · carry`);
        break;
      case "dollar_stroke":
        validateHeadToHead(input.players, bet.playerAId, bet.playerBId, `Dollar a Stroke ${suffix}`, `supplemental-${bet.id}-players`, sectionId, issues);
        stakeIssue(issues, true, bet.valuePerStroke, `supplemental-${bet.id}-stake`, sectionId, `Dollar a Stroke ${suffix}`);
        if (!Number.isInteger(bet.advantageStrokes) || bet.advantageStrokes < 0) {
          issues.push({ code: `supplemental-${bet.id}-advantage`, sectionId, message: `Dollar a Stroke ${suffix}: revisa los golpes de ventaja.` });
        } else if (bet.advantageStrokes > 0 && bet.advantageReceiverId !== bet.playerAId && bet.advantageReceiverId !== bet.playerBId) {
          issues.push({ code: `supplemental-${bet.id}-advantage-receiver`, sectionId, message: `Dollar a Stroke ${suffix}: indica cuál de los dos jugadores recibe la ventaja.` });
        }
        break;
      case "individual_pressures":
        activeParticipantIssue(issues, input.players, true, bet.participantIds, 2, `supplemental-${bet.id}-participants`, sectionId, `Presiones individuales ${suffix}`);
        stakeIssue(issues, true, bet.value, `supplemental-${bet.id}-stake`, sectionId, `Presiones individuales ${suffix}`);
        percentageIssue(issues, true, bet.hcpPct, `supplemental-${bet.id}-hcp`, sectionId, `Presiones individuales ${suffix}`);
        handicapModeIssue(issues, true, bet.decimals, `supplemental-${bet.id}-decimals`, sectionId, `Presiones individuales ${suffix}`);
        featureBooleanIssue(issues, true, bet.carryEnabled, `supplemental-${bet.id}-carry`, sectionId, `Presiones individuales ${suffix} · carry`);
        featureBooleanIssue(issues, true, bet.matchPlayEnabled, `supplemental-${bet.id}-match-play`, sectionId, `Presiones individuales ${suffix} · Match Play`);
        break;
      case "team_pressures": { 
        if (!hasCleanParticipantIds(input.players, bet.participantIds)) {
          issues.push({ code: `supplemental-${bet.id}-participants-selection`, sectionId, message: `Presiones por parejas ${suffix}: vuelve a seleccionar los jugadores; hay participantes repetidos o que ya no están en la ronda.` });
        }
        const participants = currentParticipantIds(input.players, bet.participantIds);
        if (!["standard", "mudo", "yoyo"].includes(bet.virtualMode)) {
          issues.push({ code: `supplemental-${bet.id}-mode`, sectionId, message: `Presiones por parejas ${suffix}: selecciona una modalidad válida.` });
        }
        if (!["low", "high", "low_high"].includes(bet.metric)) {
          issues.push({ code: `supplemental-${bet.id}-metric`, sectionId, message: `Presiones por parejas ${suffix}: selecciona una comparación válida.` });
        }
        const required = bet.virtualMode === "standard" ? 4 : 3;
        if (participants.length !== required) {
          issues.push({ code: `supplemental-${bet.id}-participants`, sectionId, message: `Presiones por parejas ${suffix}: selecciona exactamente ${required} jugadores para esta modalidad.` });
        } else if (bet.virtualMode === "standard") {
          const selected = new Set(participants);
          const teamAIsValid = Array.isArray(bet.teamA) && bet.teamA.length === 2 && new Set(bet.teamA).size === 2 && bet.teamA.every((id) => selected.has(id));
          if (!teamAIsValid) {
            issues.push({ code: `supplemental-${bet.id}-team`, sectionId, message: `Presiones por parejas ${suffix}: selecciona exactamente 2 jugadores en el Equipo A.` });
          }
        }
        if (bet.abandonedPlayerIds !== undefined && (!Array.isArray(bet.abandonedPlayerIds) || bet.abandonedPlayerIds.some((id) => !participants.includes(id)) || new Set(bet.abandonedPlayerIds).size !== bet.abandonedPlayerIds.length)) {
          issues.push({ code: `supplemental-${bet.id}-abandoned`, sectionId, message: `Presiones por parejas ${suffix}: vuelve a seleccionar quiénes abandonaron.` });
        }
        stakeIssue(issues, true, bet.value, `supplemental-${bet.id}-stake`, sectionId, `Presiones por parejas ${suffix}`);
        percentageIssue(issues, true, bet.hcpPct, `supplemental-${bet.id}-hcp`, sectionId, `Presiones por parejas ${suffix}`);
        handicapModeIssue(issues, true, bet.decimals, `supplemental-${bet.id}-decimals`, sectionId, `Presiones por parejas ${suffix}`);
        featureBooleanIssue(issues, true, bet.carryEnabled, `supplemental-${bet.id}-carry`, sectionId, `Presiones por parejas ${suffix} · carry`);
        if (Array.isArray(bet.abandonedPlayerIds) && bet.abandonedPlayerIds.length > 0 && (!Number.isInteger(bet.abandonedMaxScore) || bet.abandonedMaxScore < 1)) {
          issues.push({ code: `supplemental-${bet.id}-max-score`, sectionId, message: `Presiones por parejas ${suffix}: el score máximo de abandono debe ser al menos 1.` });
        }
        break;
      }
      case "chicago":
        activeParticipantIssue(issues, input.players, true, bet.participantIds, 2, `supplemental-${bet.id}-participants`, sectionId, `Chicago ${suffix}`);
        stakeIssue(issues, true, bet.valuePerPoint, `supplemental-${bet.id}-stake`, sectionId, `Chicago ${suffix}`);
        percentageIssue(issues, true, bet.hcpPct, `supplemental-${bet.id}-hcp`, sectionId, `Chicago ${suffix}`, false);
        if (!bet.points || ![
          bet.quotaBase,
          bet.points.birdieOrBetter,
          bet.points.par,
          bet.points.bogey,
          bet.points.doubleBogeyOrWorse,
        ].every(Number.isFinite)) {
          issues.push({ code: `supplemental-${bet.id}-points`, sectionId, message: `Chicago ${suffix}: revisa la cuota y los puntos configurados.` });
        }
        break;
      case "vegas": { 
        if (!hasCleanParticipantIds(input.players, bet.participantIds)) {
          issues.push({ code: `supplemental-${bet.id}-participants-selection`, sectionId, message: `Vegas ${suffix}: vuelve a seleccionar los jugadores; hay participantes repetidos o que ya no están en la ronda.` });
        }
        const participants = currentParticipantIds(input.players, bet.participantIds);
        if (!["fixed", "each_hole", "blocks"].includes(bet.rotation)) {
          issues.push({ code: `supplemental-${bet.id}-rotation`, sectionId, message: `Vegas ${suffix}: selecciona una rotación válida.` });
        }
        if (participants.length !== 4) {
          issues.push({ code: `supplemental-${bet.id}-participants`, sectionId, message: `Vegas ${suffix}: selecciona exactamente 4 jugadores.` });
        } else {
          const selected = new Set(participants);
          const teamAIsValid = Array.isArray(bet.teamA) && bet.teamA.length === 2 && new Set(bet.teamA).size === 2 && bet.teamA.every((id) => selected.has(id));
          if (!teamAIsValid) {
            issues.push({ code: `supplemental-${bet.id}-team`, sectionId, message: `Vegas ${suffix}: selecciona exactamente 2 jugadores en el Equipo A.` });
          }
        }
        stakeIssue(issues, true, bet.valuePerUnit, `supplemental-${bet.id}-stake`, sectionId, `Vegas ${suffix}`);
        percentageIssue(issues, true, bet.hcpPct, `supplemental-${bet.id}-hcp`, sectionId, `Vegas ${suffix}`);
        handicapModeIssue(issues, true, bet.decimals, `supplemental-${bet.id}-decimals`, sectionId, `Vegas ${suffix}`);
        featureBooleanIssue(issues, true, bet.birdiePenalty, `supplemental-${bet.id}-birdie-penalty`, sectionId, `Vegas ${suffix} · penalty`);
        if (bet.rotation === "blocks" && ![3, 6, 9].includes(bet.blockSize)) {
          issues.push({ code: `supplemental-${bet.id}-block-size`, sectionId, message: `Vegas ${suffix}: selecciona un tamaño de bloque válido.` });
        }
        break;
      }
      case "minimum_putts":
        activeParticipantIssue(issues, input.players, true, bet.participantIds, 2, `supplemental-${bet.id}-participants`, sectionId, `Menos Putts ${suffix}`);
        stakeIssue(issues, true, bet.ante, `supplemental-${bet.id}-stake`, sectionId, `Menos Putts ${suffix}`);
        if ((bet.holes !== 9 && bet.holes !== 18) || bet.holes > input.roundHoles) {
          issues.push({ code: `supplemental-${bet.id}-holes`, sectionId, message: `Menos Putts ${suffix}: la duración no puede superar los hoyos de la ronda.` });
        }
        break;
    }
  });
}

/**
 * Rejects active configurations that the deterministic engines cannot settle.
 * Disabled configurations and historical snapshots are deliberately untouched.
 */
export function collectBetConfigurationIssues(input: RoundBetConfiguration) {
  const issues: BetConfigurationIssue[] = [];
  for (const [value, code, sectionId, label] of [
    [input.bets.rabbits.enabled, "rabbits-enabled", "setup-rabbits", "Conejos"],
    [input.bets.skins.enabled, "skins-enabled", "setup-skins", "Skins"],
    [input.bets.units.enabled, "units-enabled", "setup-units", "Unidades / Copas"],
    [input.bets.foursome.enabled, "foursome-enabled", "setup-foursome", "Foursome"],
    [input.bets.ballFriend.enabled, "ball-friend-enabled", "setup-ball-friend", "Bola Amiga"],
    [input.bets.polla.first9.enabled, "polla-first-enabled", "setup-polla-h1-9", "Polla 1ª vuelta"],
    [input.bets.polla.second9.enabled, "polla-second-enabled", "setup-polla-h10-18", "Polla 2ª vuelta"],
    [input.bets.polla.total18.enabled, "polla-total-enabled", "setup-polla-18-hoyos", "Polla 18 hoyos"],
    [input.bets.miniPolla.enabled, "mini-polla-enabled", "setup-mini-polla", "Mini Polla"],
    [input.bets.vipers.enabled, "vipers-enabled", "setup-vipers", "Víboras"],
    [input.bets.camels.enabled, "camels-enabled", "setup-camels", "Camellos"],
    [input.bets.fish.enabled, "fish-enabled", "setup-fish", "Peces"],
    [input.bets.loba.enabled, "loba-enabled", "setup-loba", "Loba"],
  ] as const) enabledFlagIssue(issues, value, code, sectionId, label, false);
  if (input.bets.monkey) enabledFlagIssue(issues, input.bets.monkey.enabled, "monkey-enabled", "setup-monkey", "Monkey", false);
  input.personalBets.forEach((bet, index) => enabledFlagIssue(issues, bet.enabled, `personal-${bet.id}-enabled`, "setup-personal-nassau", `Apuesta personal ${index + 1}`, true));
  input.supplementalBets.forEach((bet, index) => enabledFlagIssue(issues, bet.enabled, `supplemental-${bet.id}-enabled`, `setup-${bet.type}`, `Apuesta adicional ${index + 1}`, true));
  input.manualBets.forEach((bet, index) => enabledFlagIssue(issues, bet.enabled, `manual-${bet.id}-enabled`, "setup-manuals", typeof bet.name === "string" && bet.name.trim() ? bet.name.trim() : `Apuesta manual ${index + 1}`, true));
  const playerIds = input.players.map((player) => player.id);
  if (playerIds.some((id) => typeof id !== "string" || !id || /\s/.test(id)) || new Set(playerIds).size !== playerIds.length) {
    issues.push({
      code: "round-player-identities",
      sectionId: "round-players",
      message: "Jugadores: vuelve a seleccionar la lista; hay identidades vacías, con espacios o repetidas.",
    });
  }
  activeInstanceIdentityIssue(issues, input.personalBets, (bet) => bet.enabled !== false, "personal-identities", "setup-personal-nassau", "Apuestas personales");
  activeInstanceIdentityIssue(issues, input.supplementalBets, (bet) => bet.enabled !== false, "supplemental-identities", `setup-${input.supplementalBets.find((bet) => bet.enabled !== false)?.type ?? "team_pressures"}`, "Apuestas adicionales");
  activeInstanceIdentityIssue(issues, input.manualBets, (bet) => bet.enabled !== false, "manual-identities", "setup-manuals", "Apuestas manuales");
  crossCollectionIdentityIssue(input, issues);
  validateMainBets(input, issues);
  validatePersonalBets(input, issues);
  validateSupplementalBets(input, issues);
  validateManualBets(input, issues);

  const missingHandicaps = missingHandicapsForActiveBets(input.players, input.bets, input.supplementalBets);
  if (missingHandicaps.length) {
    issues.push({
      code: "active-bet-handicaps",
      sectionId: "round-players",
      message: `Completa el HCP de ${missingHandicaps.map((player) => player.name.trim() || "Sin nombre").join(", ")} para calcular las apuestas activas.`,
    });
  }

  return issues.map((issue) => ({
    ...issue,
    sectionId: issue.sectionId === "round-players" ? issue.sectionId : `result-section-${issue.sectionId}`,
  }));
}
