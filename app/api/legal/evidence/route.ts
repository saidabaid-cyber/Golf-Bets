import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdmin } from "../../../../lib/supabase/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import {
  isLegalEvidenceAction,
  isLegalEvidenceSubject,
  legalEvidenceDefinition,
  type LegalEvidenceAction,
  type LegalEvidenceSubject,
} from "../../../../lib/legal-evidence";
import {
  BACKYARD_AI_PRIVATE_HEADERS,
  hasOnlyKeys,
  isCrossSiteRequest,
  isJsonRequest,
  readJsonBodyWithLimit,
} from "../../../../lib/backyard-ai/server/http-security";
import { resolveCanonicalDataEnvironment } from "../../../../lib/runtime-environment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ORIGINS = new Set(["access_notice", "onboarding", "existing_user_update", "financial_gate", "account_privacy"]);
const MAX_EVENTS = 20;
const MAX_RETURNED_EVENTS = 500;
const MAX_BODY_BYTES = 32_000;

type EvidenceInput = {
  subject: LegalEvidenceSubject;
  action: LegalEvidenceAction;
  documentKey: "terms" | "privacy_integral" | "privacy_simplified";
  documentVersion: string;
  documentHash: string;
  statementKey: string;
  statementText: string;
  statementHash: string;
  locale: "es-MX";
  origin: string;
  clientOccurredAt: string;
  idempotencyKey: string;
};

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: BACKYARD_AI_PRIVATE_HEADERS });

async function bounded<T>(operation: PromiseLike<T>, timeoutMs = 8_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("legal_evidence_timeout")), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

function parseInput(value: unknown): EvidenceInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!hasOnlyKeys(input, ["subject", "action", "documentKey", "documentVersion", "documentHash", "statementKey", "statementText", "statementHash", "locale", "origin", "clientOccurredAt", "idempotencyKey"])) return null;
  if (!isLegalEvidenceSubject(input.subject) || !isLegalEvidenceAction(input.action)) return null;
  if (typeof input.origin !== "string" || !ORIGINS.has(input.origin)) return null;
  if (typeof input.clientOccurredAt !== "string" || input.clientOccurredAt.length > 64 || !Number.isFinite(Date.parse(input.clientOccurredAt))) return null;
  if (typeof input.idempotencyKey !== "string" || !UUID.test(input.idempotencyKey)) return null;
  const definition = legalEvidenceDefinition(input.subject, input.action);
  if (!definition
    || input.documentKey !== definition.documentKey
    || input.documentVersion !== definition.version
    || input.documentHash !== definition.documentHash
    || input.statementKey !== `${input.subject}.${input.action}.${definition.version}`
    || input.statementText !== definition.statement
    || input.statementHash !== definition.statementHash
    || input.locale !== "es-MX") return null;
  return input as EvidenceInput;
}

function databaseUnavailable(code: string | undefined) {
  return code === "42P01" || code === "42703" || code === "42883" || code === "42501";
}

type IngestReceipt = {
  requested_idempotency_key: string;
  canonical_idempotency_key: string;
  server_received_at: string;
  replayed: boolean;
  deduplicated: boolean;
  created: boolean;
};

function validIngestReceipt(value: unknown): value is IngestReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<IngestReceipt>;
  return typeof receipt.requested_idempotency_key === "string"
    && UUID.test(receipt.requested_idempotency_key)
    && typeof receipt.canonical_idempotency_key === "string"
    && UUID.test(receipt.canonical_idempotency_key)
    && typeof receipt.server_received_at === "string"
    && ISO_TIMESTAMP.test(receipt.server_received_at)
    && Number.isFinite(Date.parse(receipt.server_received_at))
    && typeof receipt.replayed === "boolean"
    && typeof receipt.deduplicated === "boolean"
    && typeof receipt.created === "boolean"
    && Number(receipt.replayed) + Number(receipt.deduplicated) + Number(receipt.created) === 1;
}

export async function GET(request: NextRequest) {
  try {
    const account = await bounded(authenticatedRequest(request));
    if (!account.ok) return json({ error: account.error }, account.status);
    const currentEnvironment = resolveCanonicalDataEnvironment();
    const search = new URL(request.url).searchParams;
    const beforeReceivedAt = search.get("beforeReceivedAt");
    const beforeId = search.get("beforeId");
    if (Boolean(beforeReceivedAt) !== Boolean(beforeId)
      || (beforeReceivedAt && (!ISO_TIMESTAMP.test(beforeReceivedAt) || !Number.isFinite(Date.parse(beforeReceivedAt))))
      || (beforeId && !UUID.test(beforeId))) return json({ error: "Cursor inválido." }, 400);
    const query = account.client
      .from("legal_evidence_events")
      .select("environment,document_key,purpose_key,document_version,document_hash,statement_key,statement_text,statement_hash,action,locale,origin,client_occurred_at,server_received_at,idempotency_key")
      .eq("user_id", account.userId)
      .eq("environment", currentEnvironment)
      .order("server_received_at", { ascending: false })
      .order("idempotency_key", { ascending: false })
      .limit(MAX_RETURNED_EVENTS + 1);
    const result = await bounded(beforeReceivedAt && beforeId
      ? query.or(`server_received_at.lt.${beforeReceivedAt},and(server_received_at.eq.${beforeReceivedAt},idempotency_key.lt.${beforeId})`)
      : query);
    if (result.error) return json({ error: databaseUnavailable(result.error.code) ? "La evidencia legal aún no está habilitada en Preview." : "No pudimos consultar tus elecciones legales." }, databaseUnavailable(result.error.code) ? 503 : 500);
    const descending = result.data || [];
    const truncated = descending.length > MAX_RETURNED_EVENTS;
    const page = descending.slice(0, MAX_RETURNED_EVENTS);
    const oldest = page.at(-1);
    return json({
      environment: currentEnvironment,
      truncated,
      nextCursor: truncated && oldest ? { beforeReceivedAt: oldest.server_received_at, beforeId: oldest.idempotency_key } : null,
      events: page.reverse(),
    });
  } catch { return json({ error: "No pudimos consultar tus elecciones legales. Reintenta." }, 503); }
}

