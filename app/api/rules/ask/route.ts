import "server-only";
import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { askRulesWithClient, publicRulesAiStatus, rulesAiConfig } from "../../../../lib/rules-ai";
import type { LocalRule } from "../../../../lib/types";

const windows = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 8;
const WINDOW_MS = 60_000;

function allowed(ip: string) {
  const now = Date.now();
  const current = windows.get(ip);
  if (!current || current.resetAt <= now) {
    windows.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= LIMIT) return false;
  current.count += 1;
  return true;
}

export async function POST(request: NextRequest) {
  const config = rulesAiConfig(process.env);
  if (!config.enabled) {
    return NextResponse.json({ error: "La consulta con IA no está activada." }, { status: 503 });
  }
  if (!config.hasApiKey || !config.hasVectorStore) {
    return NextResponse.json({ error: "Falta configurar el reglamento privado." }, { status: 503 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowed(ip)) return NextResponse.json({ error: "Demasiadas consultas. Intenta de nuevo en un minuto." }, { status: 429 });

  const body = await request.json().catch(() => null) as { question?: unknown; courseName?: unknown; localRules?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 1200) : "";
  if (question.length < 8) return NextResponse.json({ error: "Describe la situación con un poco más de detalle." }, { status: 400 });
  const courseName = typeof body?.courseName === "string" ? body.courseName.trim().slice(0, 120) : "";
  const localRules = Array.isArray(body?.localRules) ? body.localRules.slice(0, 30).filter((rule): rule is LocalRule => Boolean(rule && typeof rule === "object" && typeof rule.text === "string" && typeof rule.title === "string")) : undefined;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const answer = await askRulesWithClient({ client, env: process.env, question, courseName, localRules });
    return NextResponse.json({ answer });
  } catch {
    console.error("Rules AI request failed");
    return NextResponse.json({ error: "No fue posible consultar el reglamento en este momento." }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json(publicRulesAiStatus(process.env));
}
