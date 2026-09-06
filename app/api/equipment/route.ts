import { NextRequest, NextResponse } from "next/server";
import { authUserFailure } from "../../../lib/auth-errors";
import { equipmentCloudServerEnabled } from "../../../lib/feature-flags";
import { normalizeEquipmentProfile, normalizeEquipmentProfileStrict } from "../../../lib/golf-equipment";
import { getSupabaseAdmin, getSupabaseForUser } from "../../../lib/supabase/server";

const MAX_BODY_BYTES = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_NO_STORE = { "cache-control": "private, no-store" };

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE });
}

function bearer(request: NextRequest) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

async function account(request: NextRequest) {
  if (!equipmentCloudServerEnabled) return { error: "La sincronización de equipo todavía no está habilitada en Beta.", code: "EQUIPMENT_CLOUD_DISABLED", status: 503 } as const;
  const token = bearer(request);
  if (!token) return { error: "Inicia sesión para sincronizar tu equipo.", code: "AUTH_REQUIRED", status: 401 } as const;
  const supabase = getSupabaseForUser(token);
  const admin = getSupabaseAdmin("cloud");
  if (!supabase || !admin) return { error: "La nube no está configurada.", code: "CLOUD_UNAVAILABLE", status: 503 } as const;
  const { data, error } = await supabase.auth.getUser(token);
  const failure = authUserFailure(error, Boolean(data.user));
  if (failure) return failure;
  if (!data.user) return { error: "La sesión terminó. Vuelve a iniciar sesión.", code: "AUTH_REQUIRED", status: 401 } as const;
  return { supabase, admin, userId: data.user.id } as const;
}

type EquipmentRow = {
  snapshot: unknown;
  version: number;
  last_mutation_id: string;
  updated_at: string;
};

function responseRecord(row: EquipmentRow | null, userId: string) {
  if (!row) return null;
  const profile = normalizeEquipmentProfile(row.snapshot, userId);
  if (!profile) return null;
  return { profile, version: row.version, lastMutationId: row.last_mutation_id, updatedAt: row.updated_at };
}

function safeDbError(error: unknown) {
  const value = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
  if (value.code === "40001" || value.code === "23505" || value.code === "22023" || /equipment_profile_(version_conflict|mutation_id_reused)/i.test(value.message || "")) return { error: "Otro dispositivo cambió tu equipo. Actualiza antes de guardar.", code: "EQUIPMENT_VERSION_CONFLICT", status: 409 };
  if (value.code === "42501" || /row-level security|permission denied/i.test(value.message || "")) return { error: "Tu cuenta no tiene permiso para cambiar ese perfil de equipo.", code: "EQUIPMENT_PERMISSION_DENIED", status: 403 };
  return { error: "La sincronización de equipo no terminó. Tu copia local se conserva.", code: "EQUIPMENT_SYNC_FAILED", status: 503 };
}

type BodyRead =
  | { ok: true; value: unknown }
  | { ok: false; error: string; code: string; status: number };

async function readJsonBody(request: NextRequest): Promise<BodyRead> {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return { ok: false, error: "El perfil de equipo excede el tamaño permitido.", code: "EQUIPMENT_TOO_LARGE", status: 413 };
  if (!request.body) return { ok: false, error: "Falta el perfil de equipo.", code: "INVALID_EQUIPMENT_PROFILE", status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, error: "El perfil de equipo excede el tamaño permitido.", code: "EQUIPMENT_TOO_LARGE", status: 413 };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, error: "El contenido del perfil de equipo no es JSON válido.", code: "INVALID_JSON", status: 400 };
  }
}

