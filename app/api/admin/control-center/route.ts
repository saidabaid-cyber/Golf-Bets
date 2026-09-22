import { NextRequest, NextResponse } from "next/server";

import {
  ADMIN_ENTITY_TYPES,
  ADMIN_SCOPE_TYPES,
  equipmentIdentityKey,
  PROVENANCE_STATES,
  type AdminEntityType,
  type AdminScopeType,
  type EquipmentIdentity,
} from "../../../../lib/admin-control-center";
import { csvObjects, equipmentImportPreview, jsonObjects } from "../../../../lib/admin-imports";
import { getCourseCatalog } from "../../../../lib/course-catalog-provider.server";
import { loadLayeredEquipmentCatalogs } from "../../../../lib/equipment-catalog-provider.server";
import { golfBallCatalog, golfClubCatalog, golfShaftCatalog } from "../../../../lib/golf-equipment-catalog";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { serverPhase2FeatureFlags } from "../../../../features/feature-flags/server";

export const dynamic = "force-dynamic";

const PRIVATE = { "cache-control": "private, no-store" };
const MAX_BODY_BYTES = 2_100_000;

type JsonRecord = Record<string, unknown>;

function json(body: JsonRecord, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE });
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
}

function uuid(value: unknown) {
  const candidate = text(value, 60);
  return candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function coursePayloadIssues(payload: JsonRecord, entityId: string) {
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

function stringList(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0) ? value as string[] : null;
}

function numberList(value: unknown, minimum: number, maximum: number) {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item) && item >= minimum && item <= maximum) ? value as number[] : null;
}

function importStrings(value: unknown) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split("|") : [];
  return [...new Set(values.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []))];
}

function importNumbers(value: unknown) {
  return importStrings(value).map(Number).filter((item) => Number.isFinite(item));
}

