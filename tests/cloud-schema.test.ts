import test from "node:test";
import assert from "node:assert/strict";
import { supportsExtendedCloudSchema } from "../lib/cloud-schema";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
};

function schema(extended: boolean) {
  const common = { updated_at: {} };
  return {
    definitions: {
      round_scores_cloud: { properties: extended ? { ...common, version: {}, updated_by_device: {} } : common },
      profiles: { properties: extended ? { ...common, version: {}, updated_by_device: {} } : common },
      account_data_migrations: { properties: extended ? { last_attempt_at: {}, last_error_code: {} } : {} },
    },
  };
}

test("detección de esquema usa OpenAPI autenticado y no consulta columnas inexistentes", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ input: String(input), init });
    return new Response(JSON.stringify(schema(true)), { status: 200 });
  }) as typeof fetch;
  assert.equal(await supportsExtendedCloudSchema("user-jwt", { env, fetcher, useCache: false }), true);
  assert.equal(requests[0].input, "https://example.supabase.co/rest/v1/");
  assert.equal(new Headers(requests[0].init?.headers).get("authorization"), "Bearer user-jwt");
  assert.doesNotMatch(requests[0].input, /version|round_scores_cloud/);
});

test("OpenAPI anterior activa fallback legacy sin producir un 400 esperado", async () => {
  const fetcher = (async () => new Response(JSON.stringify(schema(false)), { status: 200 })) as typeof fetch;
  assert.equal(await supportsExtendedCloudSchema("user-jwt", { env, fetcher, useCache: false }), false);
});

test("fallo real de inspección de esquema permanece visible y no se interpreta como legacy", async () => {
  const fetcher = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
  await assert.rejects(
    supportsExtendedCloudSchema("user-jwt", { env, fetcher, useCache: false }),
    (error: unknown) => error instanceof Error && (error as Error & { status?: number }).status === 503,
  );
});