async function latestEquipmentRow(client: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  if (!client) return null;
  const result = await client.from("player_equipment_profiles")
    .select("snapshot,version,last_mutation_id,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as EquipmentRow | null;
}

async function conflictResponse(client: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  const latest = await latestEquipmentRow(client, userId);
  return json({
    error: "Otro dispositivo cambió tu equipo. Actualiza antes de guardar.",
    code: "EQUIPMENT_VERSION_CONFLICT",
    conflict: responseRecord(latest, userId),
  }, 409);
}

function logFailure(operation: "read" | "write", error: unknown) {
  const value = error && typeof error === "object" ? error as { code?: string; status?: number } : {};
  console.error("backyard_equipment_sync_failed", { operation, code: String(value.code || "unknown").slice(0, 32), status: value.status || null });
}

export async function GET(request: NextRequest) {
  try {
    const authenticated = await account(request);
    if ("error" in authenticated) return json({ error: authenticated.error, code: authenticated.code || "AUTH_REQUIRED" }, authenticated.status);
    const { data, error } = await authenticated.supabase.from("player_equipment_profiles")
      .select("snapshot,version,last_mutation_id,updated_at")
      .eq("user_id", authenticated.userId)
      .maybeSingle();
    if (error) throw error;
    const result = responseRecord(data as EquipmentRow | null, authenticated.userId);
    if (data && !result) return json({ error: "El perfil de equipo guardado no es válido.", code: "INVALID_EQUIPMENT_PROFILE" }, 502);
    return json({ data: result });
  } catch (error) {
    logFailure("read", error);
    const safe = safeDbError(error);
    return json({ error: safe.error, code: safe.code }, safe.status);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authenticated = await account(request);
    if ("error" in authenticated) return json({ error: authenticated.error, code: authenticated.code || "AUTH_REQUIRED" }, authenticated.status);
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, parsed.status);
    const body = parsed.value && typeof parsed.value === "object" ? parsed.value as { profile?: unknown; expectedVersion?: unknown; mutationId?: unknown; deviceId?: unknown } : null;
    if (!body) return json({ error: "Perfil o versión de equipo inválidos.", code: "INVALID_EQUIPMENT_PROFILE" }, 400);
    const profile = normalizeEquipmentProfileStrict(body.profile, authenticated.userId);
    const expectedVersion = body.expectedVersion === null ? null : typeof body.expectedVersion === "number" && Number.isSafeInteger(body.expectedVersion) && body.expectedVersion > 0 ? body.expectedVersion : undefined;
    const mutationId = typeof body.mutationId === "string" && UUID.test(body.mutationId) ? body.mutationId : null;
    const deviceId = typeof body.deviceId === "string" && body.deviceId.trim().length >= 8 && body.deviceId.trim().length <= 120 ? body.deviceId.trim() : null;
    if (!profile || expectedVersion === undefined || !mutationId) return json({ error: "Perfil o versión de equipo inválidos.", code: "INVALID_EQUIPMENT_PROFILE" }, 400);

    const current = await latestEquipmentRow(authenticated.admin, authenticated.userId);
    if ((!current && expectedVersion !== null) || (current && expectedVersion !== current.version && mutationId !== current.last_mutation_id)) {
      return conflictResponse(authenticated.admin, authenticated.userId);
    }

    let saved: EquipmentRow | null = null;
    if (!current) {
      const result = await authenticated.admin.from("player_equipment_profiles").insert({
        user_id: authenticated.userId,
        snapshot: profile,
        schema_version: profile.schemaVersion,
        last_mutation_id: mutationId,
        updated_by_device: deviceId,
      }).select("snapshot,version,last_mutation_id,updated_at").single();
      if (result.error) {
        if (["23505", "40001", "22023"].includes(result.error.code || "")) return conflictResponse(authenticated.admin, authenticated.userId);
        throw result.error;
      }
      saved = result.data as EquipmentRow;
    } else {
      const result = await authenticated.admin.from("player_equipment_profiles").update({
        snapshot: profile,
        schema_version: profile.schemaVersion,
        expected_version: current.version,
        last_mutation_id: mutationId,
        updated_by_device: deviceId,
      }).eq("user_id", authenticated.userId).eq("version", current.version)
        .select("snapshot,version,last_mutation_id,updated_at").maybeSingle();
      if (result.error) {
        if (["23505", "40001", "22023"].includes(result.error.code || "")) return conflictResponse(authenticated.admin, authenticated.userId);
        throw result.error;
      }
      saved = result.data as EquipmentRow | null;
      if (!saved) return conflictResponse(authenticated.admin, authenticated.userId);
    }
    const data = responseRecord(saved, authenticated.userId);
    if (!data) throw new Error("invalid_equipment_record");
    return json({ data });
  } catch (error) {
    logFailure("write", error);
    const safe = safeDbError(error);
    return json({ error: safe.error, code: safe.code }, safe.status);
  }
}
