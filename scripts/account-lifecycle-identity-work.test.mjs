import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Synthetic PostgreSQL/WASM only. Never calls the remote lifecycle or exports
// user snapshots. The production digest is SHA256; PGlite uses the same
// deterministic fixture digest as the existing migration-graph tests.
const original = readFileSync("supabase/migrations/20260927045252_account_delete_round_player_tombstones.sql", "utf8");
const pruning = readFileSync("supabase/migrations/20261003035013_account_lifecycle_skip_unrelated_json_branches.sql", "utf8");
const candidate = readFileSync("supabase/migrations/20261003070508_account_lifecycle_bound_snapshot_identity_work.sql", "utf8");
const target = "abcdef12-3456-4789-abcd-abcdef123456";
const other = "22222222-2222-4222-8222-222222222222";
const namespace = "round:qa-night-identity-work";
function definition(source, name) {
  const start = source.indexOf(`create or replace function private.${name}(`);
  const end = source.indexOf("$$;", source.indexOf("as $$", start)) + 3;
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}
const db = new PGlite();
const query = (sql, values) => db.query(sql, values);
async function value(sql, values) { return Object.values((await query(sql, values)).rows[0])[0]; }
const snapshot = (holes, courses) => ({
  ownerId: other,
  players: [{ id: `account:${target}`, name: "[QA NIGHT] Private", avatarUrl: "qa-avatar" },
    { id: other, name: "[QA NIGHT] Survivor" }],
  scores: Object.fromEntries(Array.from({ length: holes }, (_, i) => [i + 1, { [`account:${target}`]: 4, [other]: 5 }])),
  putts: Object.fromEntries(Array.from({ length: holes }, (_, i) => [i + 1, { [`account:${target}`]: 2 }])),
  courses: Array.from({ length: courses }, (_, i) => ({ id: `qa-night-course-${i}`, name: "[QA NIGHT] Course",
    holes: Array.from({ length: holes }, (_, h) => ({ hole: h + 1, par: 4, strokeIndex: h + 1,
      yardages: { black: 440, blue: 410, white: 380, red: 330 } })) })),
});

