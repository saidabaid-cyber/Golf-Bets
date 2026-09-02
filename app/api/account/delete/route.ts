import { getSupabaseAdmin, getSupabaseForUser } from "../../../../lib/supabase/server";

export async function DELETE(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return Response.json({ error: "Sesión requerida." }, { status: 401 });
  let body: { confirmation?: string } = {};
  try { body = await request.json(); } catch { return Response.json({ error: "Solicitud inválida." }, { status: 400 }); }
  if (body.confirmation !== "ELIMINAR") return Response.json({ error: "Falta confirmación fuerte." }, { status: 400 });

  const userClient = getSupabaseForUser(token);
  const admin = getSupabaseAdmin();
  if (!userClient || !admin) return Response.json({ error: "La eliminación segura de cuentas está pendiente de configuración del servidor." }, { status: 503 });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return Response.json({ error: "Sesión no válida." }, { status: 401 });
  const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
  if (deleteError) return Response.json({ error: "No se pudo eliminar la cuenta." }, { status: 500 });
  return Response.json({ ok: true });
}
