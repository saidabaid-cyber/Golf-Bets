import type { AdminEntityType } from "./admin-control-center";
type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
}


function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function coursePayloadIssues(payload: JsonRecord, entityId: string) {
  const issues: string[] = [];
  const club = record(payload.club); const course = record(payload.course);
  if (!club || !text(club.id, 240) || !text(club.name, 240)) issues.push("Club e identidad oficial son obligatorios.");
  if (!course || text(course.id, 240) !== entityId || !text(course.name, 240) || ![9, 18].includes(Number(course.holes))) issues.push("El recorrido debe conservar su ID y declarar 9 o 18 hoyos.");
  const latitude = finiteNumber(club?.latitude); const longitude = finiteNumber(club?.longitude);
  if ((latitude === null) !== (longitude === null) || (latitude !== null && (latitude < -90 || latitude > 90 || longitude === null || longitude < -180 || longitude > 180))) issues.push("Las coordenadas deben ser una pareja válida y evidenciada.");
  const tees = Array.isArray(payload.tees) ? payload.tees : [];
  const teeIds = new Set<string>();
  for (const input of tees) {
    const tee = record(input); const id = tee && text(tee.id, 240); const name = tee && text(tee.name, 160);
    if (!tee || !id || !name || teeIds.has(id)) { issues.push("Cada tee requiere ID y nombre únicos."); continue; }
    teeIds.add(id);
    const rating = finiteNumber(tee.rating); const slope = finiteNumber(tee.slope);
    if ((rating === null) !== (slope === null) || (rating !== null && (rating < 40 || rating > 100 || slope === null || slope < 55 || slope > 155))) issues.push(`Rating/Slope inválido o incompleto en ${name}.`);
  }
  const holes = Array.isArray(payload.holes) ? payload.holes : [];
  const expected = Number(course?.holes);
  if (holes.length && holes.length !== expected) issues.push("La tarjeta debe contener todos los hoyos declarados o quedar pendiente completa.");
  const holeIds = new Set<string>(); const numbers = new Set<number>(); const strokeIndexes = new Set<number>();
  for (const input of holes) {
    const hole = record(input); const id = hole && text(hole.id, 240); const number = finiteNumber(hole?.holeNumber); const par = finiteNumber(hole?.par); const strokeIndex = finiteNumber(hole?.strokeIndex);
    if (!id || !Number.isInteger(number) || number! < 1 || number! > expected || !Number.isInteger(par) || par! < 3 || par! > 6 || !Number.isInteger(strokeIndex) || strokeIndex! < 1 || strokeIndex! > expected || holeIds.has(id) || numbers.has(number!) || strokeIndexes.has(strokeIndex!)) issues.push("Hoyos, par y Stroke Index deben ser válidos y únicos.");
    if (id) holeIds.add(id); if (number !== null) numbers.add(number); if (strokeIndex !== null) strokeIndexes.add(strokeIndex);
  }
  const yardages = Array.isArray(payload.teeHoleYardages) ? payload.teeHoleYardages : [];
  for (const input of yardages) {
    const row = record(input); const yards = finiteNumber(row?.yards);
    if (!row || !teeIds.has(String(row.teeId)) || !holeIds.has(String(row.holeId)) || yards === null || yards <= 0 || yards > 1000) issues.push("Cada yardaje debe apuntar a un tee/hoyo válido y ser positivo.");
  }
  return [...new Set(issues)];
}

