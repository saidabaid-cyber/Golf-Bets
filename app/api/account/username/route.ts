import { NextRequest, NextResponse } from "next/server";
import { authUserFailure } from "../../../../lib/auth-errors";
import { accountAccessFailure } from "../../../../lib/account-access.server";
import { normalizeProfileUsername } from "../../../../lib/profile-username";
import { getSupabaseForUser } from "../../../../lib/supabase/server";

const PRIVATE = { "cache-control": "private, no-store" };

export async function GET(request: NextRequest) {
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) return NextResponse.json({ error: "Inicia sesión para validar tu nombre de usuario." }, { status: 401, headers: PRIVATE });
  const client = getSupabaseForUser(token);
  if (!client) return NextResponse.json({ error: "La validación no está disponible. Reintenta." }, { status: 503, headers: PRIVATE });
  const { data, error } = await client.auth.getUser(token);
  const failure = authUserFailure(error, !error && Boolean(data.user));
  if (failure) return NextResponse.json({ error: "La sesión no es válida." }, { status: failure.status, headers: PRIVATE });
  if (!data.user || data.user.is_anonymous) return NextResponse.json({ error: "Inicia sesión para validar tu nombre de usuario." }, { status: 401, headers: PRIVATE });
  const accessFailure = await accountAccessFailure(client);
  if (accessFailure) return NextResponse.json({ error: "Tu cuenta no puede realizar esta acción." }, { status: accessFailure.status, headers: PRIVATE });
  let username: string | undefined;
  try { username = normalizeProfileUsername(request.nextUrl.searchParams.get("username") || ""); }
  catch (validationError) { return NextResponse.json({ error: validationError instanceof Error ? validationError.message : "Nombre de usuario inválido." }, { status: 400, headers: PRIVATE }); }
  if (!username) return NextResponse.json({ error: "Escribe un nombre de usuario." }, { status: 400, headers: PRIVATE });
  const result = await client.rpc("profile_username_available", { candidate_username: username });
  if (result.error) {
    const pending = result.error.code === "42883" || /profile_username_available|schema cache/i.test(result.error.message || "");
    return NextResponse.json({ error: pending ? "La validación de nombres de usuario está pendiente de habilitarse en QA." : "No pudimos validar el nombre de usuario. Reintenta." }, { status: 503, headers: PRIVATE });
  }
  return NextResponse.json({ available: result.data === true }, { headers: PRIVATE });
}