export async function POST(request: NextRequest) {
  if (isCrossSiteRequest(request)) return json({ error: "Solicitud no permitida." }, 403);
  if (!isJsonRequest(request)) return json({ error: "La solicitud debe usar JSON." }, 415);
  try {
    const account = await bounded(authenticatedRequest(request));
    if (!account.ok) return json({ error: account.error }, account.status);
    const read = await bounded(readJsonBodyWithLimit(request, MAX_BODY_BYTES), 2_000);
    if (!read.ok) return json({ error: read.reason === "too_large" ? "La solicitud es demasiado grande." : "Solicitud inválida." }, read.reason === "too_large" ? 413 : 400);
    if (!read.value || typeof read.value !== "object" || Array.isArray(read.value)) return json({ error: "Solicitud inválida." }, 400);
    const root = read.value as Record<string, unknown>;
    if (!hasOnlyKeys(root, ["events"]) || !Array.isArray(root.events) || root.events.length < 1 || root.events.length > MAX_EVENTS) {
      return json({ error: `Se requieren entre 1 y ${MAX_EVENTS} eventos válidos.` }, 400);
    }
    const inputs = root.events.map(parseInput);
    if (inputs.some((input) => !input)) return json({ error: "La elección legal no es válida." }, 400);
    const ids = (inputs as EvidenceInput[]).map((input) => input.idempotencyKey.toLocaleLowerCase("en-US"));
    if (new Set(ids).size !== ids.length) return json({ error: "La solicitud repite una clave idempotente." }, 400);

    const admin = getSupabaseAdmin();
    if (!admin) return json({ error: "La evidencia legal no está configurada en el servidor." }, 503);
    const currentEnvironment = resolveCanonicalDataEnvironment();
    const ingested = await bounded(admin.rpc("record_legal_evidence_batch", {
      p_user_id: account.userId,
      p_environment: currentEnvironment,
      p_deployment_ref: process.env.VERCEL_GIT_COMMIT_SHA || null,
      p_events: inputs,
    }));
    if (ingested.error) {
      if (ingested.error.message === "legal_evidence_idempotency_conflict") {
        return json({ error: "La clave idempotente ya corresponde a otra manifestación." }, 409);
      }
      if (ingested.error.message === "legal_evidence_rate_limited") {
        return json({ error: "Demasiadas elecciones legales en poco tiempo. Reintenta más tarde." }, 429);
      }
      return json({ error: databaseUnavailable(ingested.error.code) ? "La evidencia legal aún no está habilitada en Preview." : "No pudimos guardar tu elección legal." }, databaseUnavailable(ingested.error.code) ? 503 : 500);
    }
    if (!Array.isArray(ingested.data)
      || ingested.data.length !== inputs.length
      || ingested.data.some((receipt) => !validIngestReceipt(receipt))) {
      return json({ error: "No pudimos confirmar la recepción de tus elecciones legales." }, 500);
    }
    const rpcReceipts = ingested.data as IngestReceipt[];
    const requestedIds = new Set(rpcReceipts.map((receipt) => receipt.requested_idempotency_key.toLowerCase()));
    if (requestedIds.size !== ids.length || ids.some((id) => !requestedIds.has(id))) {
      return json({ error: "No pudimos confirmar la recepción de tus elecciones legales." }, 500);
    }
    const createdCount = rpcReceipts.filter((receipt) => receipt.created).length;
    const receipts = rpcReceipts.map((receipt) => ({
      idempotencyKey: receipt.requested_idempotency_key,
      canonicalIdempotencyKey: receipt.canonical_idempotency_key,
      serverReceivedAt: receipt.server_received_at,
      replayed: receipt.replayed,
      deduplicated: receipt.deduplicated,
    }));
    return json({ ok: true, environment: currentEnvironment, createdCount, receipts }, createdCount > 0 ? 201 : 200);
  } catch { return json({ error: "No pudimos guardar tu elección legal. Reintenta." }, 503); }
}
