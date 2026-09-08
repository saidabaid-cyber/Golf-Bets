import type { RoundSetupQuestion } from "../schemas/actions";
import type { RoundSetupPlan } from "./round-setup";

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX").trim();
}

function amountIn(value: string) {
  return /^\s*\$?\s*([\d][\d.,]*)\s*$/i.exec(value)?.[1]
    ?? /(?:\b(?:de|a|por)\s+|\$)\$?\s*([\d][\d.,]*)\b/i.exec(value)?.[1];
}

function exclusionIn(value: string) {
  return /\bmenos\s+([^.;]+)/i.exec(value)?.[1]
    ?.replace(/\s+(?:de|a|por)\s+\$?[\d][\d.,]*.*$/i, "")
    .replace(/\s+(?:con|sin)\s+carry.*$/i, "")
    .trim();
}

function pollaClause(value: string) {
  const match = /\bpolla\b/i.exec(value);
  if (!match || match.index === undefined) return value;
  const fromPolla = value.slice(match.index);
  const boundary = /[.;]|(?:\s+y\s+|\s*,\s*)(?=(?:bola amiga|mini polla|nassau|skins?|conejos?|unidades?|copas?|foursomes?|viboritas?|camellos?|peces?|loba|monkey|press(?:es)?|presiones?|dollar a stroke|dolar a stroke|chicago|vegas|minimo de putts|menos putts)\b)/i.exec(fromPolla);
  return boundary ? fromPolla.slice(0, boundary.index) : fromPolla;
}

function withoutAmbiguousMemoryReference(value: string) {
  return value
    .replace(/\blos mismos(?:\s+(?:\d+|cuatro|cinco|tres))?\s+de siempre\b/gi, "")
    .replace(/\blos mismos(?:\s+\w+)?\s+del domingo\b/gi, "")
    .replace(/\bcomo (?:jugamos )?la semana pasada\b/gi, "")
    .replace(/\b(?:lo mismo|igual que la ultima vez|como la ultima vez)\b/gi, "")
    .replace(/^\s*(?:pero|y)\s+/i, "")
    .trim();
}

function supplementalLabel(type: Extract<RoundSetupPlan["interpretation"]["actions"][number], { type: "configure_supplemental_bet" }>["betType"]) {
  return ({
    dollar_stroke: "Dollar a Stroke",
    individual_pressures: "Presiones individuales",
    team_pressures: "Presiones por parejas",
    chicago: "Chicago",
    vegas: "Vegas",
    minimum_putts: "Mínimo de Putts",
  } as const)[type];
}

function roundingDetail(mode: string | undefined) {
  return ({
    decimal: " con decimales",
    half_up: " con .5 sube",
    half_down: " con .5 baja",
    six_up: " con .6 sube",
    four_down: " con .4 baja",
    partial: " con decimales cuentan",
    round: " con redondear",
  } as Record<string, string>)[mode || ""] || "";
}

function handicapAndRoundingDetails(action: { hcpPct?: number; decimals?: string }) {
  return `${action.hcpPct === undefined ? "" : ` con HCP ${action.hcpPct}%`}${roundingDetail(action.decimals)}`;
}

function advancedSupplementalDetails(action: Extract<RoundSetupPlan["interpretation"]["actions"][number], { type: "configure_supplemental_bet" }>) {
  const hcp = handicapAndRoundingDetails(action);
  const matchPlay = action.matchPlayEnabled === undefined ? "" : action.matchPlayEnabled ? " con Match Play" : " sin Match Play";
  const advantage = action.clearAdvantage
    ? " sin ventaja"
    : action.advantageStrokes !== undefined && action.advantageReceiverName
      ? ` con ${action.advantageStrokes} golpes de ventaja para ${action.advantageReceiverName}`
      : "";
  const quota = action.quotaBase === undefined ? "" : ` con cuota base ${action.quotaBase}`;
  const points = action.chicagoPoints
    ? [
        action.chicagoPoints.birdieOrBetter === undefined ? "" : `birdie ${action.chicagoPoints.birdieOrBetter}`,
        action.chicagoPoints.par === undefined ? "" : `par ${action.chicagoPoints.par}`,
        action.chicagoPoints.bogey === undefined ? "" : `bogey ${action.chicagoPoints.bogey}`,
        action.chicagoPoints.doubleBogeyOrWorse === undefined ? "" : `doble ${action.chicagoPoints.doubleBogeyOrWorse}`,
      ].filter(Boolean).join(", ")
    : "";
  const pointDetails = points ? ` con puntos ${points}` : "";
  const rotation = action.rotation === "fixed"
    ? " con parejas fijas"
    : action.rotation === "each_hole"
      ? " con rotación cada hoyo"
      : action.rotation === "blocks"
        ? ` con rotación por bloques${action.blockSize ? ` de ${action.blockSize} hoyos` : ""}`
        : "";
  const penalty = action.birdiePenalty === undefined ? "" : action.birdiePenalty ? " con penalty birdie vs bogey" : " sin penalty de birdie";
  return `${hcp}${matchPlay}${advantage}${quota}${pointDetails}${rotation}${penalty}`;
}

