import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import packageJson from "../package.json";
import { getSupabaseAdmin, getSupabaseForUser } from "./supabase/server";
import { adminAccessDecision } from "./admin-core";

export const runtimeIdentity = () => ({
  appVersion: process.env.APP_VERSION || process.env.npm_package_version || packageJson.version,
  buildSha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
});

export function requestBearer(request: NextRequest) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

export async function authenticatedUser(request: NextRequest): Promise<{ user: User; token: string } | null> {
  const token = requestBearer(request);
  if (!token) return null;
  const client = getSupabaseForUser(token);
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  return error || !data.user ? null : { user: data.user, token };
}

export type AdminContext = { user: User; admin: SupabaseClient };

export async function requireAdmin(request: NextRequest): Promise<AdminContext | NextResponse> {
  const authenticated = await authenticatedUser(request);
  if (!authenticated) return NextResponse.json({ error: "Inicia sesión." }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Administración no configurada." }, { status: 503 });
  const { data, error } = await admin.from("profiles").select("role").eq("id", authenticated.user.id).maybeSingle();
  if (error) return NextResponse.json({ error: migrationFailure(error) }, { status: 503 });
  if (!adminAccessDecision(data?.role)) return NextResponse.json({ error: "Acceso restringido." }, { status: 403 });
  return { user: authenticated.user, admin };
}

export function migrationFailure(error: unknown) {
  const candidate = (error && typeof error === "object" ? error : {}) as { code?: string };
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(String(candidate.code || ""))
    ? "La migración production-hardening V1 está pendiente en este entorno."
    : "No fue posible consultar la administración.";
}

export function isNextResponse(value: AdminContext | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