function validHttpsUrl(value: unknown) {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function equipmentPayloadIssues(payload: JsonRecord, entityType: AdminEntityType, entityId: string) {
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

function competitionPayloadIssues(payload: JsonRecord, entityId: string) {
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

function equipmentRows(entityType: AdminEntityType) {
  if (entityType === "BALL") return golfBallCatalog;
  if (entityType === "SHAFT") return golfShaftCatalog;
  return golfClubCatalog;
}

function safeDbCode(error: unknown) {
  return record(error) && typeof record(error)?.code === "string" ? record(error)?.code as string : "UNKNOWN";
}

function databaseFailure(error: unknown, fallback = "No fue posible completar la operación administrativa.") {
  const code = safeDbCode(error);
  const missing = ["42P01", "42883", "PGRST202", "PGRST205"].includes(code);
  const forbidden = ["42501", "PGRST301"].includes(code);
  return json({ error: missing ? "Admin Control Center requiere la migración aditiva en la base QA." : forbidden ? "Tu rol o alcance no permite esta operación." : fallback, code: missing ? "ADMIN_SCHEMA_PENDING" : forbidden ? "ADMIN_SCOPE_REQUIRED" : "ADMIN_OPERATION_FAILED" }, missing ? 503 : forbidden ? 403 : 400);
}

async function body(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
  try { return record(JSON.parse(raw)); } catch { return null; }
}

async function context(request: NextRequest) {
  if (!serverPhase2FeatureFlags().admin_v1) return { ok: false as const, response: json({ error: "Admin está desactivado.", code: "FEATURE_DISABLED" }, 404) };
  const account = await authenticatedRequest(request);
  if (!account.ok) return { ok: false as const, response: json({ error: account.error, code: account.code }, account.status) };
  const memberships = await account.client.from("admin_memberships").select("id,role,scope_type,scope_id,active,created_at").eq("user_id", account.userId).eq("active", true).order("created_at");
  if (memberships.error) return { ok: false as const, response: databaseFailure(memberships.error) };
  if (!memberships.data?.length) return { ok: false as const, response: json({ error: "Esta cuenta no tiene una membresía administrativa activa.", code: "ADMIN_REQUIRED" }, 403) };
  return {
    ok: true as const,
    userId: account.userId,
    token: account.token,
    client: account.client,
    userMetadata: account.userMetadata,
    memberships: memberships.data,
  };
}

function pageLimit(request: NextRequest) {
  const value = Number(request.nextUrl.searchParams.get("limit") || 50);
  return Number.isFinite(value) ? Math.max(1, Math.min(100, Math.trunc(value))) : 50;
}

export async function GET(request: NextRequest) {
  const access = await context(request);
  if (!access.ok) return access.response;
  const view = request.nextUrl.searchParams.get("view") || "dashboard";
  const limit = pageLimit(request);

  if (view === "dashboard") {
    const [revisions, pending, configurations, competitions, imports, requests] = await Promise.all([
      access.client.from("admin_catalog_revisions").select("id", { count: "exact", head: true }),
      access.client.from("admin_catalog_revisions").select("id", { count: "exact", head: true }).in("status", ["DRAFT", "REVIEWED", "VERIFIED"]),
      access.client.from("course_configurations").select("id", { count: "exact", head: true }),
      access.client.from("competition_definitions").select("id", { count: "exact", head: true }),
      access.client.from("admin_import_jobs").select("id", { count: "exact", head: true }),
      access.client.rpc("admin_feedback_queue_v1", { queue_limit: 100 }),
    ]);
    const firstError = [revisions, pending, configurations, competitions, imports, requests].find((result) => result.error)?.error;
    if (firstError) return databaseFailure(firstError);
    return json({ memberships: access.memberships, counts: { revisions: revisions.count || 0, pending: pending.count || 0, configurations: configurations.count || 0, competitions: competitions.count || 0, imports: imports.count || 0, requests: requests.data?.length || 0 } });
  }

  if (view === "revisions") {
    const status = text(request.nextUrl.searchParams.get("status"), 30);
    const type = text(request.nextUrl.searchParams.get("type"), 50);
    let query = access.client.from("admin_catalog_revisions").select("id,entity_type,entity_id,scope_type,scope_id,version,status,provenance_status,payload,source_type,source_name,source_url,verified_at,confidence,effective_from,effective_until,preview_hash,revision_hash,created_at,updated_at,published_at").order("updated_at", { ascending: false }).limit(limit);
    if (status) query = query.eq("status", status);
    if (type) query = query.eq("entity_type", type);
    const result = await query;
    if (result.error) return databaseFailure(result.error);
    return json({ items: result.data || [], memberships: access.memberships });
  }

  if (view === "courses") {
    const catalog = await getCourseCatalog();
    const courseId = text(request.nextUrl.searchParams.get("courseId"), 240);
    const clubs = new Map(catalog.clubs.map((club) => [club.id, club]));
    if (courseId) {
      const course = catalog.courses.find((row) => row.id === courseId);
      const club = course ? clubs.get(course.clubId) : null;
      if (!course || !club) return json({ error: "No encontramos ese recorrido publicado.", code: "COURSE_NOT_FOUND" }, 404);
      return json({ item: {
        sourceName: course.sourceName || club.sourceName || null,
        sourceUrl: course.sourceUrl || club.sourceUrl || null,
        verifiedAt: course.verifiedAt || club.verifiedAt || null,
        club,
        course,
        tees: catalog.tees.filter((tee) => tee.courseId === course.id),
        holes: catalog.holes.filter((hole) => hole.courseId === course.id).sort((left, right) => left.holeNumber - right.holeNumber),
        teeHoleYardages: catalog.teeHoleYardages.filter((row) => catalog.tees.some((tee) => tee.courseId === course.id && tee.id === row.teeId)),
      } });
    }
    const query = (text(request.nextUrl.searchParams.get("q"), 160) || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
    const matches = catalog.courses.filter((course) => {
      const club = clubs.get(course.clubId); const haystack = `${club?.name || ""} ${club?.aliases?.join(" ") || ""} ${course.name} ${course.aliases?.join(" ") || ""} ${club?.city || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
      return course.active && (!query || query.split(/\s+/).every((token) => haystack.includes(token)));
    }).slice(0, limit);
    const revisionRows = matches.length ? await access.client.from("admin_catalog_revisions").select("entity_id,version,status,updated_at").eq("entity_type", "COURSE").in("entity_id", matches.map((course) => course.id)).order("version", { ascending: false }) : { data: [], error: null };
    if (revisionRows.error) return databaseFailure(revisionRows.error);
    const latest = new Map<string, JsonRecord>();
    for (const revision of revisionRows.data || []) if (!latest.has(revision.entity_id)) latest.set(revision.entity_id, revision);
    return json({ items: matches.map((course) => ({ ...course, clubName: clubs.get(course.clubId)?.name || "Club", city: clubs.get(course.clubId)?.city || null, adminRevision: latest.get(course.id) || null })), total: matches.length, memberships: access.memberships });
  }

  if (view === "equipment") {
    const catalogs = await loadLayeredEquipmentCatalogs();
    const entityType = text(request.nextUrl.searchParams.get("entityType"), 50);
    const entityId = text(request.nextUrl.searchParams.get("entityId"), 240);
    const groups = [
      ...catalogs.clubs.map((item) => ({ entityType: "CLUB_EQUIPMENT", item })),
      ...catalogs.balls.map((item) => ({ entityType: "BALL", item })),
      ...catalogs.shafts.map((item) => ({ entityType: "SHAFT", item })),
    ];
    if (entityType && entityId) {
      const match = groups.find((row) => row.entityType === entityType && row.item.id === entityId);
      if (!match) return json({ error: "No encontramos ese equipo en el catálogo por capas.", code: "EQUIPMENT_NOT_FOUND" }, 404);
      return json({ item: { ...match.item, entityType: match.entityType } });
    }
    const query = (text(request.nextUrl.searchParams.get("q"), 160) || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
    const kind = text(request.nextUrl.searchParams.get("kind"), 50);
    const items = groups.filter((row) => {
      const haystack = `${row.item.brand} ${row.item.model} ${row.item.generation || ""} ${row.item.year || ""} ${(row.item.aliases || []).join(" ")}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
      return (!kind || row.entityType === kind) && (!query || query.split(/\s+/).every((token) => haystack.includes(token)));
    }).slice(0, limit).map((row) => ({ ...row.item, entityType: row.entityType }));
    return json({ items, total: items.length, memberships: access.memberships });
  }

  if (view === "rules") {
    const types = ["LOCAL_RULE_SET"];
    const result = await access.client.from("admin_catalog_revisions").select("id,entity_type,entity_id,version,status,updated_at").in("entity_type", types).order("updated_at", { ascending: false }).limit(limit);
    if (result.error) return databaseFailure(result.error);
    return json({ items: result.data || [], memberships: access.memberships });
  }

  if (view === "imports") {
    const result = await access.client.from("admin_import_jobs").select("id,kind,status,source_format,summary,created_at,updated_at,admin_import_rows(row_number,status,existing_entity_id,issues)").order("updated_at", { ascending: false }).limit(limit);
    if (result.error) return databaseFailure(result.error);
    return json({ items: result.data || [], memberships: access.memberships });
  }

  if (view === "course-ops" || view === "configurations") {
    // Tee-hole overrides belong to configuration holes, not directly to the
    // configuration. This workspace list only renders configuration metadata;
    // requesting a nonexistent direct relationship makes PostgREST reject the
    // whole authorized Admin route before the hole editor can load.
    const result = await access.client.from("course_configurations").select("id,course_id,name,description,scope_type,competition_id,status,effective_from,effective_until,reason,source_description,version,revision_hash,created_at,updated_at").order("updated_at", { ascending: false }).limit(limit);
    if (result.error) return databaseFailure(result.error);
    return json({ items: result.data || [] });
  }

  if (view === "competitions") {
    const result = await access.client.from("competition_definitions").select("*,competition_rule_sets(*,competition_rules(*))").order("updated_at", { ascending: false }).limit(limit);
    if (result.error) return databaseFailure(result.error);
    return json({ items: result.data || [] });
  }

  if (view === "requests") {
    const result = await access.client.rpc("admin_feedback_queue_v1", { queue_limit: limit });
    if (result.error) return databaseFailure(result.error);
    return json({ items: result.data || [] });
  }

  if (view === "audit") {
    const result = await access.client.from("admin_audit_log").select("id,actor_id,actor_role,action,entity_type,entity_id,reason,request_id,created_at").order("created_at", { ascending: false }).limit(limit);
    if (result.error) return databaseFailure(result.error);
    return json({ items: result.data || [] });
  }

  if (view === "quality") {
    const [catalog, equipmentCatalogs, approvedImages] = await Promise.all([
      getCourseCatalog(),
      loadLayeredEquipmentCatalogs(),
      access.client.from("equipment_catalog_images").select("equipment_type,equipment_id").eq("status", "APPROVED"),
    ]);
    if (approvedImages.error) return databaseFailure(approvedImages.error);
    const shaftRows = [...equipmentCatalogs.shafts];
    const clubRows = [...equipmentCatalogs.clubs];
    const ballRows = [...equipmentCatalogs.balls];
    const courseRows = catalog.courses.filter((row) => row.active);
    const teeRows = catalog.tees.filter((row) => row.active);
    const holeCounts = new Map<string, number>();
    for (const hole of catalog.holes) holeCounts.set(hole.courseId, (holeCounts.get(hole.courseId) || 0) + 1);
    const yardageCounts = new Map<string, number>();
    for (const row of catalog.teeHoleYardages) if (typeof row.yards === "number" && row.yards > 0) yardageCounts.set(row.teeId, (yardageCounts.get(row.teeId) || 0) + 1);
    const approved = new Set((approvedImages.data || []).map((row) => `${row.equipment_type}:${row.equipment_id}`));
    const allEquipment = [
      ...ballRows.map((row) => ({ ...row, entityType: "BALL" as const, categoryOrUsage: null })),
      ...clubRows.map((row) => ({ ...row, entityType: "CLUB_EQUIPMENT" as const, categoryOrUsage: row.category })),
      ...shaftRows.map((row) => ({ ...row, entityType: "SHAFT" as const, categoryOrUsage: row.usage })),
    ];
    const identityCounts = new Map<string, number>();
    for (const row of allEquipment) identityCounts.set(equipmentIdentityKey(row), (identityCounts.get(equipmentIdentityKey(row)) || 0) + 1);
    const incompleteTees = teeRows.filter((tee) => yardageCounts.get(tee.id) !== (catalog.courses.find((course) => course.id === tee.courseId)?.holes || 18));
    return json({
      courses: {
        clubs: catalog.clubs.filter((row) => row.active).length,
        total: courseRows.length,
        tees: teeRows.length,
        geolocatedClubs: catalog.clubs.filter((row) => row.active && row.latitude != null && row.longitude != null).length,
        missingLocation: catalog.clubs.filter((row) => row.active && (row.latitude == null || row.longitude == null)).length,
        missingSource: courseRows.filter((row) => !row.sourceUrl).length,
        incompleteScorecard: courseRows.filter((row) => (holeCounts.get(row.id) || 0) !== row.holes).length,
        completeTeeCards: teeRows.length - incompleteTees.length,
        incompleteTeeCards: incompleteTees.length,
        missingTeeCard: courseRows.filter((row) => !teeRows.some((tee) => tee.courseId === row.id)).length,
        missingRatingCategory: teeRows.filter((tee) => tee.rating != null && tee.slope != null && !tee.gender).length,
      },
      equipment: {
        total: allEquipment.length,
        balls: ballRows.length,
        clubs: clubRows.length,
        shafts: shaftRows.length,
        active: allEquipment.filter((row) => row.active).length,
        historical: allEquipment.filter((row) => !row.active).length,
        bagEligible: allEquipment.filter((row) => row.bagEligible).length,
        fitEligible: allEquipment.filter((row) => row.fitEligible).length,
        missingImage: allEquipment.filter((row) => !approved.has(`${row.entityType}:${row.id}`)).length,
        missingYear: [...ballRows, ...clubRows, ...shaftRows].filter((row) => row.year == null).length,
        missingGeneration: [...ballRows, ...clubRows, ...shaftRows].filter((row) => !row.generation).length,
        shaftMissingWeight: shaftRows.filter((row) => !row.weightOptions.length && row.weight == null).length,
        shaftMissingFlex: shaftRows.filter((row) => !row.flexOptions.length && !row.flex.length).length,
        wedgeMissingLoft: clubRows.filter((row) => row.category === "WEDGE" && !(Array.isArray(row.lofts) && row.lofts.length)).length,
        incompleteFit: allEquipment.filter((row) => !row.fitEligible).length,
        possibleDuplicate: [...identityCounts.values()].filter((count) => count > 1).length,
      },
    });
  }

  return json({ error: "Vista administrativa inválida.", code: "INVALID_VIEW" }, 400);
}

export async function POST(request: NextRequest) {
  const access = await context(request);
  if (!access.ok) return access.response;
  const input = await body(request);
  if (!input) return json({ error: "La solicitud no contiene JSON válido o excede 2 MB.", code: "INVALID_BODY" }, 400);
  const operation = text(input.operation, 80);

  if (operation === "createRevision") {
    const entityType = text(input.entityType, 50) as AdminEntityType | null;
    const scopeType = text(input.scopeType, 30) as AdminScopeType | null;
    const entityId = text(input.entityId, 240);
    const payload = record(input.payload);
    if (!entityType || !(ADMIN_ENTITY_TYPES as readonly string[]).includes(entityType) || !scopeType || !(ADMIN_SCOPE_TYPES as readonly string[]).includes(scopeType) || !entityId || !payload) {
      return json({ error: "El tipo, alcance, identidad o contenido del borrador no es válido.", code: "INVALID_DRAFT" }, 400);
    }
    if (entityType === "COMPETITION" && !uuid(entityId)) return json({ error: "El ID de la competición debe ser UUID.", code: "INVALID_COMPETITION_ID" }, 400);
    if (entityType === "COURSE") {
      const issues = coursePayloadIssues(payload, entityId);
      if (issues.length) return json({ error: issues.join(" "), code: "INVALID_COURSE_FACTS", issues }, 400);
    }
    if (entityType === "COMPETITION") {
      const issues = competitionPayloadIssues(payload, entityId);
      if (issues.length) return json({ error: issues.join(" "), code: "INVALID_COMPETITION_FACTS", issues }, 400);
      const catalog = await getCourseCatalog();
      if (!catalog.courses.some((course) => course.id === payload.courseId && course.active)) return json({ error: "El Course de la competición no existe en el catálogo publicado.", code: "COURSE_NOT_FOUND" }, 404);
    }
    if (["CLUB_EQUIPMENT", "BALL", "SHAFT"].includes(entityType)) {
      const issues = equipmentPayloadIssues(payload, entityType, entityId);
      if (issues.length) return json({ error: issues.join(" "), code: "INVALID_EQUIPMENT_FACTS", issues }, 400);
      const identity = equipmentIdentityKey({ brand: String(payload.brand), model: String(payload.model), generation: text(payload.generation, 120), year: finiteNumber(payload.year), categoryOrUsage: text(payload.category ?? payload.usage, 80) });
      const seedMatch = equipmentRows(entityType).find((item) => item.id !== entityId && equipmentIdentityKey({ ...item, categoryOrUsage: "category" in item ? item.category : "usage" in item ? item.usage : null }) === identity);
      const published = await access.client.from("admin_catalog_revisions").select("entity_id,payload").eq("entity_type", entityType).eq("status", "PUBLISHED").limit(1000);
      if (published.error) return databaseFailure(published.error);
      const publishedMatch = (published.data || []).find((item) => { const row = record(item.payload); return item.entity_id !== entityId && row && typeof row.brand === "string" && typeof row.model === "string" && equipmentIdentityKey({ brand: row.brand, model: row.model, generation: text(row.generation, 120), year: finiteNumber(row.year), categoryOrUsage: text(row.category ?? row.usage, 80) }) === identity; });
      const duplicateId = seedMatch?.id || publishedMatch?.entity_id;
      if (duplicateId) return json({ error: `Posible registro existente: ${duplicateId}. Abre ese registro o usa una generación/año diferente.`, code: "POSSIBLE_DUPLICATE", existingEntityId: duplicateId }, 409);
    }
    const provenanceStatus = text(input.provenanceStatus, 30) || "REPORTED";
    if (!(PROVENANCE_STATES as readonly string[]).includes(provenanceStatus)) return json({ error: "La procedencia no es válida.", code: "INVALID_PROVENANCE" }, 400);
    const effectiveFrom = text(input.effectiveFrom, 50); const effectiveUntil = text(input.effectiveUntil, 50);
    if ((effectiveFrom && Number.isNaN(Date.parse(effectiveFrom))) || (effectiveUntil && Number.isNaN(Date.parse(effectiveUntil))) || (effectiveFrom && effectiveUntil && Date.parse(effectiveUntil) <= Date.parse(effectiveFrom))) return json({ error: "La vigencia programada no es válida.", code: "INVALID_EFFECTIVE_WINDOW" }, 400);
    const result = await access.client.rpc("admin_create_revision_v1", {
      target_entity_type: entityType,
      target_entity_id: entityId,
      target_scope_type: scopeType,
      target_scope_id: scopeType === "GLOBAL" ? null : text(input.scopeId, 240),
      target_payload: payload,
      target_source_type: text(input.sourceType, 50),
      target_source_name: text(input.sourceName, 240),
      target_source_url: text(input.sourceUrl, 1000),
      target_provenance_status: provenanceStatus,
      target_verified_at: text(input.verifiedAt, 50),
      target_confidence: text(input.confidence, 20),
      target_notes: text(input.internalNotes, 10000),
    });
    if (result.error) return databaseFailure(result.error, "No fue posible crear el borrador.");
    if (effectiveFrom || effectiveUntil) {
      const scheduled = await access.client.from("admin_catalog_revisions").update({ effective_from: effectiveFrom, effective_until: effectiveUntil }).eq("id", result.data.id).select("*").single();
      if (scheduled.error) return databaseFailure(scheduled.error, "El Draft se creó, pero no fue posible guardar su vigencia.");
      return json({ item: scheduled.data }, 201);
    }
    return json({ item: result.data }, 201);
  }

  if (operation === "previewRevision") {
    const revisionId = uuid(input.revisionId);
    if (!revisionId) return json({ error: "La revisión no es válida.", code: "INVALID_REVISION" }, 400);
    const result = await access.client.rpc("admin_prepare_revision_v1", { revision_id: revisionId });
    if (result.error) return databaseFailure(result.error, "No fue posible preparar el Preview.");
    return json({ preview: result.data });
  }

  if (operation === "transitionRevision") {
    const revisionId = uuid(input.revisionId);
    const nextStatus = text(input.nextStatus, 30);
    const reason = text(input.reason, 2000);
    const requestId = uuid(input.requestId) || crypto.randomUUID();
    if (!revisionId || !nextStatus || !reason) return json({ error: "Faltan revisión, estado o motivo.", code: "INVALID_TRANSITION" }, 400);
    const result = await access.client.rpc("admin_transition_revision_v1", { revision_id: revisionId, next_status: nextStatus, transition_reason: reason, request_id: requestId });
    if (result.error) return databaseFailure(result.error, "No fue posible cambiar el estado.");
    return json({ item: result.data, requestId });
  }

  if (operation === "publishRevision") {
    const revisionId = uuid(input.revisionId);
    const previewHash = text(input.previewHash, 64);
    const reason = text(input.reason, 2000);
    const requestId = uuid(input.requestId) || crypto.randomUUID();
    if (!revisionId || !previewHash || !/^[0-9a-f]{64}$/.test(previewHash) || !reason) return json({ error: "La confirmación de publicación no es válida.", code: "INVALID_PUBLICATION" }, 400);
    const result = await access.client.rpc("admin_publish_revision_v1", { revision_id: revisionId, expected_preview_hash: previewHash, publish_reason: reason, request_id: requestId });
    if (result.error) return databaseFailure(result.error, "No fue posible publicar; vuelve a generar el Preview.");
    return json({ item: result.data, requestId });
  }

  if (operation === "createCourseConfiguration") {
    const payload = record(input.payload);
    if (!payload) return json({ error: "La configuración temporal no es válida.", code: "INVALID_CONFIGURATION" }, 400);
    const courseId = text(payload.courseId, 240); const scopeType = text(payload.scopeType, 30); const sourceDescription = text(payload.sourceDescription, 2000);
    const effectiveFrom = text(payload.effectiveFrom, 50); const effectiveUntil = text(payload.effectiveUntil, 50); const holesInput = Array.isArray(payload.holes) ? payload.holes : [];
    if (!courseId || !["COURSE", "COMPETITION"].includes(scopeType || "") || !sourceDescription || !effectiveFrom || Number.isNaN(Date.parse(effectiveFrom)) || (effectiveUntil && (Number.isNaN(Date.parse(effectiveUntil)) || Date.parse(effectiveUntil) <= Date.parse(effectiveFrom)))) return json({ error: "Campo, alcance, vigencia y fuente operativa son obligatorios.", code: "INVALID_CONFIGURATION" }, 400);
    if (scopeType === "COMPETITION" && !uuid(payload.competitionId)) return json({ error: "El override de competición requiere una Competition válida.", code: "INVALID_COMPETITION_ID" }, 400);
    const catalog = await getCourseCatalog(); const catalogCourse = catalog.courses.find((course) => course.id === courseId && course.active);
    if (!catalogCourse) return json({ error: "El Course base no existe en el catálogo publicado.", code: "COURSE_NOT_FOUND" }, 404);
    const baseHoleIds = new Set(catalog.holes.filter((hole) => hole.courseId === courseId).map((hole) => hole.id)); const teeIds = new Set(catalog.tees.filter((tee) => tee.courseId === courseId && tee.active).map((tee) => tee.id));
    const playable = holesInput.filter((value) => record(value)?.playable !== false); const runtimes = new Set<number>(); const sequences = new Set<number>(); const clientKeys = new Set<string>();
    if (![9, 18].includes(playable.length) || holesInput.length > 36) return json({ error: "La configuración debe resolver exactamente 9 o 18 hoyos jugables.", code: "INVALID_PLAYABLE_HOLES" }, 400);
    for (const value of holesInput) {
      const hole = record(value); const sequence = finiteNumber(hole?.sequence); const runtime = finiteNumber(hole?.runtimeHoleNumber); const isPlayable = hole?.playable !== false; const kind = text(hole?.kind, 20); const clientKey = text(hole?.clientKey, 100);
      if (!hole || !clientKey || clientKeys.has(clientKey) || !Number.isInteger(sequence) || sequence! < 1 || sequence! > 36 || sequences.has(sequence!)) return json({ error: "La secuencia o identidad de hoyos no es válida o está duplicada.", code: "INVALID_HOLE_SEQUENCE" }, 400);
      clientKeys.add(clientKey);
      sequences.add(sequence!);
      if (isPlayable && (!Number.isInteger(runtime) || runtime! < 1 || runtime! > playable.length || runtimes.has(runtime!))) return json({ error: "La numeración runtime de hoyos jugables debe ser única y consecutiva.", code: "INVALID_RUNTIME_HOLE" }, 400);
      if (isPlayable) runtimes.add(runtime!);
      if (kind === "BASE" && !baseHoleIds.has(String(hole.sourceBaseHoleId))) return json({ error: "Un hoyo BASE no corresponde al Course publicado.", code: "INVALID_BASE_HOLE" }, 400);
      if (kind === "TEMPORARY" && isPlayable && (finiteNumber(hole.parOverride) === null || finiteNumber(hole.strokeIndexOverride) === null)) return json({ error: "Un hoyo temporal jugable requiere par y Stroke Index verificados.", code: "TEMPORARY_FACTS_REQUIRED" }, 400);
    }
    if (runtimes.size !== playable.length) return json({ error: "Los runtime holes deben cubrir todos los hoyos jugables.", code: "INVALID_RUNTIME_HOLE" }, 400);
    for (const value of Array.isArray(payload.teeHoles) ? payload.teeHoles : []) {
      const row = record(value); const yards = finiteNumber(row?.yardsOverride); const verifiedAt = text(row?.verifiedAt, 50);
      if (!row || !clientKeys.has(String(row.configurationHoleKey)) || !teeIds.has(String(row.teeId)) || !Number.isInteger(yards) || yards! < 1 || yards! > 1000 || !text(row.source, 2000) || !verifiedAt || Number.isNaN(Date.parse(verifiedAt))) return json({ error: "Cada yardaje temporal requiere hoyo/tee válido, fuente y fecha verificadas.", code: "INVALID_TEMPORARY_YARDAGE" }, 400);
    }
    for (const value of Array.isArray(payload.ratings) ? payload.ratings : []) {
      const row = record(value); const rating = finiteNumber(row?.rating); const slope = finiteNumber(row?.slope); const verifiedAt = text(row?.verifiedAt, 50);
      if (!row || !teeIds.has(String(row.teeId)) || rating === null || rating < 40 || rating > 100 || !Number.isInteger(slope) || slope! < 55 || slope! > 155 || !text(row.source, 2000) || !verifiedAt || Number.isNaN(Date.parse(verifiedAt))) return json({ error: "Rating/Slope temporal requiere tee válido, fuente y fecha verificadas.", code: "INVALID_TEMPORARY_RATING" }, 400);
    }
    const result = await access.client.rpc("admin_create_course_configuration_v1", { configuration_payload: payload });
    if (result.error) return databaseFailure(result.error, "No fue posible crear la configuración temporal.");
    return json({ item: result.data }, 201);
  }

  if (operation === "publishCourseConfiguration") {
    const configurationId = uuid(input.configurationId);
    const previewHash = text(input.previewHash, 64);
    const resolution = text(input.overlapResolution, 40) || "CANCEL";
    const reason = text(input.reason, 2000);
    const requestId = uuid(input.requestId) || crypto.randomUUID();
    if (!configurationId || !previewHash || !/^[0-9a-f]{64}$/.test(previewHash) || !reason) return json({ error: "Faltan configuración, Preview vigente o motivo.", code: "INVALID_CONFIGURATION_PUBLICATION" }, 400);
    const result = await access.client.rpc("admin_publish_course_configuration_v2", { configuration_id: configurationId, expected_preview_hash: previewHash, overlap_resolution: resolution, publish_reason: reason, request_id: requestId });
    if (result.error) return databaseFailure(result.error, "No fue posible publicar la configuración temporal.");
    return json({ item: result.data, requestId });
  }

  if (operation === "previewCourseConfiguration") {
    const configurationId = uuid(input.configurationId);
    if (!configurationId) return json({ error: "La configuración no es válida.", code: "INVALID_CONFIGURATION" }, 400);
    const result = await access.client.rpc("admin_prepare_course_configuration_v1", { configuration_id: configurationId });
    if (result.error) return databaseFailure(result.error, "No fue posible generar el Preview temporal.");
    return json({ preview: result.data });
  }

  if (operation === "previewImport") {
    const format = text(input.format, 20);
    const kind = text(input.kind, 40);
    const scopeType = text(input.scopeType, 30) || (kind === "COURSE" ? "COURSE" : "CATALOG");
    const scopeId = text(input.scopeId, 240) || (kind === "COURSE" ? null : "equipment");
    const source = text(input.source, 2_000_000);
    if (!["CSV", "JSON"].includes(format || "") || !source || !["COURSE", "CLUB_EQUIPMENT", "BALL", "SHAFT"].includes(kind || "")) return json({ error: "Usa CSV o JSON con la plantilla controlada.", code: "INVALID_IMPORT" }, 400);
    let rows: Array<{ rowNumber: number; value: Record<string, unknown> }>;
    try { rows = format === "JSON" ? jsonObjects(source) : csvObjects(source); } catch { return json({ error: `No fue posible analizar el ${format || "archivo"}.`, code: "INVALID_IMPORT" }, 400); }
    let diff: Array<{ rowNumber: number; status: string; value: Record<string, unknown> | null; existingId: string | null; issues: string[] }> = [];
    if (kind === "COURSE") {
      const catalog = await getCourseCatalog();
      const byId = new Map(catalog.courses.map((item) => [item.id, item]));
      const byName = new Map(catalog.courses.map((item) => [String(item.name).trim().toLocaleLowerCase("es-MX"), item]));
      diff = rows.map((row) => {
        const id = text(row.value.id, 240); const name = text(row.value.name, 240); const clubId = text(row.value.clubId, 240); const clubName = text(row.value.clubName, 240); const sourceName = text(row.value.sourceName, 240); const holes = Number(row.value.holes);
        const issues = [!id ? "Falta id." : "", !name ? "Falta name." : "", !clubId ? "Falta clubId." : "", !clubName ? "Falta clubName." : "", ![9, 18].includes(holes) ? "holes debe ser 9 o 18." : "", !sourceName ? "Falta sourceName." : ""].filter(Boolean);
        if (issues.length || !id || !name) return { rowNumber: row.rowNumber, status: "INVALID", value: row.value, existingId: null, issues };
        const exact = byId.get(id); const duplicate = byName.get(name.toLocaleLowerCase("es-MX"));
        const value = { id, sourceName, sourceUrl: text(row.value.sourceUrl, 1000), verifiedAt: text(row.value.verifiedAt, 50), sourceType: text(row.value.sourceType, 50) || "ADMIN_RESEARCH", confidence: text(row.value.confidence, 20), club: { id: clubId, name: clubName, aliases: [], country: text(row.value.country, 120), stateRegion: text(row.value.stateRegion, 160), city: text(row.value.city, 160), active: true }, course: { id, clubId, name, aliases: [], holes, active: true }, tees: [], holes: [], teeHoleYardages: [] };
        return { rowNumber: row.rowNumber, status: exact ? "UPDATE" : duplicate ? "POSSIBLE_DUPLICATE" : "NEW", value, existingId: exact?.id || duplicate?.id || null, issues: duplicate && !exact ? ["Coincide el nombre de un recorrido existente."] : [] };
      });
    } else {
      const existing = (kind === "BALL" ? golfBallCatalog : kind === "SHAFT" ? golfShaftCatalog : golfClubCatalog).map((item) => ({ id: item.id, brand: item.brand, model: item.model, generation: item.generation, year: item.year, categoryOrUsage: "category" in item ? item.category : "usage" in item ? item.usage : null }));
      const candidates: Array<{
        rowNumber: number;
        value: (EquipmentIdentity & { id: string } & JsonRecord) | null;
        issues: string[];
      }> = rows.map((row) => {
        const id = text(row.value.id, 240); const brand = text(row.value.brand, 160); const model = text(row.value.model, 200); const sourceName = text(row.value.sourceName, 240);
        const generation = text(row.value.generation, 120); const yearValue = Number(row.value.year); const year = Number.isInteger(yearValue) && yearValue >= 1900 && yearValue <= 2100 ? yearValue : null;
        const categoryOrUsage = text(row.value.category ?? row.value.usage, 80);
        const verifiedAt = text(row.value.verifiedAt, 50); const sourceUrl = text(row.value.sourceUrl, 1000); const sourceType = text(row.value.sourceType, 50) || "ADMIN_RESEARCH";
        const requiredIssues = [!id ? "Falta id." : "", !brand ? "Falta brand." : "", !model ? "Falta model." : "", !sourceName ? "Falta sourceName." : ""].filter(Boolean);
        if (!id || !brand || !model) return { rowNumber: row.rowNumber, value: null, issues: requiredIssues };
        const common = { id, aliases: importStrings(row.value.aliases), brand, model, generation, year, active: row.value.active === false || String(row.value.active).toLowerCase() === "false" ? false : true, bagEligible: row.value.bagEligible === false || String(row.value.bagEligible).toLowerCase() === "false" ? false : true, fitEligible: false, sourceName, sourceUrl, sourceType, confidence: text(row.value.confidence, 20), provenance: [], verifiedAt, officialUrl: text(row.value.officialUrl, 1000), categoryOrUsage };
        const value = kind === "CLUB_EQUIPMENT" ? { ...common, category: categoryOrUsage, subCategory: text(row.value.subCategory, 120), handedness: importStrings(row.value.handedness), lofts: importNumbers(row.value.lofts), variants: [], standardLength: finiteNumber(row.value.standardLength), lie: finiteNumber(row.value.lie), headVolume: finiteNumber(row.value.headVolume), setMakeup: text(row.value.setMakeup, 500), stockShafts: importStrings(row.value.stockShafts), stockFlexes: importStrings(row.value.stockFlexes), externalId: null }
          : kind === "SHAFT" ? { ...common, usage: categoryOrUsage, oemStockOrAftermarket: text(row.value.oemStockOrAftermarket, 40), weightOptions: importNumbers(row.value.weightOptions), flexOptions: importStrings(row.value.flexOptions), weight: null, flex: [], launch: text(row.value.launch, 30), spin: text(row.value.spin, 30), material: text(row.value.material, 120), torqueRange: importNumbers(row.value.torqueRange), torque: null, tipDiameter: finiteNumber(row.value.tipDiameter), buttDiameter: finiteNumber(row.value.buttDiameter) }
            : { ...common, coverMaterial: text(row.value.coverMaterial, 120), construction: text(row.value.construction, 120), constructionPieces: finiteNumber(row.value.constructionPieces), compression: finiteNumber(row.value.compression), compressionType: finiteNumber(row.value.compression) === null ? "UNKNOWN" : text(row.value.compressionType, 40) || "MANUFACTURER", compressionSource: finiteNumber(row.value.compression) === null ? null : sourceName, compressionSourceUrl: finiteNumber(row.value.compression) === null ? null : sourceUrl, flight: text(row.value.flight, 30), driverSpin: text(row.value.driverSpin, 30), ironSpin: text(row.value.ironSpin, 30), shortGameSpin: text(row.value.shortGameSpin, 30), feel: text(row.value.feel, 30), colors: importStrings(row.value.colors), priceTier: text(row.value.priceTier, 30), targetProfile: importStrings(row.value.targetProfile) };
        const issues = [...requiredIssues, ...equipmentPayloadIssues(value, kind as AdminEntityType, id)];
        return { rowNumber: row.rowNumber, value, issues };
      });
      diff = equipmentImportPreview(candidates, existing);
    }
    const summary = { total: diff.length, new: diff.filter((row) => row.status === "NEW").length, invalid: diff.filter((row) => row.status === "INVALID").length, update: diff.filter((row) => row.status === "UPDATE").length, duplicate: diff.filter((row) => row.status === "POSSIBLE_DUPLICATE").length, noChange: diff.filter((row) => row.status === "NO_CHANGE").length };
    const job = await access.client.from("admin_import_jobs").insert({ kind, scope_type: scopeType, scope_id: scopeType === "GLOBAL" ? null : scopeId, status: "PREVIEWED", source_format: format, summary, created_by: access.userId }).select("id,kind,status,summary,created_at").single();
    if (job.error || !job.data) return databaseFailure(job.error, "No fue posible crear el Preview de importación.");
    const previewRows = diff.slice(0, 500).map((row) => ({ import_id: job.data.id, row_number: row.rowNumber, status: row.status, normalized_payload: row.value, existing_entity_id: row.existingId, issues: row.issues }));
    if (previewRows.length) {
      const inserted = await access.client.from("admin_import_rows").insert(previewRows);
      if (inserted.error) return databaseFailure(inserted.error, "No fue posible guardar el diff de importación.");
    }
    return json({ job: job.data, rows: previewRows }, 201);
  }

  if (operation === "confirmImport") {
    const importId = uuid(input.importId); const reason = text(input.reason, 2000); const requestId = uuid(input.requestId) || crypto.randomUUID();
    if (!importId || !reason) return json({ error: "Faltan importación o motivo de aprobación.", code: "INVALID_IMPORT_CONFIRMATION" }, 400);
    const result = await access.client.rpc("admin_confirm_import_v1", { target_import_id: importId, confirmation_reason: reason, request_id: requestId });
    if (result.error) return databaseFailure(result.error, "No fue posible crear los Drafts aprobados.");
    return json({ result: result.data, requestId });
  }

  if (operation === "createDraftFromRequest") {
    const feedbackId = uuid(input.feedbackId);
    const entityType = text(input.entityType, 50);
    const requestId = uuid(input.requestId) || crypto.randomUUID();
    if (!feedbackId || !entityType) return json({ error: "La solicitud o tipo de borrador no es válido.", code: "INVALID_REQUEST_DRAFT" }, 400);
    const result = await access.client.rpc("admin_create_draft_from_request_v1", { feedback_id: feedbackId, draft_entity_type: entityType, request_id: requestId });
    if (result.error) return databaseFailure(result.error, "No fue posible convertir la solicitud en borrador.");
    return json({ item: result.data, requestId }, 201);
  }

  if (operation === "export") {
    const exportType = text(input.entityType, 50);
    const exportId = text(input.entityId, 240);
    if (!exportType || !exportId) return json({ error: "Selecciona qué exportar.", code: "INVALID_EXPORT" }, 400);
    const result = await access.client.rpc("admin_export_entity_v1", { export_type: exportType, export_id: exportId });
    if (result.error) return databaseFailure(result.error, "No fue posible exportar el registro.");
    return json({ entityType: exportType, entityId: exportId, data: result.data });
  }

  return json({ error: "Operación administrativa inválida.", code: "INVALID_OPERATION" }, 400);
}
