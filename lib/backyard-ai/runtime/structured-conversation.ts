import type { StructuredAction, StructuredActionBatch, StructuredBetKey } from "../schemas/structured-actions";
import { normalizeMexicanSpanish, parseRoundSetupIntent } from "./intent-parser";
import type { StructuredActionHost, StructuredRoundState } from "./structured-session";
import { createStructuredActionSession } from "./structured-session";

export type ActionClarification = { field: string; message: string; options?: { id: string; label: string }[] };
export type StructuredConversationPlan = { batch: StructuredActionBatch | null; questions: ActionClarification[] };
const evidence = { source: "explicit", confidence: 1, evidence: "Instrucción explícita en español" } as const;
const normalize = (value: string) => normalizeMexicanSpanish(value).replace(/^@/, "").trim();

/** Uses the existing deterministic Spanish intent parser; no provider, generated facts or LLM arithmetic. */
export function parseStructuredConversation(input: string, state: StructuredRoundState, host: StructuredActionHost, requestId: string): StructuredConversationPlan {
  const questions: ActionClarification[] = [];
  const actions: StructuredAction[] = [];
  const text = normalize(input);
  const ask = (field: string, message: string, options?: ActionClarification["options"]) => questions.push({ field, message, ...(options ? { options } : {}) });
  if (!text || text.length > 4000 || /\b(?:transferir|transfiere|enviar dinero|paga|custodia|ignora|ignore|system prompt|ejecuta codigo)\b/.test(text)) {
    return { batch: null, questions: [{ field: "instruction", message: "Indica una acción de golf concreta. Este flujo no ejecuta código ni pagos." }] };
  }
  // The legacy convenience parser clamps HCP; this boundary must instead ask
  // about out-of-range facts, never silently change the golfer's stated value.
  for (const hcp of text.matchAll(/\b(?:hcp|handicap)\s*(?:de\s*)?([+-]?\d+(?:[.,]\d+)?)(?![\d.,])/g)) {
    if (/^\s*%/.test(text.slice((hcp.index ?? 0) + hcp[0].length))) continue;
    const raw = Number(hcp[1].replace(",", "."));
    const value = hcp[1].startsWith("+") ? -Math.abs(raw) : raw;
    if (value < -15 || value > 36) return { batch: null, questions: [{ field: "handicap", message: "El handicap de ronda debe estar entre -15 y 36. Confirma el dato sin convertirlo automáticamente." }] };
  }
  const knownPlayers = [...new Map([...host.players, ...state.draft.players].map((item) => [item.id, item])).values()];
  const resolvePlayer = (name: string) => {
    if (/^(yo|mi|me|nosotros)$/.test(normalize(name))) return state.draft.ownerId;
    const matches = knownPlayers.filter((item) => normalize(item.name) === normalize(name) || item.id === name);
    if (matches.length === 1) return matches[0].id;
    ask("player", matches.length ? `Hay varias personas llamadas ${name}. Elige una identidad.` : `Resuelve la identidad de ${name} antes de continuar.`, matches.map((item) => ({ id: item.id, label: item.name })));
    return null;
  };
  let match: RegExpMatchArray | null;
  const betAliases: Record<string, StructuredBetKey> = { skins: "skins", conejos: "rabbits", unidades: "units", nassau: "nassau", foursome: "foursome", monkey: "monkey", "mini polla": "miniPolla", viboras: "vipers", camellos: "camels", peces: "fish", loba: "loba", "bola amiga": "ballFriend" };
  if ((match = text.match(/^(activa|desactiva|quita)\s+(.+)$/)) && Object.hasOwn(betAliases, match[2])) {
    actions.push({ type: match[1] === "activa" ? "enable_bet" : "disable_bet", bet: betAliases[match[2]] });
  } else if ((match = text.match(/^(.+?)\s+para\s+(.+)$/)) && Object.hasOwn(betAliases, match[1])) {
    const ids = match[2].split(/,|\s+y\s+/).map((name) => resolvePlayer(name.trim())).filter((id): id is string => Boolean(id));
    if (ids.length) actions.push({ type: "assign_bet_participants", bet: betAliases[match[1]], playerIds: ids });
  } else if ((match = text.match(/^busca(?:r)?\s+(?:a\s+)?(.+)$/))) actions.push({ type: "find_player", query: match[1] });
  else if ((match = text.match(/^(agrega|quita|elimina)\s+(?:a\s+)?(.+)$/))) {
    const id = resolvePlayer(match[2]);
    if (id) actions.push({ type: match[1] === "agrega" ? "add_player" : "remove_player", playerId: id });
  } else if ((match = text.match(/^(?:selecciona|usa)\s+(?:el\s+)?grupo\s+(.+)$/))) {
    const groups = host.groups.filter((item) => normalize(item.name) === match![1]);
    if (groups.length === 1) actions.push({ type: "select_group", groupId: groups[0].id });
    else ask("group", "Selecciona un grupo existente.", groups.map((item) => ({ id: item.id, label: item.name })));
  } else if (/^(?:inicia|iniciar|empieza)\s+(?:la\s+)?ronda$/.test(text)) actions.push({ type: "start_round" });
  else if (/^(?:estado|como va)(?:\s+(?:de\s+|la\s+)?ronda)?\??$/.test(text)) actions.push({ type: "query_round_status" });
  else if (/^(?:resultados|consulta resultados|cuanto vamos)\??$/.test(text)) actions.push({ type: "query_results" });
  else if ((match = text.match(/^(?:estadisticas|consulta estadisticas)(?:\s+de\s+(.+))?$/))) {
    const id = resolvePlayer(match[1] || "yo");
    if (id) actions.push({ type: "query_statistics", playerId: id });
  } else if ((match = text.match(/^(anota|registra|corrige)\s+(?:(\d+)\s+(golpes?|putts?)\s+(?:de\s+)?(.+?)\s+(?:en\s+)?(?:el\s+)?hoyo\s+(\d+))$/))) {
    const id = resolvePlayer(match[4]);
    if (id) {
      const common = { playerId: id, hole: Number(match[5]) };
      actions.push(match[3].startsWith("putt") ? { type: "record_putts", ...common, putts: Number(match[2]) }
        : { type: match[1] === "corrige" ? "correct_score" : "record_score", ...common, score: Number(match[2]) });
    }
  } else if ((match = text.match(/^fuente\s+(manual|perfil)\s+para\s+(.+)$/))) {
    const id = resolvePlayer(match[2]);
    if (id) actions.push({ type: "set_handicap_source", playerId: id, source: match[1] === "manual" ? "manual" : "profile_index" });
  } else {
    // Exact grammatical expansions preserve all named people, tees and numbers.
    const canonical = input.replace(/\bvoy\s+con\s+/gi, "Jugamos yo, ")
      .replace(/\btodos\s+al\s+(\d+(?:[.,]\d+)?)\s*%/gi, "HCP al $1%")
      .replace(/(?:^|[.;]\s*)([^.;]+?)\s+(blancas?|azules?|negras?|doradas?|rojas?|verdes?|amarillas?)\s+y\s+nosotros\s+(blancas?|azules?|negras?|doradas?|rojas?|verdes?|amarillas?)(?=[.;]|$)/gi,
        ". $1 juega $2 y los demás $3");
    const intent = parseRoundSetupIntent(canonical);
    questions.push(...intent.questions.map((item) => ({ field: item.field, message: item.prompt, ...(item.candidates ? { options: item.candidates } : {}) })));
    if (intent.reference) ask("memory", "Selecciona el grupo guardado explícitamente para esta conversación.");
    const roster = [...state.draft.players.map((item) => item.id)];
    let courseId = state.draft.courseIdentity?.catalogCourseId || state.draft.course?.catalogCourseId || state.draft.course?.id;
    const tee = (name: string, playerIds: string[]) => {
      const options = host.courses.filter((item) => (item.catalogCourseId || item.id) === courseId);
      const found = options.filter((item) => normalize(item.teeName) === normalize(name));
      if (found.length === 1) actions.push({ type: "select_tee", teeId: found[0].catalogTeeId || found[0].id, playerIds });
      else ask("tee", `Elige un tee verificado para ${name}.`, options.map((item) => ({ id: item.catalogTeeId || item.id, label: item.teeName })));
    };
    for (const parsed of intent.actions) {
      switch (parsed.type) {
        case "replace_players":
          for (const name of parsed.playerNames) {
            const id = resolvePlayer(name);
            if (id && !roster.includes(id)) { roster.push(id); actions.push({ type: "add_player", playerId: id }); }
          }
          break;
        case "select_course": {
          const matches = host.courses.filter((item) => normalize(item.name) === normalize(parsed.courseName));
          const layouts = [...new Set(matches.map((item) => item.catalogCourseId || item.id))];
          if (layouts.length === 1) { courseId = layouts[0]; actions.push({ type: "select_course", courseId }); }
          else ask("course", "Selecciona el campo y recorrido existente.", matches.map((item) => ({ id: item.catalogCourseId || item.id, label: item.name })));
          break;
        }
        case "select_tee": tee(parsed.teeName, roster); break;
        case "set_player_tees": {
          const assigned = new Set<string>();
          for (const assignment of parsed.assignments) {
            const id = resolvePlayer(assignment.playerName);
            if (id) { assigned.add(id); tee(assignment.teeName, [id]); }
          }
          if (parsed.defaultTeeName) tee(parsed.defaultTeeName, roster.filter((id) => !assigned.has(id)));
          break;
        }
        case "set_player_handicap": {
          const id = resolvePlayer(parsed.playerName);
          if (id) actions.push({ type: "set_handicap", playerId: id, handicap: parsed.handicap });
          break;
        }
        case "set_round_holes": actions.push({ type: "set_round_holes", holes: parsed.roundHoles }); break;
        case "set_start_hole": actions.push({ type: "set_start_hole", hole: parsed.startHole }); break;
        case "configure_group_nassau": case "configure_polla_component": {
          if (parsed.excludedPlayerNames?.length || (parsed.type === "configure_group_nassau" && parsed.modificationOnly)) {
            ask("participants", "Confirma explícitamente los participantes y componentes de esta apuesta."); break;
          }
          actions.push({ type: "configure_bet", configuration: {
            type: parsed.type, ...evidence, enabled: parsed.enabled,
            ...(parsed.value !== undefined ? { value: parsed.value } : {}),
            ...(parsed.hcpPct !== undefined ? { hcpPct: parsed.hcpPct } : {}),
            ...(parsed.decimals !== undefined ? { decimals: parsed.decimals } : {}),
            ...(parsed.type === "configure_polla_component" ? { component: parsed.component } : {}),
            participantIds: [...roster],
          } as Extract<StructuredAction, { type: "configure_bet" }>["configuration"] });
          break;
        }
        case "configure_core_bet":
          if (parsed.excludedPlayerNames?.length || parsed.foursomeTeamAPlayerNames || parsed.foursomeTeamBPlayerNames) { ask("participants", "Confirma los jugadores y las parejas con selección explícita."); break; }
          actions.push({ type: "configure_bet", configuration: {
            type: "configure_core_bet", ...evidence, bet: parsed.bet, enabled: parsed.enabled, participantIds: [...roster],
            ...(parsed.value !== undefined ? { value: parsed.value } : {}),
            ...(parsed.skinsMode ? { skinsMode: parsed.skinsMode } : {}),
            ...(parsed.secondNinePressed !== undefined ? { secondNinePressed: parsed.secondNinePressed } : {}),
            ...(parsed.secondNineMultiplier !== undefined ? { secondNineMultiplier: parsed.secondNineMultiplier } : {}),
            ...(parsed.foursomeMode ? { foursomeMode: parsed.foursomeMode } : {}),
            ...(parsed.foursomePressureMultiplier ? { foursomePressureMultiplier: parsed.foursomePressureMultiplier } : {}),
          } }); break;
        default: ask("configuration", `La configuración ${parsed.type} requiere selección explícita en esta versión.`);
      }
    }
    if (actions.some((action) => action.type === "select_course") && !actions.some((action) => action.type === "select_tee")) {
      ask("tee", "Selecciona los tees de los jugadores.", host.courses.filter((item) => (item.catalogCourseId || item.id) === courseId).map((item) => ({ id: item.catalogTeeId || item.id, label: item.teeName })));
    }
  }
  if (!actions.length && !questions.length) ask("instruction", "Indica el dato concreto que quieres cambiar.");
  // No partial plan may cross the confirmation boundary while identities/rules remain unresolved.
  return { batch: questions.length ? null : { version: 1, requestId, expectedRevision: state.revision, actions }, questions };
}

/** Ready-to-wire controller: conversation → plan → preview → explicit confirm → canonical draft. */
export function createStructuredConversationController(initial: StructuredRoundState, host: StructuredActionHost) {
  const session = createStructuredActionSession(initial, host);
  return {
    ...session,
    conversation(input: string, requestId: string) {
      const plan = parseStructuredConversation(input, session.snapshot(), host, requestId);
      return { ...plan, preview: plan.batch ? session.preview(plan.batch) : null };
    },
  };
}
