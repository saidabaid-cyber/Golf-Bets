import { legalEvidenceDefinition, type LegalEvidenceAction, type LegalEvidenceSubject } from "../../../../lib/legal-documents";
import { getSupabaseLegalAdmin, getSupabaseLegalForUser } from "../../../../lib/supabase/server";

const NO_STORE = { "cache-control": "private, no-store" };
const SUBJECTS = new Set<LegalEvidenceSubject>(["privacy_notice", "terms", "age_declaration", "financial_data", "marketing"]);
const ACTIONS = new Set<LegalEvidenceAction>(["presented", "accepted", "rejected", "revoked"]);
const ORIGINS = new Set(["access_notice", "onboarding", "existing_user_update", "financial_gate", "account_privacy"]);

type EvidenceInput = {
  subject: LegalEvidenceSubject;
  action: LegalEvidenceAction;
  origin: string;
  clientOccurredAt: string;
  idempotencyKey: string;
};

function environment() {
  const explicit = process.env.BACKYARD_LEGAL_ENVIRONMENT;
  if (explicit === "production" || explicit === "preview" || explicit === "development" || explicit === "test") return explicit;
  if (process.env.VERCEL_ENV === "production") return "production" as const;
  if (process.env.VERCEL_ENV === "preview") return "preview" as const;
  if (process.env.NODE_ENV === "test") return "test" as const;
  return "development" as const;
}

function bearer(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function parseInput(value: unknown): EvidenceInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<EvidenceInput> & Record<string, unknown>;
  if (Object.keys(input).some((key) => !["subject", "action", "origin", "clientOccurredAt", "idempotencyKey"].includes(key))) return null;
  if (!SUBJECTS.has(input.subject as LegalEvidenceSubject) || !ACTIONS.has(input.action as LegalEvidenceAction)) return null;
  if (typeof input.origin !== "string" || !ORIGINS.has(input.origin)) return null;
  if (typeof input.clientOccurredAt !== "string" || !Number.isFinite(Date.parse(input.clientOccurredAt))) return null;
  if (typeof input.idempotencyKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) return null;
  if (!legalEvidenceDefinition(input.subject as LegalEvidenceSubject, input.action as LegalEvidenceAction)) return null;
  return input as EvidenceInput;
}

async function authenticatedUser(request: Request) {
  const token = bearer(request);
  if (!token) return { error: Response.json({ error: "Sesión requerida." }, { status: 401, headers: NO_STORE }) };
  const client = getSupabaseLegalForUser(token);
  if (!client) return { error: Response.json({ error: "La evidencia legal no está configurada en el servidor." }, { status: 503, headers: NO_STORE }) };
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { error: Response.json({ error: "Sesión no válida." }, { status: 401, headers: NO_STORE }) };
  return { user: data.user, client };
}

export async function GET(request: Request) {
  const auth = await authenticatedUser(request);
  if ("error" in auth) return auth.error;
  const currentEnvironment = environment();
  const result = await auth.client
    .from("legal_evidence_events")
    .select("environment,document_key,purpose_key,document_version,document_hash,statement_key,statement_text,statement_hash,action,locale,origin,client_occurred_at,server_received_at,idempotency_key")
    .eq("user_id", auth.user.id)
    .eq("environment", currentEnvironment)
    .order("server_received_at", { ascending: true });
  if (result.error) return Response.json({ error: "No pudimos consultar tus elecciones legales." }, { status: result.error.code === "42P01" ? 503 : 500, headers: NO_STORE });
  return Response.json({ environment: currentEnvironment, events: result.data || [] }, { headers: NO_STORE });
}

export async function POST(request: Request) {
  const auth = await authenticatedUser(request);
  if ("error" in auth) return auth.error;
  const admin = getSupabaseLegalAdmin();
  if (!admin) return Response.json({ error: "La evidencia legal no está configurada en el servidor." }, { status: 503, headers: NO_STORE });
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return Response.json({ error: "Solicitud inválida." }, { status: 400, headers: NO_STORE }); }
  const rawEvents = raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown }).events) ? (raw as { events: unknown[] }).events : [];
  if (!rawEvents.length || rawEvents.length > 20) return Response.json({ error: "Se requieren entre 1 y 20 eventos válidos." }, { status: 400, headers: NO_STORE });
  const inputs = rawEvents.map(parseInput);
  if (inputs.some((input) => !input)) return Response.json({ error: "La elección legal no es válida." }, { status: 400, headers: NO_STORE });

  const currentEnvironment = environment();
  const receipts: Array<{ idempotencyKey: string; serverReceivedAt: string }> = [];
  for (const input of inputs as EvidenceInput[]) {
    const definition = legalEvidenceDefinition(input.subject, input.action)!;
    const row = {
      user_id: auth.user.id,
      environment: currentEnvironment,
      deployment_ref: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_URL || null,
      document_key: definition.documentKey,
      purpose_key: input.subject,
      document_version: definition.version,
      document_hash: definition.documentHash,
      statement_key: `${input.subject}.${input.action}.${definition.version}`,
      statement_text: definition.statement,
      statement_hash: definition.statementHash,
      action: input.action,
      locale: "es-MX",
      origin: input.origin,
      client_occurred_at: input.clientOccurredAt,
      idempotency_key: input.idempotencyKey,
    };
    const inserted = await admin.from("legal_evidence_events").insert(row).select("server_received_at,idempotency_key").single();
    if (!inserted.error && inserted.data) {
      receipts.push({ idempotencyKey: inserted.data.idempotency_key, serverReceivedAt: inserted.data.server_received_at });
      continue;
    }
    if (inserted.error?.code !== "23505") {
      const unavailable = inserted.error?.code === "42P01";
      return Response.json({ error: unavailable ? "La evidencia legal aún no está habilitada en el servidor." : "No pudimos guardar tu elección legal." }, { status: unavailable ? 503 : 500, headers: NO_STORE });
    }
    const prior = await admin.from("legal_evidence_events")
      .select("purpose_key,action,origin,client_occurred_at,document_version,document_hash,statement_hash,server_received_at,idempotency_key")
      .eq("user_id", auth.user.id)
      .eq("environment", currentEnvironment)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    const priorData = prior.data;
    const exact = priorData
      && priorData.purpose_key === input.subject
      && priorData.action === input.action
      && priorData.origin === input.origin
      && Date.parse(priorData.client_occurred_at) === Date.parse(input.clientOccurredAt)
      && priorData.document_version === definition.version
      && priorData.document_hash === definition.documentHash
      && priorData.statement_hash === definition.statementHash;
    if (prior.error || !priorData || !exact) return Response.json({ error: "La clave idempotente ya corresponde a otra manifestación." }, { status: 409, headers: NO_STORE });
    receipts.push({ idempotencyKey: priorData.idempotency_key, serverReceivedAt: priorData.server_received_at });
  }
  return Response.json({ ok: true, environment: currentEnvironment, receipts }, { status: 201, headers: NO_STORE });
}