test("bounded identity work preserves deployed JSON/collision/security contracts", async (t) => {
  try {
    await db.exec(`create schema private; create schema extensions; create role anon; create role authenticated;
      create function extensions.digest(bytea,text) returns bytea language sql immutable
        as $$ select decode(md5(encode($1,'hex'))||md5('x'||encode($1,'hex')),'hex') $$;`);
    for (const name of ["account_deleted_identity_token", "account_replace_deleted_identity_text",
      "account_scrub_marked_deleted_json", "anonymize_account_json", "account_scrub_json_uuid", "account_anonymize_json_document"]) {
      await db.exec(definition(original, name));
    }
    await db.exec(pruning);
    await db.exec(definition(original, "account_replace_deleted_identity_text")
      .replaceAll("private.account_replace_deleted_identity_text", "private.account_replace_deleted_identity_text_baseline"));
    await db.exec(definition(pruning, "account_scrub_json_uuid")
      .replaceAll("private.account_scrub_json_uuid", "private.account_scrub_json_uuid_baseline")
      .replaceAll("private.account_replace_deleted_identity_text", "private.account_replace_deleted_identity_text_baseline"));
    await db.exec(definition(original, "anonymize_account_json")
      .replaceAll("private.anonymize_account_json", "private.anonymize_account_json_baseline"));
    await db.exec(definition(original, "account_scrub_marked_deleted_json")
      .replaceAll("private.account_scrub_marked_deleted_json", "private.account_scrub_marked_deleted_json_baseline"));
    await db.exec(definition(original, "account_anonymize_json_document")
      .replaceAll("private.account_anonymize_json_document", "private.account_anonymize_json_document_baseline")
      .replaceAll("private.account_scrub_json_uuid", "private.account_scrub_json_uuid_baseline")
      .replaceAll("private.anonymize_account_json", "private.anonymize_account_json_baseline")
      .replaceAll("private.account_scrub_marked_deleted_json", "private.account_scrub_marked_deleted_json_baseline"));
    await db.exec(candidate);
    const token = await value("select private.account_deleted_identity_token($1,$2)", [namespace, target]);
    const compare = async (document) => {
      const params = [JSON.stringify(document), target, namespace];
      const row = (await query(`select private.account_scrub_json_uuid_baseline($1::jsonb,$2,$3) before,
        private.account_scrub_json_uuid($1::jsonb,$2,$3) after,
        private.account_anonymize_json_document_baseline($1::jsonb,$2,$3) document_before,
        private.account_anonymize_json_document($1::jsonb,$2,$3) document_after`, params)).rows[0];
      assert.deepEqual(row.after, row.before);
      assert.deepEqual(row.document_after, row.document_before);
      return row.after;
    };

    await t.test("all scalar types, unrelated branches, raw UUIDs and exact namespace tombstones", async () => {
      for (const document of [null, false, true, 0, 72.4, "", "Golf · México", [], {},
        { text: `prefix-${target.toUpperCase()}-suffix` },
        { id: token.toUpperCase(), name: "QA name", avatarUrl: "QA photo" },
        { [`account:${target.toUpperCase()}`]: 4 },
        { text: `other-${token}-same-${target}-${target}` },
        { text: "deleted-unrelated", accountUserId: other, name: "Keep name" },
        { courses: [{ name: "Keep course", holes: [{ par: 4 }] }], createdBy: target }]) await compare(document);
      assert.equal(await value("select private.account_scrub_json_uuid(null,$1,$2)", [target, namespace]), null);
      for (const text of ["par", "score", target, target.toUpperCase(), token, token.toUpperCase(),
        `account:${target}`, `a${target}${target}b`, `prefix${target}${token.toUpperCase()}`,
        "deleted-fake-identifier", "", "Mi país · 🌳"]) {
        assert.equal(await value("select private.account_replace_deleted_identity_text($1,$2,$3)", [text, target, namespace]),
          await value("select private.account_replace_deleted_identity_text_baseline($1,$2,$3)", [text, target, namespace]));
      }
    });
    await t.test("23505 key collisions still fail before recursive traversal", async () => {
      for (const name of ["account_scrub_json_uuid_baseline", "account_scrub_json_uuid"]) {
        for (const document of [{ [target]: 4, [token]: 5 },
          { [token]: 4, [token.toUpperCase()]: 5 },
          { outer: [{ [`player:${target}`]: 2, [`player:${token}`]: 3 }] }]) {
          await assert.rejects(query(`select private.${name}($1::jsonb,$2,$3)`, [JSON.stringify(document), target, namespace]),
            { code: "23505", message: "account_lifecycle_player_key_collision" });
        }
      }
    });
    await t.test("scores, surviving PII, provenance and marker-only redaction remain identical", async () => {
      const document = { ...snapshot(18, 2),
        course: { id: "qa-course", name: "Keep course", createdBy: target, rating: 72.4 },
        owner: { ownerId: target, ownerName: "QA owner", ownerAvatar: "QA photo" },
        marked: { identityDeleted: true, id: "local-player", name: "QA name", email: "qa@example.invalid", updatedBy: other } };
      const params = [JSON.stringify(document), target, namespace];
      await compare(document);
      const row = await value("select private.account_anonymize_json_document($1::jsonb,$2,$3)", params);
      assert.equal(row.course.name, "Keep course"); assert.equal(row.course.createdBy, null);
      assert.equal(row.players[1].name, "[QA NIGHT] Survivor");
      assert.equal(row.scores[18][`account:${token}`], 4);
      assert.equal(row.marked.name, "Jugador eliminado"); assert.equal(row.marked.email, null);
      assert.equal(row.marked.updatedBy, other); assert.equal(row.owner.ownerName, "Jugador eliminado");
    });
    await t.test("nested generated documents and repeated redaction are identical", async () => {
      for (let i = 0; i < 75; i++) {
        const document = { items: [{ id: i % 2 ? target : other, name: "QA player" },
          { [i % 3 ? "ordinary" : `prefix${target.toUpperCase()}`]: [null, true, i] }],
          rounds: [snapshot(i % 3 ? 9 : 18, i % 4)] };
        const result = await compare(document);
        assert.deepEqual(await value("select private.account_scrub_json_uuid($1::jsonb,$2,$3)",
          [JSON.stringify(result), target, namespace]), result);
      }
    });
    await t.test("local aliases, empty aliases and boolean/string deletion markers survive pruning", async () => {
      for (const alias of ["local-qa-player", "", "玩家-qa", "CaseSensitiveAlias"]) {
        await compare({ players: [{ id: alias, accountUserId: target, name: "QA private" }],
          scores: { [alias]: 4 }, history: [{ playerId: alias, name: "QA private", email: "qa@example.invalid" }],
          owner: { ownerId: alias, ownerName: "QA owner" } });
      }
      for (const marker of [true, "true", "TRUE", "TrUe", false, " true ", null]) {
        const document = { group: [{ identityDeleted: marker, name: "QA marker PII", email: "qa@example.invalid" }],
          course: { name: "Keep course", par: 72 } };
        await compare(document);
        const args = [JSON.stringify(document)];
        assert.deepEqual(await value("select private.account_scrub_marked_deleted_json($1::jsonb)", args),
          await value("select private.account_scrub_marked_deleted_json_baseline($1::jsonb)", args));
      }
    });
    await t.test("private helpers remain strict, immutable and uncallable by PLAYER; trigger keeps security definer", async () => {
      const rows = (await query(`select p.proname,p.provolatile,p.prosecdef,p.proisstrict,p.proconfig,
        has_function_privilege('authenticated',p.oid,'EXECUTE') player_execute,
        has_function_privilege('anon',p.oid,'EXECUTE') anon_execute
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='private' and p.proname in ('account_scrub_json_uuid_with_token','account_scrub_json_uuid',
          'account_replace_deleted_identity_text','account_scrub_deleted_snapshot')`)).rows;
      assert.equal(rows.length, 4);
      for (const row of rows) {
        assert.equal(row.player_execute, false); assert.equal(row.anon_execute, false);
        assert.deepEqual(row.proconfig, ['search_path=""']);
        assert.equal(row.prosecdef, row.proname === "account_scrub_deleted_snapshot");
        assert.equal(row.provolatile, row.prosecdef ? "v" : "i");
        assert.equal(row.proisstrict, !row.prosecdef);
      }
      assert.doesNotMatch(candidate, /\b(?:update\s+public\.|delete\s+from|insert\s+into|alter\s+role|create\s+trigger|statement_timeout)\b/i);
      const definitionsBefore = rows;
      await db.exec(candidate); // idempotent definition/grants installation
      assert.equal(definitionsBefore.length, 4);
    });
    await t.test("small / medium / 74-version synthetic profiles measured before and after", async () => {
      for (const [label, holes, courses, versions] of [["small", 9, 0, 1], ["medium", 18, 3, 20], ["historical", 18, 11, 74]]) {
        const payload = JSON.stringify(snapshot(holes, courses));
        const timings = {};
        let before;
        for (const [phase, name] of [["before", "account_scrub_json_uuid_baseline"], ["after", "account_scrub_json_uuid"]]) {
          const start = performance.now();
          const rows = (await query(`select private.${name}($1::jsonb,$2,$3||':'||i) output
            from generate_series(1,$4::integer) i`, [payload, target, namespace, versions])).rows;
          timings[phase] = Math.round(performance.now() - start);
          if (before) assert.deepEqual(rows, before); else before = rows;
        }
        console.log(JSON.stringify({ benchmark: "UUID/collision phase / PostgreSQL WASM", label, versions,
          payloadBytes: Buffer.byteLength(payload), beforeMs: timings.before, afterMs: timings.after, remoteTimingGuarantee: false }));
      }
    });
    await t.test("measure the actual collision aggregate and both remaining document passes", async () => {
      const wide = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`metric-${i}`, i]));
      wide[`account:${target}`] = 4;
      for (const [phase, expression] of [
        ["before", "private.account_replace_deleted_identity_text_baseline(key,$2,$3)"],
        ["after", "regexp_replace(regexp_replace(key,$2::text,$3,'gi'),$3,$3,'gi')"],
      ]) {
        const start = performance.now();
        const params = [JSON.stringify(wide), target, phase === "after" ? token : namespace];
        const rows = (await query(`select i,count(*)<>count(distinct ${expression}) collision
          from generate_series(1,74) i cross join jsonb_each($1::jsonb) group by i`, params)).rows;
        assert.equal(rows.length, 74); assert.ok(rows.every(row => row.collision === false));
        console.log(JSON.stringify({ benchmark: "collision aggregate / PostgreSQL WASM", phase,
          keysPerObject: 101, objects: 74, durationMs: Math.round(performance.now() - start), remoteTimingGuarantee: false }));
      }
      const payload = JSON.stringify({ ...snapshot(18, 11),
        marked: { identityDeleted: true, name: "QA marker PII", email: "qa@example.invalid" } });
      for (const name of ["anonymize_account_json", "account_scrub_marked_deleted_json", "account_anonymize_json_document"]) {
        let expected;
        for (const phase of ["before", "after"]) {
          const callName = name + (phase === "before" ? "_baseline" : "");
          const markedOnly = name === "account_scrub_marked_deleted_json";
          const args = markedOnly ? [payload] : name === "anonymize_account_json" ? [payload, target] : [payload, target, namespace];
          // Depend on each series row so immutable constant folding cannot
          // turn a 74-document measurement into one precomputed function call.
          const input = "case when i>0 then $1::jsonb else null end";
          const placeholders = markedOnly ? input : name === "anonymize_account_json" ? `${input},$2` : `${input},$2,$3||':'||i`;
          const start = performance.now();
          const rows = (await query(`select private.${callName}(${placeholders}) output from generate_series(1,74) i`, args)).rows;
          if (expected) assert.deepEqual(rows, expected); else expected = rows;
          console.log(JSON.stringify({ benchmark: "document pass / PostgreSQL WASM", name, phase,
            versions: 74, durationMs: Math.round(performance.now() - start), remoteTimingGuarantee: false }));
        }
      }
    });
  } finally { await db.close(); }
});