export function scorecardProfilePayloadIssues(payload: JsonRecord) {
  const issues: string[] = [];
  const provenance = new Set(["GHIN_OFFICIAL", "USGA_OFFICIAL", "CLUB_SCORECARD_VERIFIED", "CLUB_OPERATIONAL", "CLUB_TEMPORARY", "TOURNAMENT", "ADMIN_VERIFIED", "PROVIDER_REVIEWED", "PROVIDER_VERIFIED"]);
  if (!text(payload.courseId, 240) || !text(payload.name, 200)) issues.push("Course y nombre de tarjeta son obligatorios.");
  if (!provenance.has(String(payload.provenance || "")) || !text(payload.sourceProvider, 100)) issues.push("Procedencia y proveedor son obligatorios.");
  if (!Array.isArray(payload.evidence) || !payload.evidence.length) issues.push("La tarjeta requiere evidencia antes de verificarla.");
  if (!Array.isArray(payload.tees) || !payload.tees.length) issues.push("La tarjeta requiere al menos un tee.");
  if (!Array.isArray(payload.holes) || !payload.holes.length) issues.push("La tarjeta requiere Stroke Index para sus hoyos.");
  return issues;
}

function stringList(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0) ? value as string[] : null;
}

function numberList(value: unknown, minimum: number, maximum: number) {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item) && item >= minimum && item <= maximum) ? value as number[] : null;
}

export function importStrings(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split("|") : [];
  return [...new Set(values.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []))];
}

export function importNumbers(value: unknown) {
  return importStrings(value).map(Number).filter((item) => Number.isFinite(item));
}

