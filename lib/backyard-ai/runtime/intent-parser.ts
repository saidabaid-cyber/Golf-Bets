import type {
  CoreRoundBetKey,
  ParsedRoundSetupAction,
  RoundMemoryReference,
  RoundSetupInterpretation,
  RoundSetupQuestion,
} from "../schemas/actions";
import type { DecimalMode, HandicapMode } from "../../types";

const CORE_ALIASES: ReadonlyArray<{ bet: CoreRoundBetKey; aliases: readonly string[] }> = [
  { bet: "miniPolla", aliases: ["mini polla"] },
  { bet: "rabbits", aliases: ["conejos", "conejo"] },
  { bet: "skins", aliases: ["skins", "skin"] },
  { bet: "units", aliases: ["unidades", "copas", "copa"] },
  { bet: "foursome", aliases: ["foursomes", "foursome"] },
  { bet: "vipers", aliases: ["viboritas", "viborita", "viboras", "vibora"] },
  { bet: "camels", aliases: ["camellos", "camello"] },
  { bet: "fish", aliases: ["peces/agua", "peces", "pez"] },
  { bet: "loba", aliases: ["loba"] },
  { bet: "monkey", aliases: ["monkey"] },
];

const BET_TERMS = [
  "bola amiga", "mini polla", "nassau", "skins", "skin", "conejos", "conejo", "unidades", "copas", "copa",
  "foursomes", "foursome", "viboritas", "viborita", "viboras", "vibora", "camellos", "camello", "peces/agua", "peces", "pez",
  "loba", "monkey", "presses", "press", "presion", "presiones", "polla", "personales", "oyes",
  "dollar a stroke", "dolar a stroke", "chicago", "vegas", "minimo de putts", "menos putts",
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Locale-aware comparison form. It is never persisted as a player/course name. */
export function normalizeMexicanSpanish(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMexicanMoney(value: string | undefined) {
  if (!value) return undefined;
  let normalized = value.replace(/[$\s]/g, "");
  if (!normalized) return undefined;
  if (normalized.includes(",") && normalized.includes(".")) normalized = normalized.replace(/,/g, "");
  else if (normalized.includes(",")) {
    const pieces = normalized.split(",");
    normalized = pieces.length === 2 && pieces[1].length !== 3 ? `${pieces[0]}.${pieces[1]}` : pieces.join("");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) normalized = normalized.replace(/\./g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function cleanName(value: string) {
  return value
    .replace(/^[\s,'"-]+|[\s,'"-]+$/g, "")
    .replace(/^(?:los jugadores|jugadores)\s+/i, "")
    .replace(/^(?:hoy\s+)?jugamos\s+/i, "")
    .replace(/\s+(?:hcp|handicap)\s*(?:de\s*)?[+-]?\d+(?:[.,]\d+)?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitNames(value: string) {
  return value
    .split(/\s*(?:,|\/|\+|\s+y\s+|\s+e\s+)\s*/i)
    .map(cleanName)
    .filter(Boolean);
}

function amountAfterAlias(normalized: string, alias: string) {
  const expression = new RegExp(`\\b${escapeRegExp(alias)}\\b\\s*(?:(?:mejor|ahora)\\s+)?(?:(?:de|a|por|en)\\s*)?\\$?\\s*([\\d][\\d.,]*)`, "i");
  return parseMexicanMoney(expression.exec(normalized)?.[1]);
}

const COUNTER_BETS = new Set<CoreRoundBetKey>(["vipers", "camels", "fish"]);
const COUNTER_PRESSURE_TERM = /\b(?:presion(?:ada|adas|es)?|press(?:es)?)\b/i;
const NASSAU_ADVANCED_TERM = /\b(?:carry|multiplicador|presion(?:ada|adas|es)?|press(?:es)?)\b|\b\d+\s*x\b/i;

function counterPressureFromClause(clause: string) {
  if (!COUNTER_PRESSURE_TERM.test(clause)) return { mentioned: false } as const;
  const withoutPressure = /\bsin\s+(?:presion(?:ada|adas|es)?|press(?:es)?)\b/i.test(clause);
  const rawMultiplier = /\b(\d+)\s*x\b/i.exec(clause)?.[1];
  const multiplier = rawMultiplier === undefined ? undefined : Number(rawMultiplier);
  if (withoutPressure) {
    return multiplier !== undefined && multiplier > 1
      ? { mentioned: true } as const
      : { mentioned: true, secondNinePressed: false } as const;
  }
  if (multiplier !== undefined && Number.isInteger(multiplier) && multiplier >= 2 && multiplier <= 5) {
    return { mentioned: true, secondNinePressed: true, secondNineMultiplier: multiplier } as const;
  }
  return { mentioned: true } as const;
}

function scopedCounterPressureClause(normalized: string, alias: string) {
  const pressure = "(?:presion(?:ada|adas|es)?|press(?:es)?)";
  const optionalAmount = "(?:\\s*(?:(?:mejor|ahora)\\s+)?(?:(?:de|a|por|en)\\s*)?\\$?\\s*[\\d][\\d.,]*)?";
  return new RegExp(`\\b${escapeRegExp(alias)}\\b${optionalAmount}\\s+(?:con\\s+)?(?:sin\\s+)?${pressure}(?:\\s+(?:de|a|por))?\\s*(?:\\d+\\s*x)?`, "i")
    .exec(normalized)?.[0] ?? "";
}

function scopedGroupNassauAdvancedClause(normalized: string) {
  const optionalAmount = "(?:\\s*(?:(?:mejor|ahora)\\s+)?(?:(?:de|a|por|en)\\s*)?\\$?\\s*[\\d][\\d.,]*)?";
  const advanced = "(?:(?:sin|con)\\s+carry|(?:con\\s+)?(?:presion(?:ada|adas|es)?|press(?:es)?)(?:\\s+(?:de|a|por))?\\s*(?:\\d+\\s*x)?|(?:con\\s+)?multiplicador(?:\\s+de)?\\s*\\d+\\s*x|\\d+\\s*x)";
  return new RegExp(`\\bnassau\\b${optionalAmount}\\s+${advanced}`, "i").exec(normalized)?.[0] ?? "";
}

/** "Agua" is a real local alias for Peces only in an explicit betting clause.
 * This prevents course names or ordinary mentions of water from activating it. */
function explicitFishWaterAlias(normalized: string) {
  if (!/\bagua\b/i.test(normalized)) return undefined;
  const clause = clauseContaining(normalized, /\bagua\b/i);
  const hasAmount = amountAfterAlias(clause, "agua") !== undefined;
  const explicitRemoval = hasRemovalNearAlias(normalized, "agua");
  const explicitCommand = /(?:^|[.;]\s*|\by\s+|,\s*)(?:(?:agrega|pon|activa|jugamos|juguemos|todos\s+juegan)\s+)(?:la\s+|el\s+|los\s+)?agua\b/i.test(normalized);
  const standaloneClause = /(?:^|[.;]\s*|,\s*)agua\s*(?:[.;]|$)/i.test(normalized);
  return hasAmount || explicitRemoval || explicitCommand || standaloneClause ? "agua" : undefined;
}

function hasRemovalNearAlias(normalized: string, alias: string) {
  const expression = new RegExp(`(?:quita(?:mos)?|elimina(?:mos)?|sin|no\\s+jugamos)\\s+(?:la\\s+|el\\s+|los\\s+|las\\s+)?${escapeRegExp(alias)}\\b`, "i");
  return expression.test(normalized);
}

function excludedNamesFor(normalized: string, alias: string) {
  const escaped = escapeRegExp(alias);
  const after = new RegExp(`\\b${escaped}\\b[^.;]*?\\bmenos\\s+([^.;]+)`, "i").exec(normalized)?.[1];
  if (after) return splitNames(after
    .replace(/\s+(?:de|a|por)\s+\$?[\d.,]+.*$/i, "")
    .replace(/\s+(?:con|sin)\s+carry.*$/i, ""));
  const before = new RegExp(`(?:^|[.;])\\s*([^.;,]+?)\\s+(?:(?:hoy|nunca)\\s+)?no\\s+juega\\s+(?:la\\s+|el\\s+)?${escaped}\\b|(?:^|[.;])\\s*([^.;,]+?)\\s+nunca\\s+juega\\s+(?:la\\s+|el\\s+)?${escaped}\\b`, "i").exec(normalized);
  return before ? [cleanName(before[1] || before[2])] : [];
}

function scopedExcludedNames(normalized: string, clause: string, alias: string) {
  const local = excludedNamesFor(clause, alias);
  if (local.length) return local;
  const escaped = escapeRegExp(alias);
  const before = new RegExp(`(?:^|[.;])\\s*([^.;,]+?)\\s+(?:(?:hoy|nunca)\\s+)?no\\s+juega\\s+(?:la\\s+|el\\s+)?${escaped}\\b|(?:^|[.;])\\s*([^.;,]+?)\\s+nunca\\s+juega\\s+(?:la\\s+|el\\s+)?${escaped}\\b`, "i").exec(normalized);
  return before ? [cleanName(before[1] || before[2])] : [];
}

function removedImmediatelyBefore(normalized: string, aliasIndex: number) {
  return /(?:^|[.;]\s*|\by\s+)(?:quita(?:mos)?|elimina(?:mos)?|sin|no\s+jugamos)\s+(?:la\s+|el\s+|los\s+|las\s+)?$/i.test(normalized.slice(0, aliasIndex));
}

function removedInCoordinatedPollaList(normalized: string, aliasIndex: number) {
  return /(?:^|[.;]\s*)(?:quita(?:mos)?|elimina(?:mos)?|sin|no\s+jugamos)\s+(?:la\s+)?polla\b[^.;]*\by\s+$/i
    .test(normalized.slice(0, aliasIndex));
}

function allPlayersFor(normalized: string, alias: string) {
  return new RegExp(`\\b(?:todos\\s+juegan|jugamos\\s+todos)\\s+(?:los\\s+|las\\s+|el\\s+|la\\s+)?${escapeRegExp(alias)}\\b`, "i").test(normalized);
}

function parseHandicap(value: string) {
  const normalized = value.replace(",", ".");
  const numeric = Number(normalized);
  const handicap = normalized.trim().startsWith("+") ? -Math.abs(numeric) : numeric;
  return Number.isFinite(handicap) && handicap >= -15 && handicap <= 54 ? handicap : undefined;
}

function parsePlayerHandicaps(input: string): ParsedRoundSetupAction[] {
  const actions: ParsedRoundSetupAction[] = [];
  const seen = new Set<string>();
  const add = (playerName: string, rawHandicap: string, evidence: string) => {
    const name = cleanName(playerName);
    const handicap = parseHandicap(rawHandicap);
    const key = normalizeMexicanSpanish(name);
    if (!name || handicap === undefined || seen.has(key)) return;
    seen.add(key);
    actions.push({ type: "set_player_handicap", playerName: name, handicap, confidence: 0.99, evidence });
  };
  for (const match of input.matchAll(/(?:^|[,.;]|\s+y\s+|\s+e\s+)\s*([^,.;]+?)\s+(?:hcp|handicap)\s*(?:de\s*)?([+-]?\d+(?:[.,]\d+)?)/gi)) {
    add(match[1], match[2], match[0].trim());
  }
  for (const leading of input.matchAll(/(?:^|[,.;]|\s+y\s+|\s+e\s+)\s*(?:hcp|handicap)\s+de\s+([^,.;]+?)\s+(?:es\s+|=\s*)?([+-]?\d+(?:[.,]\d+)?)/gi)) {
    add(leading[1], leading[2], leading[0].trim());
  }
  return actions;
}

function parseTee(input: string): ParsedRoundSetupAction | undefined {
  const match = /\btee\s+(?:de\s+)?["']?([a-záéíóúüñ0-9][a-záéíóúüñ0-9 -]{0,30}?)["']?(?=[,.;]|\s+(?:y|con)\s+(?:skins?|nassau|bola amiga|conejos?|unidades?|foursomes?)\b|$)/i.exec(input);
  const teeName = cleanName(match?.[1] ?? "");
  return teeName ? { type: "select_tee", teeName, confidence: 0.98, evidence: match![0].trim() } : undefined;
}

function parseRoster(input: string): ParsedRoundSetupAction | undefined {
  // A decimal point is protected only when it has a digit on both sides.
  // Sentence punctuation after a numeric HCP must still end the roster.
  const sentences = input.split(/;|\n|(?<!\d)\.|\.(?!\d)/);
  for (const sentence of sentences) {
    const match = /^(?:\s*hoy\s+)?\s*jugamos\s+(.+)$/i.exec(sentence.trim());
    if (!match) continue;
    let roster = match[1].trim();
    const normalizedRoster = normalizeMexicanSpanish(roster);
    if (/^(?:los mismos|lo mismo|como|solo|solamente)\b/.test(normalizedRoster)) continue;
    const explicitWaterBetIndex = explicitFishWaterAlias(normalizedRoster)
      ? normalizedRoster.search(/\bagua\b/i)
      : -1;
    const firstBetIndex = BET_TERMS.reduce((lowest, term) => {
      const index = normalizedRoster.search(new RegExp(`\\b${escapeRegExp(term)}\\b`, "i"));
      return index >= 0 && (lowest < 0 || index < lowest) ? index : lowest;
    }, explicitWaterBetIndex);
    if (firstBetIndex === 0) continue;
    if (firstBetIndex > 0) roster = roster.slice(0, firstBetIndex);
    // Course and round options belong to later structured fields, even when
    // the user keeps the whole setup in one natural-language sentence.
    const courseIndex = roster.search(/\s+en\s+(?:el\s+campo\s+)?[^,.;]+(?=\s*(?:,|$))/i);
    if (courseIndex > 0) roster = roster.slice(0, courseIndex);
    roster = roster.replace(/,\s*(?:salimos|salida|empezamos|iniciamos|(?:9|18)\s+hoyos|tee\b).*$/i, "").trim();
    // Remove HCP annotations before splitting names so decimal commas and the
    // golf plus sign cannot become fake roster separators.
    roster = roster.replace(/\s+(?:hcp|handicap)\s*(?:de\s*)?[+-]?\d+(?:[.,]\d+)?/gi, "");
    const names = splitNames(roster);
    if (names.length >= 2) {
      return { type: "replace_players", playerNames: names, confidence: 0.99, evidence: sentence.trim() };
    }
  }
  return undefined;
}

function parseCourse(input: string, normalized: string, reference?: RoundMemoryReference): ParsedRoundSetupAction | undefined {
  if (reference?.type === "last_round_at_course") return undefined;
  const betLookahead = BET_TERMS.map(escapeRegExp).join("|");
  const expression = new RegExp(`\\ben\\s+(?:el\\s+campo\\s+)?(.+?)(?=,\\s*(?:salimos|salida|empezamos|iniciamos|(?:9|18)\\s+hoyos|tee\\b)|,?\\s+(?:${betLookahead})\\b|[.;]|$)`, "i");
  const match = expression.exec(input);
  if (!match) return undefined;
  const name = cleanName(match[1]);
  if (!name || /^(?:parejas?|equipo|el\s+hoyo)$/i.test(name)) return undefined;
  return { type: "select_course", courseName: name, confidence: 0.96, evidence: match[0].trim() };
}

function parseReference(input: string, normalized: string): RoundMemoryReference | undefined {
  const lastAtCourse = /(?:como\s+(?:jugamos\s+)?la\s+ultima\s+vez|igual\s+que\s+la\s+ultima\s+vez)\s+en\s+(.+?)(?:[.;]|$)/i.exec(normalized);
  if (lastAtCourse) return { type: "last_round_at_course", courseName: cleanName(lastAtCourse[1]) };
  if (/\blos mismos(?:\s+\w+)?\s+del domingo\b/i.test(normalized)) return { type: "same_players_last_sunday" };
  const usual = /\blos mismos(?:\s+(\d+|cuatro|cinco|tres))?\s+de siempre\b/i.exec(normalized);
  if (usual) {
    const counts: Record<string, number> = { tres: 3, cuatro: 4, cinco: 5 };
    const playerCount = usual[1] ? Number(usual[1]) || counts[usual[1]] : undefined;
    return { type: "same_usual_group", ...(playerCount ? { playerCount } : {}) };
  }
  if (/\bcomo (?:jugamos )?la semana pasada\b/i.test(normalized)) return { type: "same_as_last_week" };
  const group = /(?:como\s+(?:el|con)\s+|con\s+(?:el|mi)\s+)?grupo\s+["']?(.+?)["']?(?=[,.;]|$)/i.exec(input);
  if (group) return { type: "frequent_group", groupName: cleanName(group[1]) };
  if (/\b(?:lo mismo|igual que la ultima vez|como la ultima vez)\b/i.test(normalized)) return { type: "same_as_previous" };
  return undefined;
}

function individualNassau(normalized: string): ParsedRoundSetupAction | undefined {
  const fullClause = clauseContaining(normalized, /\bnassau\b/i);
  const clause = /\bnassau(?:\s+individual)?(?:\s+entre)?\s+(.+)$/i.exec(fullClause)?.[1];
  if (!clause || !/\s+(?:contra|vs\.?|versus)\s+/i.test(clause)) return undefined;
  const amountMatch = /\s+(?:de|a|por)\s+\$?\s*([\d][\d.,]*)\s*$/i.exec(clause);
  const playersClause = amountMatch ? clause.slice(0, amountMatch.index).trim() : clause.trim();
  const players = playersClause.split(/\s+(?:contra|vs\.?|versus)\s+/i);
  if (players.length !== 2) return undefined;
  const playerAName = cleanName(players[0]);
  const playerBName = cleanName(players[1]);
  if (!playerAName || !playerBName) return undefined;
  return {
    type: "configure_individual_nassau",
    enabled: !hasRemovalNearAlias(normalized, "nassau"),
    playerAName,
    playerBName,
    value: parseMexicanMoney(amountMatch?.[1]),
    confidence: 0.98,
    evidence: `nassau ${clause}`,
  };
}

function ballFriend(normalized: string): ParsedRoundSetupAction | undefined {
  if (!/\bbola amiga\b/i.test(normalized)) return undefined;
  const clause = clauseContaining(normalized, /\bbola amiga\b/i);
  const teams = /\bbola amiga\s+(.+?)\s+(?:contra|vs\.?|versus)\s+(.+?)$/i.exec(clause);
  const teamAPlayerNames = teams ? splitNames(teams[1]) : undefined;
  const teamBText = teams?.[2]?.replace(/\s+(?:de|a|por)\s+\$?\s*[\d][\d.,]*\s*$/i, "");
  const teamBPlayerNames = teamBText ? splitNames(teamBText) : undefined;
  return {
    type: "configure_ball_friend",
    enabled: !hasRemovalNearAlias(normalized, "bola amiga"),
    value: parseMexicanMoney(/\s+(?:de|a|por)\s+\$?\s*([\d][\d.,]*)\s*$/i.exec(teams?.[0] ?? "")?.[1])
      ?? amountAfterAlias(clause, "bola amiga"),
    ...(teamAPlayerNames?.length ? { teamAPlayerNames } : {}),
    ...(teamBPlayerNames?.length ? { teamBPlayerNames } : {}),
    excludedPlayerNames: scopedExcludedNames(normalized, clause, "bola amiga"),
    allPlayers: allPlayersFor(normalized, "bola amiga"),
    confidence: teams ? 0.99 : 0.94,
    evidence: clause || "bola amiga",
  };
}

function groupNassau(normalized: string, individual?: ParsedRoundSetupAction): ParsedRoundSetupAction | undefined {
  if (!/\bnassau\b/i.test(normalized)
    || /\bnassau\s+individual\b/i.test(normalized)
    || individual?.type === "configure_individual_nassau") return undefined;
  const clause = clauseContaining(normalized, /\bnassau\b/i);
  const advancedClause = scopedGroupNassauAdvancedClause(normalized);
  const nassauIndex = normalized.search(/\bnassau\b/i);
  const modificationOnly = nassauIndex >= 0
    && /(?:^|[.;]\s*|\by\s+)(?:mejor|cambia(?:mos)?|ajusta(?:mos)?|modifica(?:mos)?)\s*$/i.test(normalized.slice(0, nassauIndex));
  return {
    type: "configure_group_nassau",
    enabled: !hasRemovalNearAlias(normalized, "nassau"),
    value: amountAfterAlias(clause, "nassau"),
    excludedPlayerNames: scopedExcludedNames(normalized, clause, "nassau"),
    allPlayers: allPlayersFor(normalized, "nassau"),
    ...(hcpPercentageFromClause(clause) !== undefined ? { hcpPct: hcpPercentageFromClause(clause) } : {}),
    ...(pollaDecimalModeFromClause(clause) ? { decimals: pollaDecimalModeFromClause(clause) } : {}),
    ...(modificationOnly ? { modificationOnly: true } : {}),
    confidence: 0.97,
    evidence: advancedClause || clause || "nassau",
  };
}

function pollaComponents(normalized: string): ParsedRoundSetupAction[] {
  const definitions: Array<{ component: "first9" | "second9" | "total18"; pattern: RegExp }> = [
    { component: "first9", pattern: /(?:\bpolla\s+(?:(?:de\s+)?la\s+)?(?:primera|primer|1a|1ra)\s+(?:vuelta|nueve)|\bpolla\s+(?:de\s+)?(?:los\s+)?primeros\s+9\b)/i },
    { component: "second9", pattern: /(?:\bpolla\s+(?:(?:de\s+)?la\s+)?(?:segunda|2a|2da)\s+(?:vuelta|nueve)|\bpolla\s+(?:de\s+)?(?:los\s+)?ultimos\s+9\b)/i },
    { component: "total18", pattern: /\bpolla\s+(?:(?:total\s+)?(?:de\s+)?18\s+hoyos|total)\b/i },
  ];
  return definitions.flatMap((definition): ParsedRoundSetupAction[] => {
    const match = new RegExp(definition.pattern.source, definition.pattern.flags.replace("g", "")).exec(normalized);
    if (!match || match.index === undefined) return [];
    const clause = clauseContaining(normalized, definition.pattern);
    const localMatch = new RegExp(definition.pattern.source, definition.pattern.flags.replace("g", "")).exec(clause);
    const afterVariant = localMatch ? clause.slice((localMatch.index ?? 0) + localMatch[0].length) : "";
    const value = parseMexicanMoney(/^\s*(?:de|a|por)\s+\$?\s*([\d][\d.,]*)\b/i.exec(afterVariant)?.[1]);
    const removed = removedImmediatelyBefore(normalized, match.index)
      || (value === undefined && removedInCoordinatedPollaList(normalized, match.index));
    const hcpPct = hcpPercentageFromClause(clause);
    const decimals = pollaDecimalModeFromClause(clause);
    return [{
      type: "configure_polla_component",
      component: definition.component,
      enabled: !removed,
      value,
      excludedPlayerNames: scopedExcludedNames(normalized, clause, "polla"),
      allPlayers: allPlayersFor(normalized, "polla"),
      ...(hcpPct !== undefined ? { hcpPct } : {}),
      ...(decimals ? { decimals } : {}),
      confidence: 0.97,
      evidence: clause,
    }];
  });
}

function clauseContaining(normalized: string, pattern: RegExp) {
  const matcher = new RegExp(pattern.source, pattern.flags.replace("g", ""));
  const match = matcher.exec(normalized);
  if (!match || match.index === undefined) return "";
  const fromAlias = normalized.slice(match.index);
  const tail = fromAlias.slice(match[0].length);
  const nextBet = BET_TERMS.map(escapeRegExp).join("|");
  const boundary = new RegExp(`(?:(?:;|\\.(?!\\d))|(?:\\s*,?\\s+y\\s+|\\s*,\\s*|\\s+con\\s+)(?=(?:(?:agrega|pon|jugamos|juguemos)\\s+)?(?:(?:la|el|los|las)\\s+)?(?:${nextBet})\\b))`, "i").exec(tail);
  return `${match[0]}${boundary ? tail.slice(0, boundary.index) : tail}`.trim();
}

function trailingAmount(value: string) {
  return parseMexicanMoney(/\b(?:de|a|por)\s+\$?\s*([\d][\d.,]*)(?:\s+(?:con|sin)\s+carry)?\s*$/i.exec(value)?.[1]);
}

function hcpPercentageFromClause(clause: string) {
  const afterLabel = /\b(?:hcp|handicap)\s*(?:al|de|en|=|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:%|por\s+ciento)/i.exec(clause)?.[1];
  const beforeLabel = /\b(\d+(?:[.,]\d+)?)\s*(?:%|por\s+ciento)\s*(?:de\s+)?(?:hcp|handicap)\b/i.exec(clause)?.[1];
  const raw = afterLabel ?? beforeLabel;
  if (raw === undefined) return undefined;
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}

function hasHcpConfiguration(clause: string) {
  return /\b(?:hcp|handicap)\b/i.test(clause);
}

function handicapModeFromClause(clause: string): HandicapMode | undefined {
  const matches = new Set<HandicapMode>();
  if (/\b(?:decimas|decimales?|sin\s+redondear)\b/i.test(clause)) matches.add("decimal");
  if (/(?:^|\s)0?\.5\s+sube\b|\b(?:medio\s+(?:hacia\s+)?arriba|redondeo\s+(?:normal|entero))\b/i.test(clause)
    || (!/\bsin\s+redondear\b/i.test(clause) && /\b(?:redondear|redondeado)\b(?=\s*(?:[,.;]|$|\bcon\b|\bsin\b))/i.test(clause))) matches.add("half_up");
  if (/(?:^|\s)0?\.5\s+baja\b|\bmedio\s+(?:hacia\s+)?abajo\b/i.test(clause)) matches.add("half_down");
  if (/(?:^|\s)0?\.6\s+sube\b/i.test(clause)) matches.add("six_up");
  if (/(?:^|\s)0?\.4\s+baja\b/i.test(clause)) matches.add("four_down");
  return matches.size === 1 ? [...matches][0] : undefined;
}

function pollaDecimalModeFromClause(clause: string): DecimalMode | undefined {
  const matches = new Set<DecimalMode>();
  if (/\b(?:decimales?\s+cuentan|cuentan\s+(?:los\s+)?decimales?|con\s+decimales?|sin\s+redondear)\b/i.test(clause)) matches.add("partial");
  if (/\b(?:redondeo\s+entero|redondear|redondeado)\b/i.test(clause) && !/\bsin\s+redondear\b/i.test(clause)) matches.add("round");
  return matches.size === 1 ? [...matches][0] : undefined;
}

function hasRoundingConfiguration(clause: string) {
  return /\b(?:decimas|decimales?|redonde(?:ar|ado|o)|medio\s+(?:hacia\s+)?(?:arriba|abajo))\b|(?:^|\s)0?\.(?:5\s+(?:sube|baja)|6\s+sube|4\s+baja)\b/i.test(clause);
}

/** Removes only recognized configuration suffixes, leaving names, teams and stake intact. */
function configurationCoreClause(clause: string) {
  const boundary = /\s*,?\s+(?=(?:(?:con|sin)\s+)?(?:hcp|handicap|decimas|decimales?|redonde(?:ar|ado|o)|match\s*play|cuota(?:\s+base)?|puntos?|tabla|rotacion|parejas?\s+fijas?|cada\s+hoyo|bloques?|penalty|penalidad|castigo|ventaja)\b|(?:con\s+)?0?\.(?:5\s+(?:sube|baja)|6\s+sube|4\s+baja)\b|(?:con\s+)?\d+\s+golpes?\s+de\s+ventaja\b|(?:con\s+)?ventaja\s+de\s+\d+\s+golpes?\b|(?:con|sin)\s+carry\b)/i.exec(clause);
  return boundary ? clause.slice(0, boundary.index).trim() : clause;
}

function dollarAdvantageFromClause(clause: string) {
  if (/\bsin\s+(?:golpes?\s+de\s+)?ventaja\b/i.test(clause)) return { clearAdvantage: true as const, advantageStrokes: 0 };
  const strokesFirst = /\b(?:con\s+)?(\d+)\s+golpes?\s+de\s+ventaja\s+(?:para|a)\s+([a-zñ][a-zñ '\-]{0,80}?)(?=\s*(?:[,.;]|$))/i.exec(clause);
  const advantageFirst = /\b(?:con\s+)?ventaja\s+de\s+(\d+)\s+golpes?\s+(?:para|a)\s+([a-zñ][a-zñ '\-]{0,80}?)(?=\s*(?:[,.;]|$))/i.exec(clause);
  const match = strokesFirst ?? advantageFirst;
  if (!match) return {};
  const advantageStrokes = Number(match[1]);
  const advantageReceiverName = cleanName(match[2]);
  return Number.isInteger(advantageStrokes) && advantageStrokes >= 0 && advantageReceiverName
    ? { advantageStrokes, advantageReceiverName }
    : {};
}

function chicagoQuotaFromClause(clause: string) {
  const raw = /\b(?:cuota(?:\s+base)?|base\s+de\s+cuota)\s*(?:de|=|:|a)?\s*(-?\d+(?:[.,]\d+)?)/i.exec(clause)?.[1];
  if (raw === undefined) return undefined;
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}

function chicagoPointsFromClause(clause: string) {
  const points: NonNullable<Extract<ParsedRoundSetupAction, { type: "configure_supplemental_bet" }>["chicagoPoints"]> = {};
  const read = (pattern: RegExp) => {
    const raw = pattern.exec(clause)?.[1];
    if (raw === undefined) return undefined;
    const value = Number(raw.replace(",", "."));
    return Number.isFinite(value) && Number.isInteger(value) && Math.abs(value) <= 100 ? value : undefined;
  };
  const birdieOrBetter = read(/\bbirdie(?:s|\s+o\s+mejor)?\s*(?:(?:vale|valen)\s*|[=:]\s*)?(-?\d+(?:[.,]\d+)?)/i);
  const par = read(/\bpar\s*(?:(?:vale|valen)\s*|[=:]\s*)?(-?\d+(?:[.,]\d+)?)/i);
  const bogey = read(/(?<!doble\s)\bbogey\s*(?:(?:vale|valen)\s*|[=:]\s*)?(-?\d+(?:[.,]\d+)?)/i);
  const doubleBogeyOrWorse = read(/\b(?:doble(?:\s+bogey)?(?:\s+o\s+peor)?|doble\s+o\s+peor)\s*(?:(?:vale|valen)\s*|[=:]\s*)?(-?\d+(?:[.,]\d+)?)/i);
  if (birdieOrBetter !== undefined) points.birdieOrBetter = birdieOrBetter;
  if (par !== undefined) points.par = par;
  if (bogey !== undefined) points.bogey = bogey;
  if (doubleBogeyOrWorse !== undefined) points.doubleBogeyOrWorse = doubleBogeyOrWorse;
  return Object.keys(points).length ? points : undefined;
}

function vegasRotationFromClause(clause: string) {
  const matches = new Set<"fixed" | "each_hole" | "blocks">();
  if (/\b(?:parejas?\s+fijas?|rotacion\s+fija)\b/i.test(clause)) matches.add("fixed");
  if (/\b(?:rotacion\s+(?:por|cada)\s+hoyo|parejas?\s+(?:cambian|rotan)\s+cada\s+hoyo|cada\s+hoyo)\b/i.test(clause)) matches.add("each_hole");
  if (/\b(?:rotacion\s+por\s+)?bloques?\b/i.test(clause)) matches.add("blocks");
  return matches.size === 1 ? [...matches][0] : undefined;
}

function vegasBlockSizeFromClause(clause: string) {
  const raw = /\bbloques?\s+(?:de\s+)?(\d+)\s*(?:hoyos?)?/i.exec(clause)?.[1];
  const value = raw === undefined ? undefined : Number(raw);
  return value === 3 || value === 6 || value === 9 ? value : undefined;
}

function vegasBirdiePenaltyFromClause(clause: string) {
  if (/\bsin\s+(?:penalty|penalidad|castigo)(?:\s+de|\s+por)?\s+birdie\b/i.test(clause)) return false;
  if (/\b(?:con\s+)?(?:penalty|penalidad|castigo)(?:\s+de|\s+por)?\s+birdie(?:\s+(?:contra|vs\.?)\s+bogey)?\b/i.test(clause)) return true;
  return undefined;
}

function matchupFromClause(clause: string, alias: RegExp) {
  const coreClause = configurationCoreClause(clause);
  const match = new RegExp(`${alias.source}\\s+(.+?)\\s+(?:contra|vs\\.?|versus)\\s+(.+)$`, "i").exec(coreClause);
  if (!match) return null;
  const right = match[2].replace(/\s+(?:de|a|por)\s+\$?\s*[\d][\d.,]*(?:\s+(?:con|sin)\s+carry)?\s*$/i, "");
  return { left: splitNames(match[1]), right: splitNames(right) };
}

function participantsFromClause(clause: string, alias: RegExp) {
  const coreClause = configurationCoreClause(clause);
  const match = new RegExp(alias.source, "i").exec(coreClause);
  if (!match || match.index === undefined) return [];
  const tail = coreClause.slice(match.index + match[0].length)
    .replace(/\s+menos\s+.+$/i, "")
    .replace(/\s+(?:de|a|por)\s+\$?\s*[\d][\d.,]*.*$/i, "")
    .replace(/\s+(?:con|sin)\s+carry.*$/i, "")
    .trim();
  if (!tail || /^(?:de|a|por|ahora|hoy|todos?)\b/i.test(tail) || /\b(?:contra|vs\.?|versus)\b/i.test(tail)) return [];
  const names = splitNames(tail);
  return names.length >= 2 ? names : [];
}

function supplementalActions(normalized: string): ParsedRoundSetupAction[] {
  const actions: ParsedRoundSetupAction[] = [];

  const dollarAlias = /\b(?:dollar|dolar)\s+a\s+stroke\b/i;
  if (dollarAlias.test(normalized)) {
    const clause = clauseContaining(normalized, dollarAlias);
    const coreClause = configurationCoreClause(clause);
    const matchup = matchupFromClause(coreClause, dollarAlias);
    const advantage = dollarAdvantageFromClause(clause);
    actions.push({
      type: "configure_supplemental_bet",
      betType: "dollar_stroke",
      enabled: !hasRemovalNearAlias(normalized, dollarAlias.test(normalized) && /\bdolar\b/.test(normalized) ? "dolar a stroke" : "dollar a stroke"),
      value: trailingAmount(coreClause) ?? amountAfterAlias(coreClause, "dollar a stroke") ?? amountAfterAlias(coreClause, "dolar a stroke"),
      ...(matchup?.left.length === 1 ? { playerAName: matchup.left[0] } : {}),
      ...(matchup?.right.length === 1 ? { playerBName: matchup.right[0] } : {}),
      ...advantage,
      confidence: matchup ? 0.98 : 0.88,
      evidence: clause || "Dollar a Stroke",
    });
  }

  const individualPattern = /\bpresion(?:es)?\s+individual(?:es)?\b/i;
  if (individualPattern.test(normalized)) {
    const clause = clauseContaining(normalized, individualPattern);
    const coreClause = configurationCoreClause(clause);
    const matchedAlias = individualPattern.exec(clause)?.[0] ?? "presiones individuales";
    const carryEnabled = /\bsin\s+carry\b/i.test(clause) ? false : /\bcon\s+carry\b/i.test(clause) ? true : undefined;
    const participantNames = participantsFromClause(clause, individualPattern);
    const hcpPct = hcpPercentageFromClause(clause);
    const decimals = handicapModeFromClause(clause);
    const matchPlayEnabled = /\bsin\s+match\s*play\b/i.test(clause) ? false : /\b(?:con\s+)?match\s*play(?:\s+adicional)?\b/i.test(clause) ? true : undefined;
    actions.push({
      type: "configure_supplemental_bet",
      betType: "individual_pressures",
      enabled: !hasRemovalNearAlias(normalized, matchedAlias),
      value: trailingAmount(coreClause) ?? amountAfterAlias(coreClause, matchedAlias),
      ...(participantNames.length ? { participantNames } : {}),
      excludedPlayerNames: scopedExcludedNames(normalized, clause, "presiones individuales"),
      allPlayers: allPlayersFor(normalized, "presiones individuales"),
      ...(carryEnabled !== undefined ? { carryEnabled } : {}),
      ...(hcpPct !== undefined ? { hcpPct } : {}),
      ...(decimals ? { decimals } : {}),
      ...(matchPlayEnabled !== undefined ? { matchPlayEnabled } : {}),
      confidence: 0.96,
      evidence: clause || "Presiones individuales",
    });
  }

  const teamPattern = /\bpresion(?:es)?\s+(?:por\s+)?(?:parejas?|equipos?)\b/i;
  if (teamPattern.test(normalized)) {
    const clause = clauseContaining(normalized, teamPattern);
    const coreClause = configurationCoreClause(clause);
    const matchedAlias = teamPattern.exec(clause)?.[0] ?? "presiones por parejas";
    const matchup = matchupFromClause(clause, teamPattern);
    const carryEnabled = /\bsin\s+carry\b/i.test(clause) ? false : /\bcon\s+carry\b/i.test(clause) ? true : undefined;
    const hcpPct = hcpPercentageFromClause(clause);
    const decimals = handicapModeFromClause(clause);
    actions.push({
      type: "configure_supplemental_bet",
      betType: "team_pressures",
      enabled: !hasRemovalNearAlias(normalized, matchedAlias),
      value: trailingAmount(coreClause) ?? amountAfterAlias(coreClause, matchedAlias),
      ...(matchup?.left.length ? { teamAPlayerNames: matchup.left } : {}),
      ...(matchup?.right.length ? { teamBPlayerNames: matchup.right } : {}),
      ...(carryEnabled !== undefined ? { carryEnabled } : {}),
      ...(hcpPct !== undefined ? { hcpPct } : {}),
      ...(decimals ? { decimals } : {}),
      allPlayers: allPlayersFor(normalized, "presiones por parejas"),
      confidence: matchup ? 0.98 : 0.9,
      evidence: clause || "Presiones por parejas",
    });
  }

  for (const definition of [
    { pattern: /\bchicago\b/i, alias: "chicago", betType: "chicago" as const },
    { pattern: /\bvegas\b/i, alias: "vegas", betType: "vegas" as const },
    { pattern: /\b(?:minimo\s+de\s+putts|menos\s+putts)\b/i, alias: /\bmenos\s+putts\b/i.test(normalized) ? "menos putts" : "minimo de putts", betType: "minimum_putts" as const },
  ]) {
    if (!definition.pattern.test(normalized)) continue;
    const clause = clauseContaining(normalized, definition.pattern);
    const coreClause = configurationCoreClause(clause);
    const matchup = definition.betType === "vegas" ? matchupFromClause(clause, definition.pattern) : null;
    const participantNames = definition.betType === "vegas" ? [] : participantsFromClause(clause, definition.pattern);
    const scopedHoles = definition.betType === "minimum_putts" ? /\b(?:a|de|por)?\s*(9|18)\s*hoyos\b/i.exec(clause)?.[1] : undefined;
    const hcpPct = definition.betType === "chicago" || definition.betType === "vegas" ? hcpPercentageFromClause(clause) : undefined;
    const decimals = definition.betType === "vegas" ? handicapModeFromClause(clause) : undefined;
    const quotaBase = definition.betType === "chicago" ? chicagoQuotaFromClause(clause) : undefined;
    const chicagoPoints = definition.betType === "chicago" ? chicagoPointsFromClause(clause) : undefined;
    const rotation = definition.betType === "vegas" ? vegasRotationFromClause(clause) : undefined;
    const blockSize = definition.betType === "vegas" ? vegasBlockSizeFromClause(clause) : undefined;
    const birdiePenalty = definition.betType === "vegas" ? vegasBirdiePenaltyFromClause(clause) : undefined;
    actions.push({
      type: "configure_supplemental_bet",
      betType: definition.betType,
      enabled: !hasRemovalNearAlias(normalized, definition.alias),
      value: trailingAmount(coreClause) ?? amountAfterAlias(coreClause, definition.alias),
      ...(participantNames.length ? { participantNames } : {}),
      excludedPlayerNames: scopedExcludedNames(normalized, clause, definition.alias),
      allPlayers: allPlayersFor(normalized, definition.alias),
      ...(matchup?.left.length ? { teamAPlayerNames: matchup.left } : {}),
      ...(matchup?.right.length ? { teamBPlayerNames: matchup.right } : {}),
      ...(hcpPct !== undefined ? { hcpPct } : {}),
      ...(decimals ? { decimals } : {}),
      ...(quotaBase !== undefined ? { quotaBase } : {}),
      ...(chicagoPoints ? { chicagoPoints } : {}),
      ...(rotation ? { rotation } : {}),
      ...(blockSize ? { blockSize } : {}),
      ...(birdiePenalty !== undefined ? { birdiePenalty } : {}),
      ...(scopedHoles === "9" || scopedHoles === "18" ? { holes: Number(scopedHoles) as 9 | 18 } : {}),
      confidence: definition.betType === "vegas" && !matchup ? 0.88 : 0.96,
      evidence: clause || definition.alias,
    });
  }
  return actions;
}

function coreActions(normalized: string): ParsedRoundSetupAction[] {
  const actions: ParsedRoundSetupAction[] = [];
  for (const definition of CORE_ALIASES) {
    const alias = definition.aliases.find((candidate) => new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "i").test(normalized))
      ?? (definition.bet === "fish" ? explicitFishWaterAlias(normalized) : undefined);
    if (!alias) continue;
    const clause = clauseContaining(normalized, new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i"));
    const pressureClause = COUNTER_BETS.has(definition.bet) ? scopedCounterPressureClause(normalized, alias) : "";
    const pressure = counterPressureFromClause(pressureClause);
    actions.push({
      type: "configure_core_bet",
      bet: definition.bet,
      enabled: !hasRemovalNearAlias(normalized, alias),
      value: amountAfterAlias(pressureClause || clause, alias),
      excludedPlayerNames: scopedExcludedNames(normalized, clause, alias),
      allPlayers: allPlayersFor(normalized, alias),
      ...(definition.bet === "skins" && /\b(?:sin\s+carry|no\s+acumulables?)\b/i.test(clause) ? { skinsMode: "no_carry" as const } : {}),
      ...(definition.bet === "skins" && /\b(?:con\s+carry|acumulables?)\b/i.test(clause) && !/\bno\s+acumulables?\b/i.test(clause) ? { skinsMode: "carry" as const } : {}),
      ...(pressure.secondNinePressed !== undefined ? { secondNinePressed: pressure.secondNinePressed } : {}),
      ...(pressure.secondNineMultiplier !== undefined ? { secondNineMultiplier: pressure.secondNineMultiplier } : {}),
      confidence: 0.96,
      evidence: pressureClause || clause || alias,
    });
  }
  return actions;
}

function parserQuestions(normalized: string, parsedActions: ParsedRoundSetupAction[]): RoundSetupQuestion[] {
  const questions: RoundSetupQuestion[] = [];
  const requestedIndividualNassau = /\bnassau\s+individual\b/i.test(normalized);
  const hasIndividualNassau = parsedActions.some((action) => action.type === "configure_individual_nassau");
  const scopedCounterPressure = parsedActions.some((action) => action.type === "configure_core_bet"
    && COUNTER_BETS.has(action.bet)
    && COUNTER_PRESSURE_TERM.test(action.evidence));
  const scopedNassauPressure = parsedActions.some((action) => action.type === "configure_group_nassau"
    && COUNTER_PRESSURE_TERM.test(action.evidence));
  if (COUNTER_PRESSURE_TERM.test(normalized) && !scopedCounterPressure && !scopedNassauPressure && !/\b(?:individuales?|parejas|equipos|foursome)\b/i.test(normalized)) {
    questions.push({
      code: "ambiguous_bet",
      field: "bets.pressures",
      prompt: "¿Quieres Presiones individuales o Presiones por parejas? Las presiones internas de Foursome/Nassau se editan en modo manual avanzado.",
    });
  }
  if (requestedIndividualNassau && !hasIndividualNassau) {
    questions.push({
      code: "missing_players",
      field: "supplementalBets.individual_nassau.players",
      prompt: "¿Qué dos jugadores juegan el Nassau individual? Indica exactamente “Jugador A contra Jugador B” y no lo aplicaré como Nassau grupal.",
    });
  }
  if (/\boyes\b/i.test(normalized)) {
    questions.push({
      code: "unknown_bet",
      field: "bets.oyes",
      prompt: "“Oyes” no existe como modalidad independiente en el catálogo actual. ¿Se registra como Unidades/Copas o quieres otra modalidad existente?",
    });
  }
  if (/\bpersonales\b/i.test(normalized)) {
    questions.push({
      code: "ambiguous_bet",
      field: "bets.personales",
      prompt: "¿Qué apuesta personal quieres y contra qué jugador: Nassau individual, Dollar a Stroke o Presiones individuales?",
    });
  }
  if (/\bpolla\b/i.test(normalized) && !/\b(?:mini polla|nassau)\b/i.test(normalized) && !parsedActions.some((action) => action.type === "configure_polla_component")) {
    questions.push({
      code: "ambiguous_bet",
      field: "bets.polla.variant",
      prompt: "¿La Polla es de la primera vuelta, segunda vuelta o total de 18 hoyos?",
    });
  }

  for (const action of parsedActions) {
    if (!("enabled" in action) || !action.enabled) continue;
    const clause = action.evidence;
    if (action.type === "configure_core_bet" || action.type === "configure_individual_nassau" || action.type === "configure_ball_friend") {
      const field = action.type === "configure_core_bet"
        ? `bets.${action.bet}`
        : action.type === "configure_individual_nassau"
          ? "supplementalBets.individual_nassau"
          : "bets.ballFriend";
      if (hasHcpConfiguration(clause)) {
        questions.push({
          code: "invalid_action",
          field: `${field}.hcpPct`,
          prompt: `La configuración real de ${action.evidence} no admite un porcentaje de HCP en este flujo. Quita ese ajuste o revísalo en la edición manual avanzada.`,
        });
      }
      if (hasRoundingConfiguration(clause)) {
        questions.push({
          code: "invalid_action",
          field: `${field}.decimals`,
          prompt: `La configuración real de ${action.evidence} no admite ese redondeo en este flujo. Quita ese ajuste o revísalo en la edición manual avanzada.`,
        });
      }
      if (action.type === "configure_core_bet" && COUNTER_BETS.has(action.bet) && COUNTER_PRESSURE_TERM.test(clause)) {
        const pressure = counterPressureFromClause(clause);
        if (pressure.secondNinePressed === undefined) {
          questions.push({
            code: "invalid_action",
            field: `${field}.secondNineMultiplier`,
            prompt: `En ${action.bet === "fish" ? "Peces / agua" : action.bet === "vipers" ? "Viboritas" : "Camellos"}, indica “sin presión” o una presión válida de 2x a 5x para la segunda vuelta.`,
          });
        }
      }
      continue;
    }
    if (action.type === "configure_group_nassau" || action.type === "configure_polla_component") {
      const field = action.type === "configure_group_nassau" ? "bets.polla" : `bets.polla.${action.component}`;
      if (hasHcpConfiguration(clause) && action.hcpPct === undefined) {
        questions.push({ code: "invalid_action", field: `${field}.hcpPct`, prompt: "Repite la Polla indicando un HCP válido entre 0% y 100%." });
      }
      if (hasRoundingConfiguration(clause) && action.decimals === undefined) {
        questions.push({ code: "ambiguous_bet", field: `${field}.decimals`, prompt: "En Polla, indica exactamente si los decimales cuentan o si se redondea a entero." });
      }
      if (action.type === "configure_group_nassau" && NASSAU_ADVANCED_TERM.test(clause)) {
        questions.push({
          code: "invalid_action",
          field: "bets.polla.advanced",
          prompt: "El Nassau grupal no modela carry, presses ni multiplicadores en este flujo. Quita ese ajuste o revísalo explícitamente en la edición manual avanzada; no aplicaré un valor por defecto.",
        });
      }
      continue;
    }
    if (action.type !== "configure_supplemental_bet") continue;
    const field = `supplementalBets.${action.betType}`;
    const hcpSupported = action.betType === "individual_pressures" || action.betType === "team_pressures" || action.betType === "chicago" || action.betType === "vegas";
    const roundingSupported = action.betType === "individual_pressures" || action.betType === "team_pressures" || action.betType === "vegas";
    if (hasHcpConfiguration(clause) && (!hcpSupported || action.hcpPct === undefined)) {
      questions.push({ code: "invalid_action", field: `${field}.hcpPct`, prompt: `No pude aplicar ese HCP a ${action.evidence}. Repite la modalidad con un porcentaje entre 0% y 100%.` });
    }
    if (hasRoundingConfiguration(clause) && (!roundingSupported || action.decimals === undefined)) {
      questions.push({ code: "ambiguous_bet", field: `${field}.decimals`, prompt: `No pude mapear el redondeo de ${action.evidence}. Usa “decimales”, “.5 sube”, “.5 baja”, “.6 sube” o “.4 baja”.` });
    }

    if (action.betType === "dollar_stroke") {
      const advantageMentioned = /\bventaja\b/i.test(clause);
      const conflictingClear = action.clearAdvantage && /\b(?:\d+\s+golpes?|ventaja\s+de\s+\d+)\b/i.test(clause);
      const completeAdvantage = action.clearAdvantage || (action.advantageReceiverName !== undefined && action.advantageStrokes !== undefined);
      if (advantageMentioned && (!completeAdvantage || conflictingClear)) {
        questions.push({ code: "invalid_action", field: `${field}.advantage`, prompt: "Repite Dollar a Stroke indicando cuántos golpes de ventaja recibe y qué jugador los recibe, o di “sin ventaja”." });
      }
    }

    if (action.betType === "individual_pressures" || action.betType === "team_pressures") {
      const matchPlayMentioned = /\bmatch\s*play\b/i.test(clause);
      if (action.betType === "individual_pressures" && matchPlayMentioned && action.matchPlayEnabled === undefined) {
        questions.push({ code: "ambiguous_bet", field: `${field}.matchPlayEnabled`, prompt: "En Presiones individuales, indica “con Match Play” o “sin Match Play”." });
      }
      if (action.betType === "team_pressures" && matchPlayMentioned) {
        questions.push({ code: "invalid_action", field: `${field}.matchPlayEnabled`, prompt: "Match Play adicional sólo existe en Presiones individuales. Quita ese ajuste o cambia la modalidad." });
      }
      if (action.betType === "team_pressures" && /\b(?:low\s+ball|high\s+ball|low\s*(?:\+|y)\s*high|mudo|yo-?yo|score\s+maximo|abandona(?:do|dos)?|retira(?:do|dos)?)\b/i.test(clause)) {
        questions.push({ code: "invalid_action", field: `${field}.advanced`, prompt: "Esa variante de Presiones por parejas aún requiere la edición manual avanzada; no aplicaré valores por defecto." });
      }
    }

    if (action.betType === "chicago") {
      if (/\b(?:cuota|base\s+de\s+cuota)\b/i.test(clause) && action.quotaBase === undefined) {
        questions.push({ code: "invalid_action", field: `${field}.quotaBase`, prompt: "Repite Chicago con una cuota base numérica válida." });
      }
      const pointMentions: Array<[keyof NonNullable<typeof action.chicagoPoints>, RegExp]> = [
        ["birdieOrBetter", /\bbirdie(?:s|\s+o\s+mejor)?\b/i],
        ["par", /\bpar\b/i],
        ["bogey", /(?<!doble\s)\bbogey\b/i],
        ["doubleBogeyOrWorse", /\b(?:doble(?:\s+bogey)?|doble\s+o\s+peor)\b/i],
      ];
      const invalidPointLabel = pointMentions.some(([key, pattern]) => pattern.test(clause) && action.chicagoPoints?.[key] === undefined);
      if (invalidPointLabel || (/\b(?:puntos?|tabla)\b/i.test(clause) && !action.chicagoPoints)) {
        questions.push({ code: "invalid_action", field: `${field}.points`, prompt: "Repite los puntos de Chicago con etiquetas y números, por ejemplo: birdie 4, par 2, bogey 1, doble 0." });
      }
    }

    if (action.betType === "vegas") {
      const rotationMentioned = /\b(?:rotacion|rotan|cambian\s+cada\s+hoyo|parejas?\s+fijas?|cada\s+hoyo|bloques?)\b/i.test(clause);
      if (rotationMentioned && action.rotation === undefined) {
        questions.push({ code: "ambiguous_bet", field: `${field}.rotation`, prompt: "En Vegas, indica una sola rotación: parejas fijas, cada hoyo o por bloques de 3, 6 o 9 hoyos." });
      }
      if (action.rotation === "blocks" && action.blockSize === undefined) {
        questions.push({ code: "invalid_action", field: `${field}.blockSize`, prompt: "En Vegas por bloques, indica bloques de 3, 6 o 9 hoyos." });
      }
      const penaltyMentioned = /\b(?:penalty|penalidad|castigo)\b/i.test(clause);
      if (penaltyMentioned && action.birdiePenalty === undefined) {
        questions.push({ code: "ambiguous_bet", field: `${field}.birdiePenalty`, prompt: "En Vegas, indica “con penalty birdie vs bogey” o “sin penalty de birdie”." });
      }
      if (/\bmatch\s*play\b/i.test(clause)) {
        questions.push({ code: "invalid_action", field: `${field}.matchPlayEnabled`, prompt: "Vegas no tiene la opción Match Play adicional. Quita ese ajuste o usa Presiones individuales." });
      }
    }
  }

  const monetaryClause = /(?:^|[.;,]|\by\b)\s*(?:(?:agrega|pon|jugamos|juguemos)\s+)?(?:(?:la|el|los|las)\s+)?([a-zñ][a-z0-9ñ ]{0,40}?)\s+(?:de|a|por)\s+\$?\s*[\d][\d.,]*/gi;
  for (const match of normalized.matchAll(monetaryClause)) {
    const comparable = cleanName(match[1]);
    const known = BET_TERMS.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(comparable))
      || normalizeMexicanSpanish(comparable) === "agua";
    if (!known) {
      questions.push({
        code: "unknown_bet",
        field: `bets.unknown.${normalizeMexicanSpanish(comparable).replace(/\s+/g, "-")}`,
        prompt: `No encontré “${cleanName(comparable)}” en el catálogo actual. ¿Qué modalidad existente quieres usar?`,
      });
    }
  }
  const unsupportedCommand = /\b(?:agrega|pon)\s+(?:(?:la|el|los|las)\s+)?([a-zñ][a-z0-9ñ ]{1,40}?)(?=[.;]|$)/i.exec(normalized)?.[1];
  if (unsupportedCommand) {
    const comparable = cleanName(unsupportedCommand).replace(/\s+(?:de|a|por)\s+\$?[\d.,]+$/i, "");
    const known = BET_TERMS.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(comparable))
      || normalizeMexicanSpanish(comparable) === "agua";
    if (!known && !parsedActions.length) {
      questions.push({
        code: "unknown_bet",
        field: `bets.unknown.${normalizeMexicanSpanish(comparable).replace(/\s+/g, "-")}`,
        prompt: `No encontré “${cleanName(comparable)}” en el catálogo actual. ¿Qué modalidad existente quieres usar?`,
      });
    }
  }
  const seen = new Set<string>();
  return questions.filter((question) => {
    const key = `${question.code}:${question.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Deterministic es-MX fallback. It extracts only explicit, catalog-backed
 * operations; it never computes a wager or creates a custom modality.
 */
export function parseRoundSetupIntent(input: string): RoundSetupInterpretation {
  const normalizedInput = normalizeMexicanSpanish(input);
  const reference = parseReference(input, normalizedInput);
  const actions: ParsedRoundSetupAction[] = [];
  const roster = parseRoster(input);
  if (roster) actions.push(roster);
  const course = parseCourse(input, normalizedInput, reference);
  if (course) actions.push(course);
  const tee = parseTee(input);
  if (tee) actions.push(tee);
  actions.push(...parsePlayerHandicaps(input));

  if (/\b(?:salimos|salida|empezamos|iniciamos)(?:\s+por|\s+en|\s+desde)?\s+(?:el\s+)?10\b/i.test(normalizedInput)) {
    actions.push({ type: "set_start_hole", startHole: 10, confidence: 0.99, evidence: "salida por el 10" });
  } else if (/\b(?:salimos|salida|empezamos|iniciamos)(?:\s+por|\s+en|\s+desde)?\s+(?:el\s+)?1\b/i.test(normalizedInput)) {
    actions.push({ type: "set_start_hole", startHole: 1, confidence: 0.99, evidence: "salida por el 1" });
  }

  if (/\b(?:(?:solo|solamente|nada mas)\s+)?(?:jugamos|jugaremos|jugar|son)\s+9\s*hoyos\b|(?:^|[,;]\s*)(?:solo|solamente|nada mas)?\s*9\s*hoyos\b/i.test(normalizedInput)) {
    actions.push({ type: "set_round_holes", roundHoles: 9, confidence: 0.99, evidence: "9 hoyos" });
  } else if (/\b(?:jugamos|jugaremos|jugar|son)\s+18\s*hoyos\b|(?:^|[,;]\s*)18\s*hoyos\b/i.test(normalizedInput)) {
    actions.push({ type: "set_round_holes", roundHoles: 18, confidence: 0.99, evidence: "18 hoyos" });
  }

  if (/\bventajas?\s+entre\s+(?:los\s+)?jugadores\b/i.test(normalizedInput)) {
    actions.push({ type: "set_handicap_basis", handicapBasis: "relative", confidence: 0.99, evidence: "ventajas entre jugadores" });
  } else if (/\bventajas?\s+(?:sobre|contra|del)\s+(?:el\s+)?campo\b/i.test(normalizedInput)) {
    actions.push({ type: "set_handicap_basis", handicapBasis: "course", confidence: 0.99, evidence: "ventajas sobre campo" });
  }

  const individual = individualNassau(normalizedInput);
  if (individual) actions.push(individual);
  const nassau = groupNassau(normalizedInput, individual);
  if (nassau) actions.push(nassau);
  actions.push(...pollaComponents(normalizedInput));
  const friend = ballFriend(normalizedInput);
  if (friend) actions.push(friend);
  actions.push(...coreActions(normalizedInput));
  actions.push(...supplementalActions(normalizedInput));

  const questions = parserQuestions(normalizedInput, actions);
  if (!actions.length && !reference && !questions.length && normalizedInput) {
    questions.push({
      code: "invalid_action",
      field: "instruction",
      prompt: "No pude aplicar ese cambio con seguridad. Dime el dato concreto que quieres cambiar o usa la edición manual.",
    });
  }
  const confidence = questions.length ? 0.55 : actions.length || reference ? Math.min(...[
    ...actions.map((action) => action.confidence),
    reference ? 0.9 : 1,
  ]) : 0.3;

  return {
    input,
    normalizedInput,
    locale: "es-MX",
    confidence,
    ...(reference ? { reference } : {}),
    actions,
    questions,
  };
}
