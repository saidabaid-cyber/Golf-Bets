import { NextRequest, NextResponse } from "next/server";
import { requireAdminMode } from "../../../../lib/admin-mode.server";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });
export async function GET(request: NextRequest) {
  const access = await requireAdminMode(request, "administrators");
  if (!access.ok) return json({ error: access.error, code: access.code }, access.status);
  const query = request.nextUrl.searchParams.get("q") || "";
  if (query.length > 160) return json({ error: "La búsqueda es demasiado larga." }, 400);
  const offset=Number(request.nextUrl.searchParams.get("offset")||0);if(!Number.isInteger(offset)||offset<0||offset>100000)return json({error:"Página no válida."},400);
  const result = await access.client.rpc("admin_user_directory_v2", { search_text: query, page_offset: offset });
  return result.error ? json({ error: "No pudimos consultar los usuarios.", code: "ADMIN_SCHEMA_PENDING" }, 503) : json({ items: result.data });
}
export async function POST(request: NextRequest) {
  const access = await requireAdminMode(request, "administrators");
  if (!access.ok) return json({ error: access.error, code: access.code }, access.status);
  const body = await request.json().catch(() => null);
  if (!body || !/^[\da-f-]{36}$/i.test(body.userId || "") || !["PLAYER", "ADMIN"].includes(body.role) || !["PLAYER", "ADMIN"].includes(body.expectedRole) || typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.length > 1000 || !/^[\da-f-]{36}$/i.test(body.operationId || "")) return json({ error: "Revisa el usuario, rol y motivo del cambio." }, 400);
  const result = await access.client.rpc("admin_change_role_v2", { target_user_id: body.userId, expected_role: body.expectedRole, new_role: body.role, change_reason: body.reason, operation_id: body.operationId });
  return result.error ? json({ error: "No se cambió el rol. Recarga y comprueba los permisos del usuario.", code: "ROLE_CHANGE_DENIED" }, result.error.code === "42501" ? 403 : 409) : json({ item: result.data });
}