function validHttpsUrl(value: unknown) {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export function equipmentPayloadIssues(payload: JsonRecord, entityType: AdminEntityType, entityId: string) {
  const issues: string[] = [];
  const sourceTypes = new Set(["OEM_OFFICIAL", "DISTRIBUTOR", "SECONDARY_ARCHIVE", "USER_SUBMITTED", "ADMIN_RESEARCH", "OTHER"]);
  if (text(payload.id, 240) !== entityId || !text(payload.brand, 160) || !text(payload.model, 200)) issues.push("Equipment requiere ID, marca y modelo estructurados.");
  if (typeof payload.active !== "boolean" || typeof payload.bagEligible !== "boolean" || typeof payload.fitEligible !== "boolean") issues.push("Active, bagEligible y fitEligible deben ser booleanos explícitos.");
  if (payload.year !== null && (!Number.isInteger(payload.year) || Number(payload.year) < 1900 || Number(payload.year) > 2200)) issues.push("El año no es válido.");
  if (!sourceTypes.has(String(payload.sourceType || "")) || !text(payload.sourceName, 240)) issues.push("Tipo y nombre de fuente son obligatorios.");
  if (!validHttpsUrl(payload.sourceUrl) || !validHttpsUrl(payload.officialUrl)) issues.push("Las URLs de fuente y oficial deben usar HTTPS.");

  if (entityType === "CLUB_EQUIPMENT") {
    const categories = new Set(["DRIVER", "FAIRWAY_WOOD", "HYBRID", "IRON_SET", "WEDGE", "PUTTER"]);
    const hands = stringList(payload.handedness); const lofts = numberList(payload.lofts, 0, 90);
    if (!categories.has(String(payload.category || ""))) issues.push("La categoría del bastón no es válida.");
    if (hands === null || hands.some((hand) => !["RH", "LH"].includes(hand))) issues.push("Las manos deben ser opciones estructuradas RH/LH.");
    if (lofts === null) issues.push("Los lofts deben ser una lista de números válidos.");
    const variants = Array.isArray(payload.variants) ? payload.variants : null;
    if (variants === null || variants.some((value) => { const variant = record(value); const loft = finiteNumber(variant?.loft); const bounce = finiteNumber(variant?.bounce); return !variant || loft === null || loft < 0 || loft > 90 || (bounce !== null && (bounce < 0 || bounce > 30)); })) issues.push("Las variantes loft/bounce/grind no son válidas.");
    const technicalFacts = [lofts?.length, variants?.length, finiteNumber(payload.standardLength), finiteNumber(payload.lie), finiteNumber(payload.headVolume), text(payload.setMakeup, 500)].filter(Boolean).length;
    if (payload.fitEligible === true && technicalFacts < 2) issues.push("Fit eligible requiere al menos dos especificaciones técnicas verificables.");
  } else if (entityType === "SHAFT") {
    const usages = new Set(["WOOD", "FAIRWAY", "HYBRID", "UTILITY", "IRON", "WEDGE", "PUTTER"]);
    const weights = numberList(payload.weightOptions, 1, 300); const flexes = stringList(payload.flexOptions); const torque = numberList(payload.torqueRange, 0, 30);
    if (!usages.has(String(payload.usage || ""))) issues.push("El uso de la varilla no es válido.");
    if (weights === null || flexes === null || torque === null) issues.push("Peso, flex y torque deben ser listas estructuradas válidas.");
    if (payload.fitEligible === true && (!weights?.length || !flexes?.length || !text(payload.launch, 30) || !text(payload.spin, 30) || !text(payload.verifiedAt, 50))) issues.push("Fit eligible para varilla requiere peso, flex, launch, spin y evidencia verificada.");
  } else if (entityType === "BALL") {
    const levels = new Set(["VERY_LOW", "LOW", "MID", "HIGH", "VERY_HIGH"]);
    for (const key of ["flight", "driverSpin", "ironSpin", "shortGameSpin", "feel"] as const) if (payload[key] !== null && !levels.has(String(payload[key]))) issues.push(`${key} no es una opción válida.`);
    const compression = finiteNumber(payload.compression);
    if (compression !== null && (compression < 1 || compression > 200 || !text(payload.compressionSource, 240) || !text(payload.compressionSourceUrl, 1000) || !validHttpsUrl(payload.compressionSourceUrl))) issues.push("Compression requiere valor válido y fuente HTTPS verificable.");
    const technicalFacts = [payload.flight, payload.feel, payload.driverSpin, payload.ironSpin, payload.shortGameSpin, payload.coverMaterial, payload.construction].filter((value) => typeof value === "string" && value.length > 0).length;
    if (payload.fitEligible === true && technicalFacts < 3) issues.push("Fit eligible para bola requiere al menos tres especificaciones técnicas.");
  }
  return [...new Set(issues)];
}

export function competitionPayloadIssues(payload: JsonRecord, entityId: string) {
  const issues: string[] = [];
  if (text(payload.id, 60) !== entityId || !text(payload.name, 240)) issues.push("La competición requiere UUID y nombre.");
  if (!["POLLA", "TOURNAMENT", "LEAGUE", "EVENT"].includes(String(payload.type || ""))) issues.push("El tipo de competición no es válido.");
  if (!["PUBLIC", "PRIVATE"].includes(String(payload.visibility || ""))) issues.push("La visibilidad no es válida.");
  if (!text(payload.courseId, 240)) issues.push("La competición requiere un Course publicado.");
  const startsAt = text(payload.startsAt, 50); const endsAt = text(payload.endsAt, 50);
  if ((startsAt && Number.isNaN(Date.parse(startsAt))) || (endsAt && Number.isNaN(Date.parse(endsAt))) || (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt))) issues.push("Las fechas de la competición no son válidas.");
  const maximum = finiteNumber(payload.handicapMaximum); const percentage = finiteNumber(payload.handicapPercentage);
  if (maximum !== null && (maximum < 0 || maximum > 54)) issues.push("El handicap máximo no es válido.");
  if (percentage !== null && (percentage < 0 || percentage > 100)) issues.push("El porcentaje de handicap no es válido.");
  const categories = new Set(["FORMAT", "HANDICAP", "SCORING", "TIE_BREAK", "PRIZE", "CLOSEST_TO_PIN", "PACE", "LOCAL_EVENT_RULE", "BETTING", "CONDUCT", "OTHER"]);
  const rules = Array.isArray(payload.rules) ? payload.rules : [];
  if (!rules.length || rules.some((value) => { const rule = record(value); return !rule || !categories.has(String(rule.category || "")) || !text(rule.title, 240) || !text(rule.body, 20000); })) issues.push("El reglamento requiere reglas categorizadas con título y contenido.");
  return [...new Set(issues)];
}

