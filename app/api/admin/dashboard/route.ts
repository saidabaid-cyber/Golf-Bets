import { NextRequest, NextResponse } from "next/server";
import { readAdminDataset } from "../../../../lib/admin-data";
import { isNextResponse, migrationFailure, requireAdmin } from "../../../../lib/server-runtime";

export async function GET(request: NextRequest) {
  const context = await requireAdmin(request); if (isNextResponse(context)) return context;
  try { return NextResponse.json(await readAdminDataset(context.admin), { headers: { "cache-control": "private, no-store" } }); }
  catch (error) { return NextResponse.json({ error: migrationFailure(error) }, { status: 503 }); }
}
