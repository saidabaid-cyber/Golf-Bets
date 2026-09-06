import { NextRequest, NextResponse } from "next/server";
import { adminExport, readAdminDataset } from "../../../../../lib/admin-data";
import { isNextResponse, migrationFailure, requireAdmin } from "../../../../../lib/server-runtime";

export async function GET(request: NextRequest, context: { params: Promise<{ dataset: string }> }) {
  const access = await requireAdmin(request); if (isNextResponse(access)) return access;
  const { dataset } = await context.params;
  if (!new Set(["users", "rounds", "analytics", "errors"]).has(dataset)) return NextResponse.json({ error: "Exportación desconocida." }, { status: 404 });
  try {
    const csv = adminExport(await readAdminDataset(access.admin), dataset);
    return new NextResponse(`\ufeff${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename=backyard-${dataset}.csv`, "cache-control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: migrationFailure(error) }, { status: 503 }); }
}
