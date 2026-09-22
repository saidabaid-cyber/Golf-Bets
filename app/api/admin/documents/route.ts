import { NextRequest, NextResponse } from "next/server";

import { ADMIN_ENTITY_TYPES, ADMIN_SCOPE_TYPES, membershipAllows, type AdminMembership, type AdminEntityType, type AdminScopeType } from "../../../../lib/admin-control-center";
import { validateAdminDocument } from "../../../../lib/admin-documents";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { serverPhase2FeatureFlags } from "../../../../features/feature-flags/server";

export const dynamic = "force-dynamic";
const MAX_BYTES = 10 * 1024 * 1024;
const PRIVATE = { "cache-control": "private, no-store" };

function json(body: Record<string, unknown>, status = 200) { return NextResponse.json(body, { status, headers: PRIVATE }); }
function value(form: FormData, name: string, maximum = 1000) { const raw = form.get(name); return typeof raw === "string" ? raw.trim().slice(0, maximum) : ""; }
function safeName(name: string) { return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-120) || "document"; }

export async function GET(request: NextRequest) {
  if (!serverPhase2FeatureFlags().admin_v1) return json({ error: "Documentos no disponibles." }, 404);
  const account = await authenticatedRequest(request);
  if (!account.ok) return json({ error: account.error, code: account.code }, account.status);
  const documentId = request.nextUrl.searchParams.get("id")?.slice(0, 60) || "";
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return json({ error: "Documento inválido.", code: "INVALID_DOCUMENT" }, 400);
  const document = await account.client.from("admin_documents").select("id,storage_path,mime_type,original_name,rights_status,visibility,attribution").eq("id", documentId).maybeSingle();
  if (document.error) return json({ error: "No fue posible validar el documento.", code: "DOCUMENT_LOOKUP_FAILED" }, 503);
  if (!document.data) return json({ error: "Documento no encontrado o no autorizado.", code: "DOCUMENT_NOT_FOUND" }, 404);
  const signed = await account.client.storage.from("admin-documents-private").createSignedUrl(document.data.storage_path, 60);
  if (signed.error || !signed.data?.signedUrl) return json({ error: "No fue posible abrir el documento privado.", code: "SIGNED_URL_FAILED" }, 503);
  return json({ document: { id: document.data.id, mimeType: document.data.mime_type, originalName: document.data.original_name, rightsStatus: document.data.rights_status, visibility: document.data.visibility, attribution: document.data.attribution }, url: signed.data.signedUrl, expiresIn: 60 });
}

export async function POST(request: NextRequest) {
  if (!serverPhase2FeatureFlags().admin_v1) return json({ error: "Admin está desactivado." }, 404);
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_BYTES + 100_000) return json({ error: "El archivo excede 10 MB.", code: "INVALID_SIZE" }, 413);
  const account = await authenticatedRequest(request);
  if (!account.ok) return json({ error: account.error, code: account.code }, account.status);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "No fue posible leer el archivo.", code: "INVALID_FORM" }, 400);
  const file = form.get("file");
  const entityType = value(form, "entityType", 50) as AdminEntityType;
  const entityId = value(form, "entityId", 240);
  const scopeType = value(form, "scopeType", 30) as AdminScopeType;
  const scopeId = scopeType === "GLOBAL" ? null : value(form, "scopeId", 240);
  if (!(file instanceof File) || !(ADMIN_ENTITY_TYPES as readonly string[]).includes(entityType) || !(ADMIN_SCOPE_TYPES as readonly string[]).includes(scopeType) || !entityId) return json({ error: "Archivo, entidad o alcance inválido.", code: "INVALID_DOCUMENT" }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateAdminDocument(bytes, file.type, MAX_BYTES);
  if (!validation.ok) return json({ error: "El tipo real del archivo no coincide o no está permitido.", code: validation.code }, 400);
  const memberships = await account.client.from("admin_memberships").select("user_id,role,scope_type,scope_id,active").eq("user_id", account.userId).eq("active", true);
  if (memberships.error) return json({ error: "No fue posible validar la membresía.", code: "ADMIN_SCHEMA_PENDING" }, 503);
  const allowed = (memberships.data || []).some((row) => membershipAllows({ userId: row.user_id, role: row.role, scopeType: row.scope_type, scopeId: row.scope_id, active: row.active } as AdminMembership, { entityType, scopeType, scopeId }, "CREATE_DRAFT"));
  if (!allowed) return json({ error: "Tu rol o alcance no permite subir este documento.", code: "ADMIN_SCOPE_REQUIRED" }, 403);
  const source = value(form, "source"); const license = value(form, "license"); const rightsEvidence = value(form, "rightsEvidence", 5000); const attribution = value(form, "attribution"); const verifiedAt = value(form, "verifiedAt", 50);
  const approve = value(form, "rightsApproved", 10) === "true";
  if (approve && (!source || !license || !rightsEvidence || !verifiedAt || Number.isNaN(Date.parse(verifiedAt)))) return json({ error: "Aprobar derechos requiere fuente, licencia, evidencia y fecha verificadas.", code: "RIGHTS_EVIDENCE_REQUIRED" }, 400);
  const path = `${account.userId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const upload = await account.client.storage.from("admin-documents-private").upload(path, bytes, { contentType: validation.mimeType, upsert: false });
  if (upload.error) return json({ error: "No fue posible guardar el documento privado.", code: "DOCUMENT_UPLOAD_FAILED" }, 503);
  const inserted = await account.client.from("admin_documents").insert({ owner_entity_type: entityType, owner_entity_id: entityId, scope_type: scopeType, scope_id: scopeId, storage_path: path, mime_type: validation.mimeType, byte_size: bytes.byteLength, original_name: file.name.slice(0, 240), rights_status: approve ? "APPROVED" : "PENDING_RIGHTS", source: source || null, license: license || null, rights_evidence: rightsEvidence || null, attribution: attribution || null, visibility: approve ? "PLAYER" : "ADMIN", verified_at: approve ? new Date(verifiedAt).toISOString() : null, created_by: account.userId }).select("id,owner_entity_type,owner_entity_id,mime_type,byte_size,rights_status,visibility,created_at").single();
  if (inserted.error || !inserted.data) {
    await account.client.storage.from("admin-documents-private").remove([path]);
    return json({ error: "El documento no quedó asociado; el upload temporal fue retirado.", code: "DOCUMENT_RECORD_FAILED" }, 503);
  }
  if (["CLUB_EQUIPMENT", "BALL", "SHAFT"].includes(entityType)) {
    const linked = await account.client.from("equipment_catalog_images").insert({ equipment_type: entityType, equipment_id: entityId, document_id: inserted.data.id, status: approve ? "APPROVED" : "PENDING_RIGHTS" });
    if (linked.error) return json({ document: inserted.data, warning: "El documento quedó privado, pero no se vinculó al producto." }, 202);
  }
  return json({ document: inserted.data }, 201);
}
