import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  GOLF_CATALOG_ADMIN_DEFINITIONS,
  hasImmutableAdminRole,
  normalizeGolfAdminSearch,
  normalizeGolfCatalogAdminWrite,
  parseAdminBearerToken,
  parseGolfAdminLimit,
  parseGolfCatalogAdminResource,
  validGolfAdminId,
  type GolfCatalogAdminResource,
} from "../../../../lib/golf-catalog-admin-contract";
import { equipmentCloudServerEnabled } from "../../../../lib/feature-flags";
import { getSupabaseAdmin, getSupabaseForUser } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64_000;
const PRIVATE_NO_STORE = { "cache-control": "private, no-store" };

type AdminAccess =
  | { ok: true; admin: SupabaseClient }
  | { ok: false; response: NextResponse };

type JsonRead =
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse };

type CanonicalBrand =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; response: NextResponse };

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeDbCode(error: unknown): string | null {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}

function logFailure(operation: string, resource: GolfCatalogAdminResource, error: unknown) {
  console.error("[golf-catalog-admin] database operation failed", {
    operation,
    resource,
    code: safeDbCode(error) || "unknown",
  });
}

async function requireAdmin(request: NextRequest): Promise<AdminAccess> {
  // Fail closed before constructing any Supabase client. Preview deployments
  // can inherit shared credentials; an operator must first migrate and opt in
  // the isolated Beta database explicitly.
  if (!equipmentCloudServerEnabled) {
    return { ok: false, response: json({ error: "La administración del catálogo aún no está habilitada en este entorno Beta.", code: "CATALOG_ADMIN_DISABLED" }, 503) };
  }
  const token = parseAdminBearerToken(request.headers.get("authorization"));
  if (!token) return { ok: false, response: json({ error: "Inicia sesión con una cuenta administradora.", code: "AUTH_REQUIRED" }, 401) };
  const userClient = getSupabaseForUser(token, "cloud");
  const admin = getSupabaseAdmin("cloud");
  if (!userClient || !admin) {
    return { ok: false, response: json({ error: "La administración del catálogo no está configurada en este entorno.", code: "ADMIN_UNAVAILABLE" }, 503) };
  }
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return { ok: false, response: json({ error: "La sesión terminó. Vuelve a iniciar sesión.", code: "AUTH_REQUIRED" }, 401) };
  if (!hasImmutableAdminRole(data.user.app_metadata)) {
    return { ok: false, response: json({ error: "Tu cuenta no tiene permiso para administrar catálogos.", code: "ADMIN_REQUIRED" }, 403) };
  }
  return { ok: true, admin };
}

async function readJson(request: NextRequest): Promise<JsonRead> {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { ok: false, response: json({ error: "La solicitud excede el tamaño permitido.", code: "BODY_TOO_LARGE" }, 413) };
  }
  if (!request.body) return { ok: false, response: json({ error: "Faltan datos para guardar.", code: "INVALID_BODY" }, 400) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, response: json({ error: "La solicitud excede el tamaño permitido.", code: "BODY_TOO_LARGE" }, 413) };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, response: json({ error: "La solicitud no contiene JSON válido.", code: "INVALID_BODY" }, 400) };
  }
}

function resourceFromRequest(request: NextRequest): GolfCatalogAdminResource | null {
  return parseGolfCatalogAdminResource(request.nextUrl.searchParams.get("resource"));
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => record(item) !== null) : [];
}

async function canonicalizeBrand(
  admin: SupabaseClient,
  resource: GolfCatalogAdminResource,
  input: Record<string, unknown>,
): Promise<CanonicalBrand> {
  const brandTable = resource === "balls"
    ? "golf_ball_brands"
    : resource === "club-models"
      ? "golf_club_brands"
      : null;
  if (!brandTable) return { ok: true, data: input };

  const brandId = input.brand_id;
  if (brandId === undefined) {
    if (input.brand !== undefined) {
      return { ok: false, response: json({ error: "Selecciona una marca registrada.", code: "BRAND_REFERENCE_REQUIRED" }, 400) };
    }
    return { ok: true, data: input };
  }
  if (typeof brandId !== "string") {
    return { ok: false, response: json({ error: "La marca seleccionada no es válida.", code: "INVALID_BRAND_REFERENCE" }, 400) };
  }

  const { data, error } = await admin
    .from(brandTable)
    .select("id,name")
    .eq("id", brandId)
    .maybeSingle();
  if (error) {
    logFailure("resolve-brand", resource, error);
    return { ok: false, response: json({ error: "No fue posible validar la marca seleccionada.", code: "BRAND_LOOKUP_FAILED" }, 503) };
  }
  const brand = record(data);
  if (!brand || typeof brand.name !== "string") {
    return { ok: false, response: json({ error: "La marca seleccionada ya no existe.", code: "INVALID_BRAND_REFERENCE" }, 400) };
  }
  if (typeof input.brand === "string" && input.brand.localeCompare(brand.name, undefined, { sensitivity: "accent" }) !== 0) {
    return { ok: false, response: json({ error: "El nombre no coincide con la marca seleccionada.", code: "BRAND_MISMATCH" }, 400) };
  }
  return { ok: true, data: { ...input, brand: brand.name } };
}

