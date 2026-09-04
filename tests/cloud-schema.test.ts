import test from "node:test";
import assert from "node:assert/strict";
import { supportsExtendedCloudSchema } from "../lib/cloud-schema";

function client(row: Record<string, unknown> | null, error: unknown = null) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(`from:${table}`);
      return {
        select(columns: string) {
          calls.push(`select:${columns}`);
          return {
            eq(column: string, value: string) {
              calls.push(`eq:${column}:${value}`);
              return { maybeSingle: async () => ({ data: row, error }) };
            },
          };
        },
      };
    },
  };
}

test("sincronización detecta el esquema extendido con una lectura RLS del perfil", async () => {
  const database = client({ id: "user-1", updated_at: "2026-09-04", version: 1, updated_by_device: null });
  assert.equal(await supportsExtendedCloudSchema(database as never, "user-1", { useCache: false }), true);
  assert.deepEqual(database.calls, ["from:profiles", "select:*", "eq:id:user-1"]);
});

test("esquema anterior activa fallback legacy sin pedir una columna inexistente", async () => {
  const database = client({ id: "user-1", updated_at: "2026-09-04" });
  assert.equal(await supportsExtendedCloudSchema(database as never, "user-1", { useCache: false }), false);
  assert.deepEqual(database.calls, ["from:profiles", "select:*", "eq:id:user-1"]);
});

test("Auth 200 no depende del OpenAPI /rest/v1 aunque ese endpoint devolvería 401", async () => {
  const originalFetch = globalThis.fetch;
  let openApiRequests = 0;
  globalThis.fetch = (async () => {
    openApiRequests += 1;
    return new Response("unauthorized", { status: 401 });
  }) as typeof fetch;
  try {
    const database = client({ id: "user-1", updated_at: "2026-09-04", version: 2, updated_by_device: "iphone" });
    assert.equal(await supportsExtendedCloudSchema(database as never, "user-1", { useCache: false }), true);
    assert.equal(openApiRequests, 0, "la detección nunca debe consultar el documento OpenAPI");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("un error RLS/PostgREST real permanece tipado en vez de parecer sesión inválida", async () => {
  const failure = { code: "42501", message: "permission denied for table profiles", status: 403 };
  const database = client(null, failure);
  await assert.rejects(
    supportsExtendedCloudSchema(database as never, "user-1", { useCache: false }),
    (error: unknown) => error === failure,
  );
});
