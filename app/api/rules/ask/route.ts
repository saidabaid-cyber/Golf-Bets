import "server-only";
import { createHmac } from "node:crypto";
import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { askRulesWithClient, classifyRulesAiFailure, publicRulesAiStatus, rulesAiConfig } from "../../../../lib/rules-ai";
import { consumePersistentRulesAiLimit } from "../../../../lib/rules-ai-rate-limit";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";
import type { LocalRule } from "../../../../lib/types";

const LIMIT = 8;
const WINDOW_SECONDS = 60;

export async function POST(request: NextRequest) {
  const config = rulesAiConfig(process.env);
  if (!config.enabled) {
    return NextResponse.json({ error: "La consulta con IA no está activada.", code: "disabled" }, { status: 503 });
  }
  if (!config.hasApiKey || !config.hasVectorStore) {
    return NextResponse.json({ error: "Falta configurar el reglamento privado.", code: "missing_config" }, { status: 503 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limiter = getSupabaseAdmin("cloud");
  if (!limiter) return NextResponse.json({ error: "El control de uso de la IA necesita configuración del servidor.", code: "rate_limit_config" }, { status: 503 });
  try {
    const keyHash = createHmac("sha256", process.env.OPENAI_API_KEY!).update(ip).digest("hex");
    const allowed = await consumePersistentRulesAiLimit(limiter, keyHash, LIMIT, WINDOW_SECONDS);
    if (!allowed) return NextResponse.json({ error: "Demasiadas consultas. Intenta de nuevo en un minuto.", code: "rate_limit" }, { status: 429 });
  } catch {
    return NextResponse.json({ error: "No pudimos validar el límite de consultas. Intenta nuevamente.", code: "rate_limit_unavailable" }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { question?: unknown; courseName?: unknown; localRules?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 1200) : "";
  if (question.length < 8) return NextResponse.json({ error: "Describe la situación con un poco más de detalle." }, { status: 400 });
  const courseName = typeof body?.courseName === "string" ? body.courseName.trim().slice(0, 120) : "";
  const localRules = Array.isArray(body?.localRules) ? body.localRules.slice(0, 30).filter((rule): rule is LocalRule => Boolean(rule && typeof rule === "object" && typeof rule.text === "string" && typeof rule.title === "string")) : undefined;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 });
  try {
    const answer = await askRulesWithClient({ client, env: process.env, question, courseName, localRules });
    return NextResponse.json({ answer });
  } catch (error) {
    const failure = classifyRulesAiFailure(error);
    console.error("Rules AI request failed", { code: failure.code, status: failure.status });
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}

export async function GET() {
  return NextResponse.json(publicRulesAiStatus(process.env));
}
