import { NextRequest, NextResponse } from "next/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { isolatedPreviewDatabaseEnabled } from "../../../../lib/preview-database";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";
import { parseFrequentGroups } from "../../../../lib/frequent-templates";
import { normalizedInvitationEmail } from "../../../../lib/group-invitations";
import { sendGroupInvitationEmail } from "../../../../lib/group-invitation-email.server";
import { BACKYARD_AI_PRIVATE_HEADERS, isCrossSiteRequest, readJsonBodyWithLimit } from "../../../../lib/backyard-ai/server/http-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = BACKYARD_AI_PRIVATE_HEADERS;
const TIMEOUT_MS = 8_000;
async function bounded<T>(promise: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("GROUP_REQUEST_TIMEOUT")), TIMEOUT_MS); })]); }
  finally { if (timer) clearTimeout(timer); }
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function failure(error: { message?: string; code?: string }) {
  const reason = error.message || "";
  const status = error.code === "42501" ? 403 : error.code === "22P02" || error.code === "22023" || /INVALID_|EXPIRED/.test(reason) ? 400 : /RATE_LIMIT/.test(reason) ? 429 : 503;
  console.error("group_invitation_failed", { code: error.code || "UNKNOWN", status });
  return NextResponse.json({ error: status === 403 ? "Esta invitación no corresponde a tu cuenta o no tienes permiso para el grupo."
    : status === 400 ? "Revisa los datos o solicita una invitación vigente." : status === 429 ? "Espera antes de volver a invitar." : "No pudimos confirmar la invitación. Puedes reintentar." }, { status, headers });
}
export async function GET(request: NextRequest) {
  if (isCrossSiteRequest(request)) return NextResponse.json({ error: "Solicitud no permitida." }, { status: 403, headers });
  try {
  const account = await bounded(authenticatedRequest(request));
  if (!account.ok) return NextResponse.json({ error: account.error }, { status: account.status, headers });
  if (!isolatedPreviewDatabaseEnabled()) return NextResponse.json({ error: "Invitaciones no disponibles en este entorno." }, { status: 503, headers });
  const groupId = request.nextUrl.searchParams.get("groupId");
  const localGroupId = request.nextUrl.searchParams.get("localGroupId");
  if (groupId && !uuid(groupId)) return NextResponse.json({ error: "Grupo inválido." }, { status: 400, headers });
  if (localGroupId !== null && (!localGroupId.trim() || localGroupId.length > 200)) return NextResponse.json({ error: "Grupo inválido." }, { status: 400, headers });
  const { data, error } = await bounded(account.client.rpc("group_invitation_action_v1", { action: "list", payload: { ...(groupId ? { groupId } : {}), ...(localGroupId !== null ? { localGroupId } : {}) } }).abortSignal(AbortSignal.timeout(TIMEOUT_MS)));
  return error ? failure(error) : NextResponse.json({ ...data,
    emailDeliveryConfigured: Boolean(process.env.GROUP_INVITES_RESEND_API_KEY && normalizedInvitationEmail(process.env.GROUP_INVITES_FROM_EMAIL)),
  }, { headers });
  } catch { return failure({ code: "GROUP_LOOKUP_UNAVAILABLE" }); }
}
export async function POST(request: NextRequest) {
  if (isCrossSiteRequest(request)) return NextResponse.json({ error: "Solicitud no permitida." }, { status: 403, headers });
  try {
  const account = await bounded(authenticatedRequest(request));
  if (!account.ok) return NextResponse.json({ error: account.error }, { status: account.status, headers });
  if (!isolatedPreviewDatabaseEnabled()) return NextResponse.json({ error: "Invitaciones no disponibles en este entorno." }, { status: 503, headers });
  const read = await bounded(readJsonBodyWithLimit(request, 220_000));
  if (!read.ok) return NextResponse.json({ error: "Solicitud inválida." }, { status: read.reason === "unsupported_media_type" ? 415 : read.reason === "too_large" ? 413 : 400, headers });
  if (!read.value || typeof read.value !== "object" || Array.isArray(read.value)) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400, headers });
  const body = read.value as Record<string, unknown>;
  if (body.action === "ensure") {
    const group = parseFrequentGroups(JSON.stringify([body.group]))[0];
    if (!group?.name.trim() || group.name.length > 100) return NextResponse.json({ error: "Guarda un nombre para el grupo." }, { status: 400, headers });
    const { data, error } = await bounded(account.client.rpc("group_invitation_action_v1", { action: "ensure", payload: { group } }).abortSignal(AbortSignal.timeout(TIMEOUT_MS)));
    return error ? failure(error) : NextResponse.json(data, { headers });
  }
  if (body.action === "accept") {
    if (!uuid(body.invitationId) || (body.token != null && (typeof body.token !== "string" || !/^[0-9a-f]{64}$/.test(body.token)))) return NextResponse.json({ error: "Invitación inválida." }, { status: 400, headers });
    const { data, error } = await bounded(account.client.rpc("group_invitation_action_v1", { action: "accept", payload: { invitationId: body.invitationId, ...(body.token ? { token: body.token } : {}) } }).abortSignal(AbortSignal.timeout(TIMEOUT_MS)));
    return error ? failure(error) : NextResponse.json(data, { headers });
  }
  let invitationId: string;
  if (body.action === "create") {
    if (!uuid(body.groupId) || (!uuid(body.targetUserId) && !normalizedInvitationEmail(body.email))) return NextResponse.json({ error: "Escribe un correo válido o selecciona un usuario Backyard." }, { status: 400, headers });
    const { data, error } = await bounded(account.client.rpc("group_invitation_action_v1", { action: "create", payload: { groupId: body.groupId,
      ...(uuid(body.targetUserId) ? { targetUserId: body.targetUserId } : { email: normalizedInvitationEmail(body.email) }) } }).abortSignal(AbortSignal.timeout(TIMEOUT_MS)));
    if (error) return failure(error);
    if (data?.alreadyMember) return NextResponse.json({ alreadyMember: true }, { headers });
    if (!uuid(data?.invitationId)) return failure({ code: "GROUP_RESPONSE_INVALID" });
    invitationId = data.invitationId;
  } else if (body.action === "retry" && uuid(body.invitationId)) invitationId = body.invitationId;
  else return NextResponse.json({ error: "Acción inválida." }, { status: 400, headers });
  const admin = getSupabaseAdmin("cloud");
  if (!admin) return NextResponse.json({ error: "No pudimos iniciar el envío. Puedes reintentar." }, { status: 503, headers });
  const claimed = await bounded(admin.rpc("group_invitation_delivery_v1", { invitation_id: invitationId, actor_id: account.userId, operation: "claim" }).abortSignal(AbortSignal.timeout(TIMEOUT_MS)));
  if (claimed.error) return failure(claimed.error);
  if (claimed.data?.send !== true) {
    if (claimed.data?.send !== false || !["NOT_SENT", "SENDING", "ACCEPTED_BY_PROVIDER", "FAILED"].includes(claimed.data.status)) return failure({ code: "GROUP_RESPONSE_INVALID" });
    return NextResponse.json({ invitationId, deliveryStatus: claimed.data.status }, { headers });
  }
  if (typeof claimed.data.token !== "string" || !/^[a-f0-9]{64}$/.test(claimed.data.token) || !normalizedInvitationEmail(claimed.data.email)
    || typeof claimed.data.groupName !== "string" || !Number.isSafeInteger(claimed.data.attempt) || claimed.data.attempt < 1) return failure({ code: "GROUP_RESPONSE_INVALID" });
  const result = await sendGroupInvitationEmail({ id: invitationId, token: claimed.data.token, email: claimed.data.email, groupName: claimed.data.groupName, origin: request.nextUrl.origin });
  const finished = await bounded(admin.rpc("group_invitation_delivery_v1", { invitation_id: invitationId, actor_id: account.userId, operation: "finish", result: { ...result, attempt: claimed.data.attempt } }).abortSignal(AbortSignal.timeout(TIMEOUT_MS)));
  if (finished.error) return failure(finished.error);
  if (!finished.data || typeof finished.data.status !== "string") return failure({ code: "GROUP_RESPONSE_INVALID" });
  return NextResponse.json({ invitationId, deliveryStatus: finished.data.status,
    ...(result.errorCode ? { error: result.errorCode === "GROUP_EMAIL_NOT_CONFIGURED" ? "El envío de invitaciones aún no está configurado. No se envió ningún correo." : "El proveedor no confirmó el envío. Puedes reintentar.", code: result.errorCode } : {}) }, { status: result.errorCode ? 503 : 200, headers });
  } catch { return failure({ code: "GROUP_REQUEST_UNAVAILABLE" }); }
}
