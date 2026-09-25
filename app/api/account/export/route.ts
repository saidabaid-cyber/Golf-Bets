import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { ACCOUNT_DATA_EXPORT_LIMIT, buildLimitedAccountExport } from "../../../../lib/account-data-export";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { BACKYARD_AI_PRIVATE_HEADERS } from "../../../../lib/backyard-ai/server/http-security";
import { resolveCanonicalDataEnvironment } from "../../../../lib/runtime-environment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

async function bounded<T>(operation: PromiseLike<T>, timeoutMs = 9_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("account_export_timeout")), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

const unavailable = { available: false, data: null } as const;

export async function GET(request: NextRequest) {
  try {
    const account = await bounded(authenticatedRequest(request));
    if (!account.ok) return NextResponse.json({ error: account.error }, { status: account.status, headers: BACKYARD_AI_PRIVATE_HEADERS });
    const currentEnvironment = resolveCanonicalDataEnvironment();
    const maximum = ACCOUNT_DATA_EXPORT_LIMIT + 1;
    const [profile, preferences, legalAcceptances, legalEvidence, aiProcessingConsents] = await bounded(Promise.all([
      account.client.from("profiles")
        .select("display_name,given_name,family_name,username,avatar_url,default_handicap,home_club,preferred_tee,handedness,bio,profile_visibility,city,state,country,onboarding_completed_at,created_at,updated_at")
        .eq("id", account.userId).maybeSingle(),
      account.client.from("user_preferences")
        .select("high_contrast,locale,default_handicap,notifications_enabled,created_at,updated_at")
        .eq("user_id", account.userId).maybeSingle(),
      account.client.from("legal_acceptances")
        .select("type,version,accepted_at,locale,created_at")
        .eq("user_id", account.userId).order("accepted_at", { ascending: true }).limit(maximum),
      account.client.from("legal_evidence_events")
        .select("environment,document_key,purpose_key,document_version,document_hash,statement_key,statement_text,statement_hash,action,locale,origin,client_occurred_at,server_received_at,idempotency_key")
        .eq("user_id", account.userId).eq("environment", currentEnvironment).order("server_received_at", { ascending: true }).limit(maximum),
      account.client.from("ai_processing_consents")
        .select("scope,policy_version,decision_status,source,decided_at,accepted_at,revoked_at,locale,created_at,updated_at")
        .eq("user_id", account.userId).order("id", { ascending: true }).limit(maximum),
    ]));
    const source = (result: { data: unknown; error: unknown }) => result.error ? unavailable : { available: true, data: result.data };
    const payload = buildLimitedAccountExport({
      userId: account.userId,
      environment: currentEnvironment,
      profile: source(profile),
      preferences: source(preferences),
      legalAcceptances: source(legalAcceptances),
      legalEvidence: source(legalEvidence),
      aiProcessingConsents: source(aiProcessingConsents),
    });
    const day = payload.generatedAt.slice(0, 10);
    return NextResponse.json(payload, {
      headers: {
        ...BACKYARD_AI_PRIVATE_HEADERS,
        "content-disposition": `attachment; filename="the-backyard-datos-limitados-${day}.json"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "No pudimos preparar la copia limitada. Reintenta." }, { status: 503, headers: BACKYARD_AI_PRIVATE_HEADERS });
  }
}