function actionDetails(action: Extract<RoundSetupPlan["interpretation"]["actions"][number], { type: "configure_supplemental_bet" }>) {
  const pair = action.playerAName && action.playerBName ? ` ${action.playerAName} contra ${action.playerBName}` : "";
  const teams = action.teamAPlayerNames?.length && action.teamBPlayerNames?.length
    ? ` ${action.teamAPlayerNames.join("/")} contra ${action.teamBPlayerNames.join("/")}`
    : "";
  const participants = action.participantNames?.length ? ` ${action.participantNames.join(" y ")}` : "";
  const allPlayers = action.allPlayers ? "Todos juegan " : "";
  const exclusions = action.excludedPlayerNames?.length ? ` menos ${action.excludedPlayerNames.join(" y ")}` : "";
  const carry = action.carryEnabled === undefined ? "" : action.carryEnabled ? " con carry" : " sin carry";
  return { pair, teams, participants, allPlayers, exclusions, carry, advanced: advancedSupplementalDetails(action) };
}

function matchupAnswer(answer: string) {
  if (/\b(?:contra|vs\.?|versus)\b/i.test(answer)) return answer;
  const names = answer.split(/\s*(?:\/|,|\s+y\s+|\s+e\s+)\s*/i).map((name) => name.trim()).filter(Boolean);
  return names.length === 2 ? `${names[0]} contra ${names[1]}` : answer;
}

function withPriorCommand(lastCommand: string, target: string) {
  if (!lastCommand.trim() || normalized(lastCommand) === normalized(target)) return target;
  // Parsers deliberately take one occurrence per modality; the resolved slot
  // must come first while the original command keeps every other open slot.
  return `${target.replace(/[.;\s]+$/g, "")}. ${lastCommand}`;
}

