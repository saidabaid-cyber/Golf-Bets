import type { RoundSetupAction } from "../schemas/actions";
import type { RoundSetupDraft } from "../schemas/round-setup";

export type RoundSetupActionValidation =
  | { valid: true }
  | { valid: false; code: string; message: string };

function validConfidence(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validId(value: string) {
  return typeof value === "string" && Boolean(value) && !/\s/.test(value) && value.length <= 200;
}

function validStake(value: number | undefined) {
  return value === undefined || (Number.isFinite(value) && value > 0);
}

function validHcpPercentage(value: number | undefined) {
  return value === undefined || (Number.isFinite(value) && value >= 0 && value <= 100);
}

function validRequiredHcpPercentage(value: number | undefined) {
  return value !== undefined && validHcpPercentage(value);
}

function validHandicapMode(value: unknown) {
  return value === "partial" || value === "round" || value === "decimal" || value === "half_up"
    || value === "half_down" || value === "six_up" || value === "four_down";
}

function validDecimalMode(value: unknown) {
  return value === "partial" || value === "round";
}

function participantsBelongToDraft(ids: string[] | undefined, draft: RoundSetupDraft) {
  if (ids === undefined) return true;
  const available = new Set(draft.players.map((player) => player.id));
  return ids.length === new Set(ids).size && ids.every((id) => available.has(id));
}

function supplementalParticipantIds(action: Extract<RoundSetupAction, { type: "upsert_supplemental_bet" }>) {
  const bet = action.bet;
  if (bet.type === "dollar_stroke") return [bet.playerAId, bet.playerBId];
  if (bet.type === "individual_pressures" || bet.type === "team_pressures" || bet.type === "chicago" || bet.type === "vegas" || bet.type === "minimum_putts") return bet.participantIds;
  return [];
}

function validSupplementalStake(action: Extract<RoundSetupAction, { type: "upsert_supplemental_bet" }>) {
  const bet = action.bet;
  if (!bet.enabled) return true;
  if (bet.type === "dollar_stroke") return validStake(bet.valuePerStroke) && bet.valuePerStroke !== undefined;
  if (bet.type === "individual_pressures" || bet.type === "team_pressures") return validStake(bet.value) && bet.value !== undefined;
  if (bet.type === "chicago") return validStake(bet.valuePerPoint) && bet.valuePerPoint !== undefined;
  if (bet.type === "vegas") return validStake(bet.valuePerUnit) && bet.valuePerUnit !== undefined;
  if (bet.type === "minimum_putts") return validStake(bet.ante) && bet.ante !== undefined;
  return false;
}

export function validateRoundSetupAction(action: RoundSetupAction, draft: RoundSetupDraft): RoundSetupActionValidation {
  if (!validConfidence(action.confidence)) return { valid: false, code: "confidence", message: "La acción no tiene una confianza válida." };

  switch (action.type) {
    case "replace_players": {
      const ids = action.players.map((player) => player.id);
      if (!action.players.length || ids.some((id) => !validId(id)) || ids.length !== new Set(ids).size) {
        return { valid: false, code: "players", message: "La lista de jugadores contiene identidades inválidas o repetidas." };
      }
      if (action.players.some((player) => typeof player.name !== "string" || !player.name.trim())) {
        return { valid: false, code: "players", message: "Todos los jugadores necesitan un nombre." };
      }
      if (!ids.includes(action.ownerId)) return { valid: false, code: "owner", message: "El jugador principal debe pertenecer a la ronda." };
      return { valid: true };
    }
    case "set_player_handicap":
      return validId(action.playerId)
        && draft.players.some((player) => player.id === action.playerId)
        && Number.isFinite(action.handicap)
        && action.handicap >= -15
        && action.handicap <= 54
        ? { valid: true }
        : { valid: false, code: "player-handicap", message: "El handicap debe pertenecer a un jugador de la ronda y estar entre -15 y 54." };
    case "identify_course":
      return action.courseName.trim()
        && action.candidateCourseIds.length > 1
        && action.candidateCourseIds.every(validId)
        && new Set(action.candidateCourseIds).size === action.candidateCourseIds.length
        ? { valid: true }
        : { valid: false, code: "course", message: "La identidad del campo o sus tees disponibles no son válidos." };
    case "select_course": {
      const holes = action.course.holes;
      if (!validId(action.course.id) || !action.course.name.trim() || !Array.isArray(holes) || holes.length !== 18) {
        return { valid: false, code: "course", message: "El campo seleccionado no corresponde a una definición existente completa." };
      }
      return { valid: true };
    }
    case "set_start_hole":
      return action.startHole === 1 || action.startHole === 10
        ? { valid: true }
        : { valid: false, code: "start-hole", message: "La salida debe ser por el hoyo 1 o 10." };
    case "set_round_holes":
      return action.roundHoles === 9 || action.roundHoles === 18
        ? { valid: true }
        : { valid: false, code: "round-holes", message: "La ronda debe ser de 9 o 18 hoyos." };
    case "set_handicap_basis":
      return action.handicapBasis === "relative" || action.handicapBasis === "course"
        ? { valid: true }
        : { valid: false, code: "handicap-basis", message: "El sistema de ventajas no existe." };
    case "configure_core_bet":
    case "configure_group_nassau":
    case "configure_polla_component":
    case "configure_ball_friend":
      if (!validStake(action.value)) return { valid: false, code: "stake", message: "El monto debe ser un número positivo." };
      if ((action.type === "configure_group_nassau" || action.type === "configure_polla_component")
        && (!validHcpPercentage(action.hcpPct) || (action.decimals !== undefined && !validDecimalMode(action.decimals)))) {
        return { valid: false, code: "polla-handicap", message: "La Polla necesita un HCP entre 0 y 100 y un redondeo válido." };
      }
      if (action.type === "configure_core_bet" && action.skinsMode !== undefined && action.bet !== "skins") {
        return { valid: false, code: "skins-mode", message: "El modo acumulable sólo corresponde a Skins." };
      }
      if (action.type === "configure_core_bet") {
        const hasCounterPressure = action.secondNinePressed !== undefined || action.secondNineMultiplier !== undefined;
        const isCounterBet = action.bet === "vipers" || action.bet === "camels" || action.bet === "fish";
        const validPressedPressure = action.secondNinePressed === true
          && Number.isInteger(action.secondNineMultiplier)
          && (action.secondNineMultiplier ?? 0) >= 2
          && (action.secondNineMultiplier ?? 0) <= 5;
        const validNoPressure = action.secondNinePressed === false && action.secondNineMultiplier === undefined;
        if (hasCounterPressure && (!isCounterBet || (!validPressedPressure && !validNoPressure))) {
          return { valid: false, code: "counter-pressure", message: "La presión sólo corresponde a Viboritas, Camellos o Peces y necesita un multiplicador entero entre 2x y 5x." };
        }
      }
      if (!participantsBelongToDraft(action.participantIds, draft)) {
        return { valid: false, code: "participants", message: "La acción contiene participantes ajenos a la ronda o repetidos." };
      }
      if (action.type === "configure_group_nassau"
        && Object.values(action.participantIdsByComponent ?? {}).some((ids) => !participantsBelongToDraft(ids, draft))) {
        return { valid: false, code: "participants", message: "La acción de Nassau contiene participantes ajenos a la ronda o repetidos." };
      }
      if (action.type === "configure_group_nassau" && action.componentScope !== undefined) {
        const allowedComponents = new Set(["first9", "second9", "total18"]);
        if (!action.componentScope.length
          || new Set(action.componentScope).size !== action.componentScope.length
          || action.componentScope.some((component) => !allowedComponents.has(component))) {
          return { valid: false, code: "polla-components", message: "El alcance de componentes de Nassau no es válido." };
        }
      }
      if (action.type === "configure_ball_friend" && action.teamA) {
        const selected = new Set(action.participantIds ?? draft.players.map((player) => player.id));
        if (action.teamA.length !== 2 || new Set(action.teamA).size !== 2 || !action.teamA.every((id) => selected.has(id))) {
          return { valid: false, code: "ball-friend-team", message: "Bola Amiga necesita una pareja válida dentro de sus participantes." };
        }
      }
      return { valid: true };
    case "upsert_supplemental_bet": {
      if (!validId(action.bet.id) || action.bet.type === "individual_nassau" || typeof action.bet.enabled !== "boolean") {
        return { valid: false, code: "supplemental-bet", message: "La modalidad suplementaria no corresponde al catálogo permitido." };
      }
      const participantIds = supplementalParticipantIds(action);
      if (!participantsBelongToDraft(participantIds, draft) || new Set(participantIds).size !== participantIds.length) {
        return { valid: false, code: "supplemental-participants", message: "La modalidad suplementaria contiene jugadores ajenos o repetidos." };
      }
      if (!validSupplementalStake(action)) return { valid: false, code: "supplemental-stake", message: "El monto de la modalidad suplementaria debe ser positivo." };
      if (action.bet.enabled) {
        const bet = action.bet;
        if (bet.type === "dollar_stroke") {
          const validReceiver = bet.advantageReceiverId === undefined || bet.advantageReceiverId === bet.playerAId || bet.advantageReceiverId === bet.playerBId;
          if (!Number.isInteger(bet.advantageStrokes) || bet.advantageStrokes < 0 || !validReceiver || (bet.advantageStrokes > 0 && !bet.advantageReceiverId)) {
            return { valid: false, code: "supplemental-advantage", message: "Dollar a Stroke necesita golpes enteros no negativos y un receptor de la pareja cuando hay ventaja." };
          }
        }
        if (bet.type === "individual_pressures") {
          if (!validRequiredHcpPercentage(bet.hcpPct) || !validHandicapMode(bet.decimals) || typeof bet.carryEnabled !== "boolean" || typeof bet.matchPlayEnabled !== "boolean") {
            return { valid: false, code: "supplemental-pressures", message: "Presiones individuales contiene una configuración de HCP, redondeo, carry o Match Play inválida." };
          }
        }
        if (bet.type === "team_pressures") {
          if (!validRequiredHcpPercentage(bet.hcpPct) || !validHandicapMode(bet.decimals) || typeof bet.carryEnabled !== "boolean"
            || !["low", "high", "low_high"].includes(bet.metric) || !["standard", "mudo", "yoyo"].includes(bet.virtualMode)) {
            return { valid: false, code: "supplemental-team-pressures", message: "Presiones por parejas contiene una configuración avanzada inválida." };
          }
        }
        if (bet.type === "chicago") {
          const pointValues = bet.points
            ? [bet.points.birdieOrBetter, bet.points.par, bet.points.bogey, bet.points.doubleBogeyOrWorse]
            : null;
          if (!validHcpPercentage(bet.hcpPct) || !Number.isFinite(bet.quotaBase) || !pointValues || !pointValues.every(Number.isFinite)) {
            return { valid: false, code: "supplemental-chicago", message: "Chicago necesita una cuota, porcentaje HCP y tabla de puntos válidos." };
          }
        }
        if (bet.type === "vegas") {
          const validRotation = bet.rotation === "fixed" || bet.rotation === "each_hole" || bet.rotation === "blocks";
          const validBlockSize = bet.rotation !== "blocks" || bet.blockSize === 3 || bet.blockSize === 6 || bet.blockSize === 9;
          if (!validRequiredHcpPercentage(bet.hcpPct) || !validHandicapMode(bet.decimals) || !validRotation || !validBlockSize || typeof bet.birdiePenalty !== "boolean") {
            return { valid: false, code: "supplemental-vegas", message: "Vegas contiene una configuración de HCP, redondeo, rotación, bloques o penalty inválida." };
          }
        }
      }
      return { valid: true };
    }
    case "configure_individual_nassau":
      if (!validId(action.id) || !validStake(action.value)) return { valid: false, code: "individual-nassau", message: "El Nassau individual tiene identidad o monto inválidos." };
      if (action.playerAId === action.playerBId || !participantsBelongToDraft([action.playerAId, action.playerBId], draft)) {
        return { valid: false, code: "individual-nassau-players", message: "El Nassau individual necesita dos jugadores distintos de la ronda." };
      }
      return { valid: true };
    case "remove_nassau":
      return { valid: true };
  }
}
