import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  GOLF_CATALOG_ADMIN_DEFINITIONS,
  normalizeGolfAdminSearch,
  parseAdminBearerToken,
  parseGolfAdminLimit,
  parseGolfCatalogAdminResource,
  validGolfAdminId,
  type GolfCatalogAdminResource,
} from "../../../../lib/golf-catalog-admin-contract";
import { equipmentCloudServerEnabled } from "../../../../lib/feature-flags";
import { getSupabaseForUser } from "../../../../lib/supabase/server";
import { accountAccessFailure } from "../../../../lib/account-access.server";
import { authUserFailure } from "../../../../lib/auth-errors";

export const dynamic = "force-dynamic";

const PRIVATE_NO_STORE = { "cache-control": "private, no-store" };

type AdminAccess =
  | { ok: true; admin: SupabaseClient }
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
  if (!userClient) {
    return { ok: false, response: json({ error: "La administración del catálogo no está configurada en este entorno.", code: "ADMIN_UNAVAILABLE" }, 503) };
  }
  const { data, error } = await userClient.auth.getUser(token);
  const failure = authUserFailure(error, !error && Boolean(data.user));
  if (failure) return { ok: false, response: json(failure, failure.status) };
  if (!data.user || data.user.is_anonymous) return { ok: false, response: json({ error: "La sesión terminó. Vuelve a iniciar sesión.", code: "AUTH_REQUIRED" }, 401) };
  const accessFailure = await accountAccessFailure(userClient);
  if (accessFailure) return { ok: false, response: json(accessFailure, accessFailure.status) };
  const membership = await userClient.from("admin_memberships").select("id").eq("user_id", data.user.id).eq("active", true).limit(1);
  if (membership.error) {
    return { ok: false, response: json({ error: "Admin Control Center requiere la migración aditiva en la base QA.", code: "ADMIN_SCHEMA_PENDING" }, 503) };
  }
  if (!membership.data?.length) {
    return { ok: false, response: json({ error: "Tu cuenta no tiene permiso para administrar catálogos.", code: "ADMIN_REQUIRED" }, 403) };
  }
  return { ok: true, admin: userClient };
}

function resourceFromRequest(request: NextRequest): GolfCatalogAdminResource | null {
  return parseGolfCatalogAdminResource(request.nextUrl.searchParams.get("resource"));
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => record(item) !== null) : [];
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
  return json({ error: "Las altas directas fueron reemplazadas por Draft → Review → Verify → Publish.", code: "ADMIN_WORKFLOW_REQUIRED", next: "/admin" }, 409);
}

export async function PATCH(request: NextRequest) {
  const access = await requireAdmin(request);
  if (!access.ok) return access.response;
  return json({ error: "Las ediciones directas fueron reemplazadas por una nueva revisión versionada.", code: "ADMIN_WORKFLOW_REQUIRED", next: "/admin" }, 409);
}
