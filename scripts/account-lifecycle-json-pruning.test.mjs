import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Real PostgreSQL/WASM, synthetic documents only. No network or credentials.
const original = readFileSync("supabase/migrations/20260927045252_account_delete_round_player_tombstones.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261003035013_account_lifecycle_skip_unrelated_json_branches.sql", "utf8");
const target = "abcdef12-3456-4789-abcd-abcdef123456";
const other = "22222222-2222-4222-8222-222222222222";
const namespace = "round:qa-json-pruning";
function definition(name) {
  const start = original.indexOf(`create or replace function private.${name}(`);
  const end = original.indexOf("$$;", original.indexOf("as $$", start)) + 3;
  assert.ok(start >= 0 && end > start, name);
  return original.slice(start, end);
}
const previous = definition("account_scrub_json_uuid");
const db = new PGlite();
const query = (sql, values) => db.query(sql, values);
async function value(sql, values) { return Object.values((await query(sql, values)).rows[0])[0]; }

test("account lifecycle JSON pruning preserves the deployed deletion contract", async (t) => {
  try {
    await db.exec(`create schema private; create schema extensions;
      create role anon; create role authenticated;
      -- PGlite has no pgcrypto; only this deterministic digest fixture differs
      -- from production. This test compares redaction, not cryptography.
      create function extensions.digest(bytea,text) returns bytea language sql immutable
        as $$ select decode(md5(encode($1,'hex'))||md5('x'||encode($1,'hex')),'hex') $$;`);
    for (const name of ["account_deleted_identity_token", "account_replace_deleted_identity_text",
      "account_scrub_marked_deleted_json", "anonymize_account_json", "account_scrub_json_uuid", "account_anonymize_json_document"]) {
      await db.exec(definition(name));
    }
    await db.exec(previous.replaceAll("private.account_scrub_json_uuid", "private.account_scrub_json_uuid_baseline"));
    await db.exec(definition("account_anonymize_json_document")
      .replaceAll("private.account_anonymize_json_document", "private.account_anonymize_json_document_baseline")
      .replaceAll("private.account_scrub_json_uuid", "private.account_scrub_json_uuid_baseline"));
    await db.exec(migration);
    const token = await value("select private.account_deleted_identity_token($1,$2)", [namespace, target]);
    const compare = async (document) => {
      const params = [JSON.stringify(document), target, namespace];
      const result = (await query(`select
        private.account_scrub_json_uuid_baseline($1::jsonb,$2,$3) as before,
        private.account_scrub_json_uuid($1::jsonb,$2,$3) as after,
        private.account_anonymize_json_document_baseline($1::jsonb,$2,$3) as document_before,
        private.account_anonymize_json_document($1::jsonb,$2,$3) as document_after`, params)).rows[0];
      assert.deepEqual(result.after, result.before);
      assert.deepEqual(result.document_after, result.document_before);
      return result;
    };

    await t.test("unrelated values, object keys, Unicode and arrays remain byte-equivalent as JSONB", async () => {
      for (const document of [null, true, false, 0, 72.4, "", "Golf · México", [], {},
        { name: "QA Course", holes: [{ par: 4, yardage: 410 }], nullable: null, numeric: 1 },
        { [`different-${other}`]: { id: other, name: "Other player", avatarUrl: "other-avatar" } }]) {
        const result = await compare(document);
        assert.deepEqual(result.after, document);
      }
      assert.equal(await value("select private.account_scrub_json_uuid(null,$1,$2)", [target, namespace]), null);
    });
    await t.test("raw/uppercase UUIDs, composite keys and tombstones retain score allocation and collision protection", async () => {
      for (const id of [target, target.toUpperCase(), token, token.toUpperCase()]) {
        const playerKey = `qa-player-${id}`;
        const result = await compare({ players: [{ id: playerKey, name: "QA private name", avatarUrl: "qa-avatar" }],
          scores: { 1: { [playerKey]: 4, [other]: 5 } }, putts: { 1: { [playerKey]: 2 } } });
        assert.equal(result.after.players[0].name, "Jugador eliminado");
        assert.equal(result.after.players[0].avatarUrl, null);
        assert.equal(result.after.scores[1][`qa-player-${token}`], 4);
        assert.equal(result.after.scores[1][other], 5);
      }
      for (const name of ["account_scrub_json_uuid_baseline", "account_scrub_json_uuid"]) {
        await assert.rejects(query(`select private.${name}($1::jsonb,$2,$3)`,
          [JSON.stringify({ [target]: 4, [token]: 5 }), target, namespace]), { code: "23505" });
      }
    });
    await t.test("ownership/provenance and marker-only redaction are unchanged", async () => {
      const result = await compare({
        course: { id: "qa-course", name: "QA Course", createdBy: target, rating: 72.4 },
        player: { id: "local-player", accountUserId: target.toUpperCase(), name: "QA private name", email: "qa@example.invalid" },
        owner: { ownerId: target, ownerName: "QA owner", ownerAvatar: "qa-avatar" },
        marked: { identityDeleted: true, id: "old-local-player", name: "QA legacy name", avatarUrl: "qa-avatar", updatedBy: other },
      });
      assert.equal(result.document_after.course.name, "QA Course");
      assert.equal(result.document_after.course.createdBy, null);
      assert.equal(result.document_after.course.rating, 72.4);
      assert.equal(result.document_after.marked.name, "Jugador eliminado");
      assert.equal(result.document_after.marked.avatarUrl, null);
      assert.equal(result.document_after.marked.updatedBy, other);
      assert.equal(result.document_after.owner.ownerName, "Jugador eliminado");
    });
    await t.test("nested generated documents match the old function and remain idempotent", async () => {
      for (let index = 0; index < 50; index++) {
        const document = { metadata: { [index % 2 ? `actor:${target.toUpperCase()}` : "unrelated"]: index },
          items: [{ profileId: index % 3 ? other : target, name: "QA player", count: index },
            { plain: { text: "no identity", value: index, list: [false, null, { par: 4 }] } },
            { embedded: `prefix-${index % 2 ? target : token.toUpperCase()}-suffix` }],
          scores: { 1: { [`account:${target}`]: 4, [`account:${other}`]: 5 } } };
        const { after } = await compare(document);
        assert.deepEqual(await value("select private.account_scrub_json_uuid($1::jsonb,$2,$3)",
          [JSON.stringify(after), target, namespace]), after);
      }
    });
    await t.test("same signature/security and no automatic data mutation on installation", async () => {
      const definitionRow = (await query(`select p.provolatile,p.proisstrict,p.prosecdef,p.proconfig,
        has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
        has_function_privilege('authenticated',p.oid,'EXECUTE') as player_execute
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='private' and p.proname='account_scrub_json_uuid'`)).rows[0];
      assert.deepEqual(definitionRow, { provolatile: "i", proisstrict: true, prosecdef: false,
        proconfig: ['search_path=""'], anon_execute: false, player_execute: false });
      assert.doesNotMatch(migration, /\b(?:update|delete\s+from|insert\s+into|alter\s+role|create\s+trigger)\b/i);
    });
    await t.test("74 synthetic historical round snapshots produce equal output with measured pruning", async () => {
      const course = { id: "qa-course", name: "QA test course", holes: Array.from({ length: 18 }, (_, i) => ({
        hole: i + 1, par: 4, strokeIndex: i + 1, yardages: { black: 440, blue: 410, white: 380, red: 330 },
      })) };
      const document = { ownerId: other, players: [{ id: `account:${target}`, name: "QA private", avatarUrl: "qa-avatar" }],
        course, courses: Array.from({ length: 11 }, (_, i) => ({ ...course, id: `qa-course-${i}` })),
        scores: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, { [`account:${target}`]: 4, [other]: 5 }])),
        putts: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, { [`account:${target}`]: 2 }])),
      };
      const payload = JSON.stringify(document);
      const timings = {};
      for (const [label, name] of [["before", "account_scrub_json_uuid_baseline"], ["after", "account_scrub_json_uuid"]]) {
        const start = performance.now();
        const rows = await query(`select private.${name}($1::jsonb,$2,$3 || ':' || i) as snapshot
          from generate_series(1,74) i`, [payload, target, namespace]);
        timings[label] = performance.now() - start;
        if (label === "before") timings.baseline = rows.rows;
        else assert.deepEqual(rows.rows, timings.baseline);
      }
      console.log(JSON.stringify({ benchmark: "74 synthetic snapshots / PostgreSQL WASM", payloadBytes: Buffer.byteLength(payload),
        beforeMs: Math.round(timings.before), afterMs: Math.round(timings.after),
        speedup: Number((timings.before / timings.after).toFixed(2)), remoteTimingGuarantee: false }));
    });
  } finally { await db.close(); }
});
