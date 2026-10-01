import { NextRequest, NextResponse } from "next/server";
import { requireAdminMode } from "../../../../lib/admin-mode.server";
import { SIMPLE_ADMIN_MODULES, type SimpleAdminModule } from "../../../../lib/admin-mode";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "private, no-store" } });
export async function GET(request: NextRequest) {
  const module = request.nextUrl.searchParams.get("module");
  if (module && !(SIMPLE_ADMIN_MODULES as readonly string[]).includes(module)) return json({ error: "Sección no válida." }, 400);
  const access = await requireAdminMode(request, module as SimpleAdminModule | undefined);
  if (!access.ok) return json({ error: access.error, code: access.code }, access.status);
  if (!module) return json({ role: access.role, modules: access.modules });
  if (module === "users") {
    const result = await access.client.rpc("admin_user_directory_v2", { search_text: (request.nextUrl.searchParams.get("q") || "").slice(0,160), page_offset: 0 });
    return result.error ? json({ error: "No pudimos cargar los usuarios." }, 503) : json({ items: result.data });
  }
  return json({ error: "Sección no disponible." }, 404);
}
