import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("legal evidence migration is locally idempotent and its RLS contract passes", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create schema private;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table private.account_lifecycle_state (user_id uuid primary key, account_status text not null);
      create function private.account_data_access_allowed() returns boolean
      language sql stable security definer set search_path='' as $$
        select (select auth.uid()) is null or (
          exists(select 1 from auth.users where id=(select auth.uid()))
          and not exists(select 1 from private.account_lifecycle_state where user_id=(select auth.uid()))
        )
      $$;
      create table public.legal_documents (
        type text not null,
        version text not null,
        locale text not null default 'es-MX',
        effective_at timestamptz not null,
        document_path text,
        created_at timestamptz not null default now(),
        primary key (type, version, locale)
      );
    `);
    const migration = readFileSync("supabase/migrations/20260924220041_legal_evidence_events_canonical.sql", "utf8");
    const ingestMigration = readFileSync("supabase/migrations/20260924235930_legal_evidence_transactional_ingest.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(ingestMigration);
    await db.exec(ingestMigration);
    await db.exec(readFileSync("supabase/tests/legal_evidence_events_rls.sql", "utf8"));
    const result = await db.query<{ count: number }>("select count(*)::int as count from public.legal_documents where version in ('2026-09-08-v2', '2026-09-08-v6+sha256-c441091d44899e8b')");
    assert.equal(result.rows[0]?.count, 2);
  } finally { await db.close(); }
});

test("transactional legal evidence ingest is service-only, deduplicates semantics, preserves transitions and rolls back a rate-limited batch", async () => {
  const db = new PGlite();
  const userId = "50000000-0000-4000-8000-000000000001";
  const limitedUserId = "50000000-0000-4000-8000-000000000002";
  const acceptedId = "51000000-0000-4000-8000-000000000001";
  const duplicateId = "51000000-0000-4000-8000-000000000002";
  const revokedId = "51000000-0000-4000-8000-000000000003";
  const orderedAcceptedId = "51000000-0000-4000-8000-000000000004";
  const orderedRejectedId = "51000000-0000-4000-8000-000000000005";
  const orderedRevokedId = "51000000-0000-4000-8000-000000000006";
  const event = (idempotencyKey: string, action: "accepted" | "rejected" | "revoked", overrides: Record<string, unknown> = {}) => ({
    subject: "terms",
    action,
    documentKey: "terms",
    documentVersion: "test-v1",
    documentHash: "a".repeat(64),
    statementKey: `terms.${action}.test-v1`,
    statementText: `Synthetic ${action} decision`,
    statementHash: (action === "accepted" ? "b" : action === "rejected" ? "c" : "d").repeat(64),
    locale: "es-MX",
    origin: "onboarding",
    clientOccurredAt: "2026-09-24T12:00:00.000Z",
    idempotencyKey,
    ...overrides,
  });
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create schema private;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table private.account_lifecycle_state (user_id uuid primary key, account_status text not null);
      create function private.account_data_access_allowed() returns boolean
      language sql stable security definer set search_path='' as $$ select true $$;
      create table public.legal_documents (
        type text not null, version text not null, locale text not null default 'es-MX',
        effective_at timestamptz not null, document_path text, created_at timestamptz not null default now(),
        primary key (type, version, locale)
      );
    `);
    await db.exec(readFileSync("supabase/migrations/20260924220041_legal_evidence_events_canonical.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/20260924235930_legal_evidence_transactional_ingest.sql", "utf8"));
    await db.exec(`insert into auth.users (id) values ('${userId}'), ('${limitedUserId}')`);

    const invoke = async (owner: string, events: unknown[]) => {
      await db.exec("set role service_role");
      try {
        return await db.query<{
          requested_idempotency_key: string;
          canonical_idempotency_key: string;
          replayed: boolean;
          deduplicated: boolean;
          created: boolean;
        }>("select * from public.record_legal_evidence_batch($1::uuid, $2::text, $3::text, $4::jsonb)", [owner, "preview", "canonical-sha", JSON.stringify(events)]);
      } finally {
        await db.exec("reset role");
      }
    };

    const created = await invoke(userId, [event(acceptedId, "accepted")]);
    assert.deepEqual(created.rows.map((row) => [row.requested_idempotency_key, row.canonical_idempotency_key, row.replayed, row.deduplicated, row.created]), [
      [acceptedId, acceptedId, false, false, true],
    ]);
    const replayed = await invoke(userId, [event(acceptedId, "accepted")]);
    assert.equal(replayed.rows[0]?.replayed, true);
    const deduplicated = await invoke(userId, [event(duplicateId, "accepted", {
      origin: "existing_user_update",
      clientOccurredAt: "2026-09-24T12:05:00.000Z",
    })]);
    assert.equal(deduplicated.rows[0]?.deduplicated, true);
    assert.equal(deduplicated.rows[0]?.canonical_idempotency_key, acceptedId);
    const transitioned = await invoke(userId, [event(revokedId, "revoked", {
      origin: "account_privacy",
      clientOccurredAt: "2026-09-24T12:06:00.000Z",
    })]);
    assert.equal(transitioned.rows[0]?.created, true);
    const orderedTransitions = await invoke(userId, [
      event(orderedAcceptedId, "accepted"),
      event(orderedRejectedId, "rejected"),
      event(orderedRevokedId, "revoked"),
    ]);
    assert.equal(orderedTransitions.rows.every((row) => row.created), true);
    const ledger = await db.query<{ idempotency_key: string; action: string }>(`
      select idempotency_key::text, action
        from public.legal_evidence_events
       where user_id = '${userId}' and environment = 'preview'
       order by server_received_at, idempotency_key
    `);
    assert.deepEqual(ledger.rows.map((row) => [row.idempotency_key, row.action]), [
      [acceptedId, "accepted"],
      [revokedId, "revoked"],
      [orderedAcceptedId, "accepted"],
      [orderedRejectedId, "rejected"],
      [orderedRevokedId, "revoked"],
    ]);
    const monotonic = await db.query<{ ordered: boolean }>(`
      select bool_and(previous_received_at is null or server_received_at > previous_received_at) as ordered
        from (
          select server_received_at, lag(server_received_at) over (order by server_received_at, idempotency_key) as previous_received_at
            from public.legal_evidence_events
           where user_id = '${userId}' and environment = 'preview'
        ) as ordered_events
    `);
    assert.equal(monotonic.rows[0]?.ordered, true);

    await db.exec("set role authenticated");
    await assert.rejects(
      () => db.query("select * from public.record_legal_evidence_batch($1::uuid, 'preview', null, $2::jsonb)", [userId, JSON.stringify([event(duplicateId, "accepted")])]),
      /permission denied/i,
    );
    await db.exec("reset role");

    const security = await db.query<{ security_definer: boolean; service_allowed: boolean; authenticated_allowed: boolean; config: string[] | null }>(`
      select p.prosecdef as security_definer,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as service_allowed,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_allowed,
             p.proconfig as config
        from pg_proc p
       where p.oid = 'public.record_legal_evidence_batch(uuid,text,text,jsonb)'::regprocedure
    `);
    assert.equal(security.rows[0]?.security_definer, false);
    assert.equal(security.rows[0]?.service_allowed, true);
    assert.equal(security.rows[0]?.authenticated_allowed, false);
    assert.match(String(security.rows[0]?.config), /search_path/);

    await db.exec(`
      insert into public.legal_evidence_events (
        user_id, environment, document_key, purpose_key, document_version, document_hash,
        statement_key, statement_text, statement_hash, action, locale, origin,
        client_occurred_at, server_received_at, idempotency_key
      )
      select '${limitedUserId}', 'preview', 'terms', 'terms', 'test-v1', repeat('a', 64),
             'terms.' || case when n % 2 = 1 then 'accepted' else 'revoked' end || '.test-v1',
             'Synthetic rate row ' || n,
             repeat(case when n % 2 = 1 then 'b' else 'd' end, 64),
             case when n % 2 = 1 then 'accepted' else 'revoked' end,
             'es-MX', 'onboarding', clock_timestamp() - interval '2 minutes',
             clock_timestamp() - interval '1 minute' + n * interval '1 microsecond',
             gen_random_uuid()
        from generate_series(1, 39) as n;
    `);
    await assert.rejects(() => invoke(limitedUserId, [
      event("52000000-0000-4000-8000-000000000001", "revoked"),
      event("52000000-0000-4000-8000-000000000002", "accepted"),
    ]), /legal_evidence_rate_limited/);
    const afterRateLimit = await db.query<{ count: number }>(`select count(*)::int as count from public.legal_evidence_events where user_id = '${limitedUserId}'`);
    assert.equal(afterRateLimit.rows[0]?.count, 39);
  } finally {
    await db.exec("reset role").catch(() => undefined);
    await db.close();
  }
});