/** Rebuilds one executable command from a single clarification without replaying question prose. */
export function roundSetupAnswerCommand(
  question: RoundSetupQuestion | undefined,
  answer: string,
  plan: RoundSetupPlan | null,
  lastCommand: string,
) {
  if (!question) return answer;
  if (question.field === "course") return `Jugamos en ${answer}`;
  if (question.field === "course.tee") return withPriorCommand(lastCommand, `Tee ${answer}`);
  if (question.field === "players") return `Jugamos ${answer}`;
  if (question.field === "players.handicaps") return withPriorCommand(lastCommand, answer);
  if (question.field.startsWith("players.")) {
    const unknown = question.field.slice("players.".length);
    const roster = plan?.interpretation.actions.find((action) => action.type === "replace_players");
    if (roster?.type === "replace_players") {
      const names = roster.playerNames.map((name) => normalized(name) === normalized(unknown) ? answer : name);
      return `Jugamos ${names.join(", ")}. ${lastCommand}`;
    }
    return `Jugamos ${answer}. ${lastCommand}`;
  }
  if (question.field.startsWith("course.")) return `Jugamos en ${answer}. ${lastCommand}`;
  if (question.field === "memory.group") {
    const remaining = withoutAmbiguousMemoryReference(lastCommand);
    return `Con el grupo ${answer}${remaining ? `. ${remaining}` : ""}`;
  }
  if (question.field === "bets.polla") {
    const action = plan?.interpretation.actions.find((candidate) => candidate.type === "configure_group_nassau");
    const exclusions = action?.type === "configure_group_nassau" && action.excludedPlayerNames?.length ? ` menos ${action.excludedPlayerNames.join(" y ")}` : "";
    const advanced = action?.type === "configure_group_nassau" ? handicapAndRoundingDetails(action) : "";
    return withPriorCommand(lastCommand, `Nassau de ${answer}${exclusions}${advanced}`);
  }
  if (question.field === "bets.polla.variant") {
    const form = normalized(answer);
    const variant = /segunda|2a|2da|ultimos/.test(form)
      ? "segunda vuelta"
      : /total|18/.test(form)
        ? "total 18 hoyos"
        : /primera|primer|1a|1ra|primeros/.test(form)
          ? "primera vuelta"
          : answer;
    const priorPolla = pollaClause(lastCommand);
    const amount = amountIn(answer) ?? amountIn(priorPolla);
    const exclusion = exclusionIn(answer) ?? exclusionIn(priorPolla);
    return withPriorCommand(lastCommand, `Polla ${variant}${amount ? ` de ${amount}` : ""}${exclusion ? ` menos ${exclusion}` : ""}`);
  }
  if (question.field === "bets.pressures") {
    const form = normalized(answer);
    const enrich = (target: string) => {
      const amount = amountIn(answer) ?? amountIn(lastCommand);
      const exclusion = exclusionIn(answer) ?? exclusionIn(lastCommand);
      const carry = /\bsin\s+carry\b/i.test(answer) || (!/\b(?:con|sin)\s+carry\b/i.test(answer) && /\bsin\s+carry\b/i.test(lastCommand))
        ? " sin carry"
        : /\bcon\s+carry\b/i.test(answer) || (!/\b(?:con|sin)\s+carry\b/i.test(answer) && /\bcon\s+carry\b/i.test(lastCommand)) ? " con carry" : "";
      const removal = /\b(?:quita(?:mos)?|elimina(?:mos)?|sin|no\s+jugamos)\s+(?:los\s+|las\s+)?(?:press|presses|presiones?)\b/i.test(lastCommand) ? "Quita " : "";
      return `${removal}${target}${amount && !amountIn(target) ? ` de ${amount}` : ""}${exclusion && !/\bmenos\b/i.test(target) ? ` menos ${exclusion}` : ""}${carry && !/\b(?:con|sin)\s+carry\b/i.test(target) ? carry : ""}`;
    };
    if (/individual/.test(form)) return withPriorCommand(lastCommand, enrich(/^presiones?\b/i.test(answer) ? answer : `Presiones individuales ${answer.replace(/^individual(?:es)?\s*/i, "")}`.trim()));
    if (/pareja|equipo/.test(form)) return withPriorCommand(lastCommand, enrich(/^presiones?\b/i.test(answer) ? answer : `Presiones por parejas ${answer.replace(/^(?:por\s+)?(?:parejas?|equipos?)\s*/i, "")}`.trim()));
    return answer;
  }
  if (question.field === "supplementalBets.individual_nassau.value") {
    const nassau = plan?.interpretation.actions.find((action) => action.type === "configure_individual_nassau");
    if (nassau?.type === "configure_individual_nassau") return withPriorCommand(lastCommand, `Nassau ${nassau.playerAName} contra ${nassau.playerBName} de ${answer}`);
  }
  if (question.field === "supplementalBets.individual_nassau.players") {
    const amount = amountIn(lastCommand);
    return withPriorCommand(lastCommand, `Nassau individual ${matchupAnswer(answer)}${amount ? ` de ${amount}` : ""}`);
  }
  if (question.field === "supplementalBets.individual_nassau.instance") {
    const amount = amountIn(lastCommand);
    return withPriorCommand(lastCommand, `Nassau individual ${matchupAnswer(answer)}${amount ? ` de ${amount}` : ""}`);
  }
  if (question.field === "supplementalBets.dollar_stroke.players") {
    const action = plan?.interpretation.actions.find((candidate) => candidate.type === "configure_supplemental_bet" && candidate.betType === "dollar_stroke");
    const value = action?.type === "configure_supplemental_bet" ? action.value : undefined;
    const advanced = action?.type === "configure_supplemental_bet" ? advancedSupplementalDetails(action) : "";
    return withPriorCommand(lastCommand, `Dollar a Stroke ${matchupAnswer(answer)}${value !== undefined ? ` de ${value}` : ""}${advanced}`);
  }
  if (question.field === "supplementalBets.team_pressures.teams" || question.field === "supplementalBets.vegas.teams") {
    const betType = question.field.includes("vegas") ? "vegas" : "team_pressures";
    const action = plan?.interpretation.actions.find((candidate) => candidate.type === "configure_supplemental_bet" && candidate.betType === betType);
    const value = action?.type === "configure_supplemental_bet" ? action.value : undefined;
    const carry = action?.type === "configure_supplemental_bet" && action.carryEnabled !== undefined
      ? action.carryEnabled ? " con carry" : " sin carry"
      : "";
    const advanced = action?.type === "configure_supplemental_bet" ? advancedSupplementalDetails(action) : "";
    return withPriorCommand(lastCommand, `${supplementalLabel(betType)} ${answer}${value !== undefined ? ` de ${value}` : ""}${carry}${advanced}`);
  }
  if (question.field.startsWith("supplementalBets.") && question.field.endsWith(".instance")) {
    const betType = question.field.split(".")[1];
    const action = plan?.interpretation.actions.find((candidate) => candidate.type === "configure_supplemental_bet" && candidate.betType === betType);
    if (action?.type === "configure_supplemental_bet") {
      const selector = action.betType === "dollar_stroke" ? matchupAnswer(answer) : answer;
      const verb = action.enabled === false ? "Quita " : "";
      const amount = action.value !== undefined ? ` de ${action.value}` : "";
      const carry = action.carryEnabled === undefined ? "" : action.carryEnabled ? " con carry" : " sin carry";
      const holes = action.betType === "minimum_putts" && action.holes ? ` a ${action.holes} hoyos` : "";
      return withPriorCommand(lastCommand, `${verb}${supplementalLabel(action.betType)} ${selector}${amount}${carry}${holes}${advancedSupplementalDetails(action)}`);
    }
  }
  if (question.field.startsWith("supplementalBets.") && question.field.endsWith(".value")) {
    const betType = question.field.split(".")[1];
    const action = plan?.interpretation.actions.find((candidate) => candidate.type === "configure_supplemental_bet" && candidate.betType === betType);
    if (action?.type === "configure_supplemental_bet") {
      const { pair, teams, participants, allPlayers, exclusions, carry, advanced } = actionDetails(action);
      const holes = action.betType === "minimum_putts" && action.holes ? ` a ${action.holes} hoyos` : "";
      return withPriorCommand(lastCommand, `${allPlayers}${supplementalLabel(action.betType)}${pair}${teams}${participants} de ${answer}${exclusions}${carry}${holes}${advanced}`);
    }
  }
  const counterPressure = /^bets\.(vipers|camels|fish)\.secondNineMultiplier$/.exec(question.field)?.[1];
  if (counterPressure) {
    const labels: Record<string, string> = { vipers: "Viboritas", camels: "Camellos", fish: "Peces" };
    const action = plan?.interpretation.actions.find((candidate) => candidate.type === "configure_core_bet" && candidate.bet === counterPressure);
    const amount = action?.type === "configure_core_bet" && action.value !== undefined ? ` de ${action.value}` : "";
    const normalizedAnswer = /^\d+$/.test(answer) ? `${answer}x` : answer;
    const pressure = /^sin\s+(?:presion|press)/i.test(normalizedAnswer)
      ? normalizedAnswer
      : `con presión ${normalizedAnswer}`;
    return withPriorCommand(lastCommand, `${labels[counterPressure]}${amount} ${pressure}`);
  }
  if (question.field.endsWith(".value")) {
    const labels: Record<string, string> = {
      "bets.skins.value": "Skins",
      "bets.rabbits.value": "Conejos",
      "bets.units.value": "Unidades",
      "bets.foursome.value": "Foursome",
      "bets.monkey.value": "Monkey",
      "bets.ballFriend.value": "Bola Amiga",
      "bets.miniPolla.value": "Mini Polla",
      "bets.vipers.value": "Viboritas",
      "bets.camels.value": "Camellos",
      "bets.fish.value": "Peces",
      "bets.loba.value": "Loba",
      "bets.polla.first9.value": "Polla primera vuelta",
      "bets.polla.second9.value": "Polla segunda vuelta",
      "bets.polla.total18.value": "Polla total 18 hoyos",
    };
    let target = `${labels[question.field] || question.field} de ${answer}`;
    const coreKey = /^bets\.([^.]+)\.value$/.exec(question.field)?.[1];
    const coreAction = coreKey ? plan?.interpretation.actions.find((action) => action.type === "configure_core_bet" && action.bet === coreKey) : undefined;
    const groupNassau = question.field === "bets.polla" ? plan?.interpretation.actions.find((action) => action.type === "configure_group_nassau") : undefined;
    const ballFriend = question.field === "bets.ballFriend.value" ? plan?.interpretation.actions.find((action) => action.type === "configure_ball_friend") : undefined;
    const pollaComponent = question.field.startsWith("bets.polla.") ? plan?.interpretation.actions.find((action) => action.type === "configure_polla_component" && question.field.includes(action.component)) : undefined;
    const action = coreAction || groupNassau || ballFriend || pollaComponent;
    if (action && "excludedPlayerNames" in action && action.excludedPlayerNames?.length) target += ` menos ${action.excludedPlayerNames.join(" y ")}`;
    if (pollaComponent?.type === "configure_polla_component") target += handicapAndRoundingDetails(pollaComponent);
    if (coreAction?.type === "configure_core_bet" && coreAction.bet === "skins" && coreAction.skinsMode) target += coreAction.skinsMode === "carry" ? " con carry" : " sin carry";
    if (ballFriend?.type === "configure_ball_friend" && ballFriend.teamAPlayerNames?.length && ballFriend.teamBPlayerNames?.length) {
      target = `Bola Amiga ${ballFriend.teamAPlayerNames.join("/")} contra ${ballFriend.teamBPlayerNames.join("/")} de ${answer}`;
    }
    return withPriorCommand(lastCommand, target);
  }
  if (question.field === "ai.clarification") return `${lastCommand}. ${answer}`;
  return answer;
}