export async function GET(request: NextRequest) {
  const access = await requireAdmin(request);
  if (!access.ok) return access.response;
  const resource = resourceFromRequest(request);
  if (!resource) return json({ error: "Selecciona un catálogo válido.", code: "INVALID_RESOURCE" }, 400);
  const definition = GOLF_CATALOG_ADMIN_DEFINITIONS[resource];
  const limit = parseGolfAdminLimit(request.nextUrl.searchParams.get("limit"));
  const cursor = request.nextUrl.searchParams.get("cursor")?.trim() || null;
  if (cursor && !validGolfAdminId(cursor, definition.idKind)) {
    return json({ error: "El cursor de paginación no es válido.", code: "INVALID_CURSOR" }, 400);
  }
  const search = normalizeGolfAdminSearch(request.nextUrl.searchParams.get("q"));
  const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
  let query = access.admin
    .from(definition.table)
    .select(definition.select)
    .order("id", { ascending: true })
    .limit(limit + 1);
  if (cursor) query = query.gt("id", cursor);
  if (search && definition.searchColumn) query = query.ilike(definition.searchColumn, `%${search}%`);
  if (!includeArchived && definition.activeColumn) query = query.eq(definition.activeColumn, true);
  if (definition.parentFilter) {
    const parentId = request.nextUrl.searchParams.get(definition.parentFilter.parameter)?.trim() || null;
    if (parentId) {
      if (!validGolfAdminId(parentId, "text")) {
        return json({ error: "El filtro relacionado no es válido.", code: "INVALID_FILTER" }, 400);
      }
      query = query.eq(definition.parentFilter.column, parentId);
    }
  }
  const { data, error } = await query;
  if (error) {
    logFailure("list", resource, error);
    return json({ error: "No fue posible cargar el catálogo.", code: "CATALOG_READ_FAILED" }, 503);
  }
  const resultRows = rows(data);
  const hasMore = resultRows.length > limit;
  const items = hasMore ? resultRows.slice(0, limit) : resultRows;
  const lastId = items.at(-1)?.id;
  return json({ items, hasMore, nextCursor: hasMore && typeof lastId === "string" ? lastId : null });
}

export async function POST(request: NextRequest) {
  const access = await requireAdmin(request);
  if (!access.ok) return access.response;
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const input = record(body.value);
  const resource = parseGolfCatalogAdminResource(input?.resource);
  if (!resource) return json({ error: "Selecciona un catálogo válido.", code: "INVALID_RESOURCE" }, 400);
  const write = normalizeGolfCatalogAdminWrite(resource, input?.data, "create");
  if (!write.ok) return json({ error: write.error, code: "INVALID_CATALOG_DATA" }, 400);
  const canonical = await canonicalizeBrand(access.admin, resource, write.data);
  if (!canonical.ok) return canonical.response;
  const definition = GOLF_CATALOG_ADMIN_DEFINITIONS[resource];
  const { data, error } = await access.admin.from(definition.table).insert(canonical.data).select(definition.select).single();
  if (error) {
    logFailure("create", resource, error);
    const conflict = safeDbCode(error) === "23505";
    return json({
      error: conflict ? "Ya existe un registro con esa identidad." : "No fue posible agregar el registro. Revisa los datos verificados.",
      code: conflict ? "CATALOG_CONFLICT" : "CATALOG_WRITE_FAILED",
    }, conflict ? 409 : 400);
  }
  return json({ item: data }, 201);
}

export async function PATCH(request: NextRequest) {
  const access = await requireAdmin(request);
  if (!access.ok) return access.response;
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const input = record(body.value);
  const resource = parseGolfCatalogAdminResource(input?.resource);
  if (!resource) return json({ error: "Selecciona un catálogo válido.", code: "INVALID_RESOURCE" }, 400);
  const definition = GOLF_CATALOG_ADMIN_DEFINITIONS[resource];
  if (!validGolfAdminId(input?.id, definition.idKind)) {
    return json({ error: "El registro por editar no es válido.", code: "INVALID_ID" }, 400);
  }
  const write = normalizeGolfCatalogAdminWrite(resource, input?.changes, "update");
  if (!write.ok) return json({ error: write.error, code: "INVALID_CATALOG_DATA" }, 400);
  const canonical = await canonicalizeBrand(access.admin, resource, write.data);
  if (!canonical.ok) return canonical.response;
  const { data, error } = await access.admin
    .from(definition.table)
    .update(canonical.data)
    .eq("id", input.id)
    .select(definition.select)
    .maybeSingle();
  if (error) {
    logFailure("update", resource, error);
    const conflict = safeDbCode(error) === "23505";
    return json({
      error: conflict ? "El cambio duplicaría otro registro." : "No fue posible guardar los cambios. Revisa los datos verificados.",
      code: conflict ? "CATALOG_CONFLICT" : "CATALOG_WRITE_FAILED",
    }, conflict ? 409 : 400);
  }
  if (!data) return json({ error: "El registro ya no existe.", code: "NOT_FOUND" }, 404);
  return json({ item: data });
}
