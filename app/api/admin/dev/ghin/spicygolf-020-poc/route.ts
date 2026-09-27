import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { readGhinServerCredentials } from "../../../../../../lib/ghin/credentials.server";
import { runSpicyGhin020ReadOnlyPoc } from "../../../../../../lib/ghin/spicygolf-020-poc.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
} as const;
const EXPECTED_OPERATION = "run_spicygolf_020_read_only";
const MAX_BODY_BYTES = 256;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function allowedDeployment() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VERCEL_GIT_COMMIT_REF === "integration/backyard-current";
}

function authorized(request: NextRequest) {
  const expected = process.env.GHIN_QA_PROBE_SECRET;
  const header = request.headers.get("authorization");
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: NextRequest) {
  if (!allowedDeployment()) return json({ error: "Not found." }, 404);
  if (!authorized(request)) return json({ error: "Unauthorized." }, 401);

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) {
    return json({ error: "Invalid request." }, 400);
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return json({ error: "Invalid request." }, 400);
    }
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const input = body !== null && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  if (!input || Object.keys(input).length !== 1 || input.operation !== EXPECTED_OPERATION) {
    return json({ error: "Invalid request." }, 400);
  }

  const credentials = readGhinServerCredentials(process.env);
  if (!credentials) {
    return json({ error: "GHIN credentials are not configured for this Preview." }, 503);
  }

  try {
    return json(await runSpicyGhin020ReadOnlyPoc(credentials));
  } catch {
    return json({ error: "The read-only GHIN probe could not be completed." }, 502);
  }
}
