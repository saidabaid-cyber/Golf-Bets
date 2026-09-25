import { runtimeIdentity } from "../../../lib/server-runtime";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

export function GET() {
  const runtime = runtimeIdentity();

  return Response.json(
    {
      status: "ok",
      service: "the-backyard",
      version: runtime.appVersion,
      buildSha: runtime.buildSha,
      environment: runtime.environment,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
