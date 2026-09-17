import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncExistingSocialProfileAvatar } from "../lib/profile-avatar-sync";
import {
  acknowledgePendingProfileWrite,
  createProfileWriteCoordinator,
  queuePendingProfileWrite,
  readPendingProfileWrite,
} from "../lib/profile-sync";

type SocialRow = {
  user_id: string;
  avatar_url: string | null;
  username: string;
  display_name: string;
  privacy: "PRIVATE" | "FRIENDS";
};

function fakeClient(options: {
  authId?: string;
  row?: SocialRow | null;
  authError?: Error;
  selectError?: Error;
  updateError?: Error;
  updateReturnsNoRow?: boolean;
  updateReturnedOwner?: string;
  updateReturnedAvatar?: string | null;
} = {}) {
  const authId = options.authId ?? "owner-a";
  let row = options.row === undefined ? {
    user_id: "owner-a", avatar_url: "https://example.test/oauth.jpg", username: "said", display_name: "Said", privacy: "PRIVATE" as const,
  } : options.row ? { ...options.row } : null;
  const updates: Array<Record<string, unknown>> = [];
  const selected: string[] = [];
  let updateError = options.updateError;
  const client = {
    auth: { getUser: async () => options.authError
      ? { data: { user: null }, error: options.authError }
      : { data: { user: { id: authId } }, error: null } },
    from: (table: string) => {
      assert.equal(table, "social_profiles");
      return {
        select: (columns: string) => {
          selected.push(columns);
          return { eq: (field: string, value: string) => {
            assert.equal(field, "user_id");
            return { maybeSingle: async () => options.selectError
              ? { data: null, error: options.selectError }
              : { data: row?.user_id === value ? { user_id: row.user_id, avatar_url: row.avatar_url, ...(columns.includes("username") ? { username: row.username } : {}) } : null, error: null } };
          } };
        },
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return { eq: (field: string, value: string) => {
            assert.equal(field, "user_id");
            return { select: (columns: string) => {
              selected.push(columns);
              return { maybeSingle: async () => {
                if (updateError) return { data: null, error: updateError };
                if (!row || row.user_id !== value || options.updateReturnsNoRow) return { data: null, error: null };
                row = { ...row, avatar_url: payload.avatar_url as string, ...(typeof payload.username === "string" ? { username: payload.username } : {}) };
                return { data: {
                  user_id: options.updateReturnedOwner ?? row.user_id,
                  avatar_url: options.updateReturnedAvatar === undefined ? row.avatar_url : options.updateReturnedAvatar,
                  ...(columns.includes("username") ? { username: row.username } : {}),
                }, error: null };
              } };
            } };
          } };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, updates, selected, row: () => row, setUpdateError: (error: Error | null) => { updateError = error ?? undefined; } };
}

function pendingStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("emoji canónico actualiza sólo avatar del perfil Social existente y preserva privacidad", async () => {
  const fake = fakeClient();
  assert.equal(await syncExistingSocialProfileAvatar(fake.client, "owner-a", "🐺"), "updated");
  assert.deepEqual(fake.updates, [{ avatar_url: "🐺" }]);
  assert.deepEqual(fake.selected, ["user_id,avatar_url", "user_id,avatar_url"]);
  assert.deepEqual(fake.row(), {
    user_id: "owner-a", avatar_url: "🐺", username: "said", display_name: "Said", privacy: "PRIVATE",
  });
  assert.equal(await syncExistingSocialProfileAvatar(fake.client, "owner-a", "🐺"), "updated");
  assert.equal(fake.updates.length, 1); // idempotent retry
});

test("sin imagen se escribe como cadena vacía; foto dataURL no entra a metadata", async () => {
  const fake = fakeClient({ row: { user_id: "owner-a", avatar_url: null, username: "said", display_name: "Said", privacy: "FRIENDS" } });
  assert.equal(await syncExistingSocialProfileAvatar(fake.client, "owner-a", ""), "updated");
  assert.equal(fake.row()?.avatar_url, "");
  assert.equal(fake.row()?.privacy, "FRIENDS");
  const photo = "data:image/png;base64,aGVsbG8=";
  assert.equal(await syncExistingSocialProfileAvatar(fake.client, "owner-a", photo), "updated");
  assert.equal(fake.row()?.avatar_url, photo);
  assert.deepEqual(fake.updates, [{ avatar_url: "" }, { avatar_url: photo }]);
});

test("fila Social ausente no se inventa ni se modifica", async () => {
  const fake = fakeClient({ row: null });
  assert.equal(await syncExistingSocialProfileAvatar(fake.client, "owner-a", "🐺"), "absent");
  assert.equal(fake.row(), null);
  assert.deepEqual(fake.updates, []);
});

test("sólo códigos de tabla ausente retornan unavailable sin UPDATE", async () => {
  for (const code of ["42P01", "PGRST205"]) {
    const fake = fakeClient({ selectError: Object.assign(new Error("table unavailable"), { code }) });
    assert.equal(await syncExistingSocialProfileAvatar(fake.client, "owner-a", "🐺"), "unavailable");
    assert.deepEqual(fake.updates, []);
  }
  const lateMissing = fakeClient({ updateError: Object.assign(new Error("table unavailable"), { code: "42P01" }) });
  assert.equal(await syncExistingSocialProfileAvatar(lateMissing.client, "owner-a", "🐺"), "unavailable");
});

test("columna ausente o permisos no se disfrazan de schema unavailable", async () => {
  const missingColumn = Object.assign(new Error("avatar_url column missing"), { code: "PGRST204" });
  await assert.rejects(() => syncExistingSocialProfileAvatar(fakeClient({ selectError: missingColumn }).client, "owner-a", "🐺"), (error: unknown) => (error as { code?: string }).code === "PGRST204");
  await assert.rejects(() => syncExistingSocialProfileAvatar(fakeClient({ updateError: missingColumn }).client, "owner-a", "🐺"), (error: unknown) => (error as { code?: string }).code === "PGRST204");
  const denied = Object.assign(new Error("permission denied"), { code: "42501" });
  await assert.rejects(() => syncExistingSocialProfileAvatar(fakeClient({ selectError: denied }).client, "owner-a", "🐺"), (error: unknown) => (error as { code?: string }).code === "42501");
});

test("ownership Auth y respuesta Social ajena fallan cerrado", async () => {
  const wrongSession = fakeClient({ authId: "someone-else" });
  await assert.rejects(() => syncExistingSocialProfileAvatar(wrongSession.client, "owner-a", "🐺"), (error: unknown) => (error as { code?: string }).code === "PROFILE_OWNER_MISMATCH");
  assert.equal(wrongSession.selected.length, 0);
  assert.equal(wrongSession.updates.length, 0);

  const wrongReturn = fakeClient({ updateReturnedOwner: "someone-else" });
  await assert.rejects(() => syncExistingSocialProfileAvatar(wrongReturn.client, "owner-a", "🐺"), (error: unknown) => (error as { code?: string }).code === "PROFILE_SOCIAL_AVATAR_UNVERIFIED");
});

test("errores de Auth, RLS, tabla y update sin row permanecen pendientes", async () => {
  await assert.rejects(() => syncExistingSocialProfileAvatar(fakeClient({ authError: new Error("Auth unavailable") }).client, "owner-a", "🐺"), /Auth unavailable/);
  await assert.rejects(() => syncExistingSocialProfileAvatar(fakeClient({ selectError: new Error("permission denied") }).client, "owner-a", "🐺"), /permission denied/);
  await assert.rejects(() => syncExistingSocialProfileAvatar(fakeClient({ updateError: new Error("table missing") }).client, "owner-a", "🐺"), /table missing/);
  await assert.rejects(() => syncExistingSocialProfileAvatar(fakeClient({ updateReturnsNoRow: true }).client, "owner-a", "🐺"), (error: unknown) => (error as { code?: string }).code === "PROFILE_SOCIAL_AVATAR_UNVERIFIED");
});

test("avatar inválido no toca Social ni Auth", async () => {
  const fake = fakeClient();
  await assert.rejects(() => syncExistingSocialProfileAvatar(fake.client, "owner-a", "data:image/svg+xml;base64,AAAA"), (error: unknown) => (error as { code?: string }).code === "PROFILE_AVATAR_INVALID");
  assert.deepEqual(fake.updates, []);
  assert.deepEqual(fake.selected, []);
});

test("fallo Social mantiene pending; retry coordinado confirma avatar sin tocar privacidad", async () => {
  const local = pendingStorage();
  const first = queuePendingProfileWrite(local, "owner-a", { displayName: "Said", defaultHandicap: 7, avatarUrl: "🐺" }, "2026-09-15T12:00:00.000Z");
  const fake = fakeClient({ updateError: new Error("RLS denied") });
  const writer = createProfileWriteCoordinator();
  async function projectPending() {
    return writer.run(async () => {
      const current = readPendingProfileWrite(local, "owner-a");
      if (!current) return false;
      await syncExistingSocialProfileAvatar(fake.client, "owner-a", current.profile.avatarUrl);
      return acknowledgePendingProfileWrite(local, "owner-a", current.revision);
    });
  }
  await assert.rejects(projectPending(), /RLS denied/);
  assert.equal(readPendingProfileWrite(local, "owner-a")?.revision, first.revision);
  assert.equal(fake.row()?.privacy, "PRIVATE");

  fake.setUpdateError(null);
  assert.equal(await projectPending(), true);
  assert.equal(readPendingProfileWrite(local, "owner-a"), null);
  assert.equal(fake.row()?.avatar_url, "🐺");
  assert.equal(fake.row()?.privacy, "PRIVATE");
  assert.deepEqual(fake.updates, [{ avatar_url: "🐺" }, { avatar_url: "🐺" }]);
});

test("schema Social bloqueado externamente no impide ack de queue core", async () => {
  const local = pendingStorage();
  const pending = queuePendingProfileWrite(local, "owner-a", { displayName: "Said", defaultHandicap: 7, avatarUrl: "🐺" }, "2026-09-15T12:00:00.000Z");
  const fake = fakeClient({ selectError: Object.assign(new Error("table unavailable"), { code: "PGRST205" }) });
  const writer = createProfileWriteCoordinator();
  const acknowledged = await writer.run(async () => {
    const current = readPendingProfileWrite(local, "owner-a");
    assert.equal(current?.revision, pending.revision);
    assert.equal(await syncExistingSocialProfileAvatar(fake.client, "owner-a", current.profile.avatarUrl), "unavailable");
    return acknowledgePendingProfileWrite(local, "owner-a", current.revision);
  });
  assert.equal(acknowledged, true);
  assert.equal(readPendingProfileWrite(local, "owner-a"), null);
  assert.deepEqual(fake.updates, []);
  assert.equal(fake.row()?.privacy, "PRIVATE");
});

test("provider proyecta Social antes del ack y retry usa la revisión pending actual", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const reloadStart = provider.indexOf("const pendingProfileAttempt = pendingProfile");
  const reloadEnd = provider.indexOf("const profileRead =", reloadStart);
  const reload = provider.slice(reloadStart, reloadEnd);
  assert.match(reload, /const currentPending = readPendingProfileWrite\(localStorage, authenticatedUserId\)/);
  assert.match(reload, /currentPending\.revision !== pendingProfile\.revision/);
  assert.match(reload, /saveCloudProfile\(supabase, authenticatedUserId, currentPending\.profile, currentPending\.updatedAt\)/);
  assert.match(reload, /syncExistingSocialProfileAvatar\(supabase, authenticatedUserId, currentPending\.profile\.avatarUrl, currentPending\.profile\.username\)/);
  assert.ok(reload.indexOf("syncExistingSocialProfileAvatar") < reload.indexOf("acknowledgePendingProfileWrite"));

  const immediateStart = provider.indexOf("const acknowledged = await profileWriteCoordinator.run");
  const immediateEnd = provider.indexOf("if (activeUserId.current !== identity.userId) return \"local\"", immediateStart);
  const immediate = provider.slice(immediateStart, immediateEnd);
  assert.match(immediate, /retimePendingProfileWrite\(localStorage, identity\.userId, pending\.revision, saved\.updatedAt\)/);
  assert.match(immediate, /syncExistingSocialProfileAvatar\(supabase, identity\.userId, pending\.profile\.avatarUrl, pending\.profile\.username\)/);
  assert.ok(immediate.indexOf("retimePendingProfileWrite") < immediate.indexOf("syncExistingSocialProfileAvatar"));
  assert.ok(immediate.indexOf("syncExistingSocialProfileAvatar") < immediate.indexOf("acknowledgePendingProfileWrite"));
});

test("username canónico se proyecta sólo al Social propio existente, sin cambiar privacidad", async () => {
  const fake = fakeClient();
  assert.equal(await syncExistingSocialProfileAvatar(fake.client, "owner-a", "🐺", " @Said.New "), "updated");
  assert.deepEqual(fake.updates, [{ avatar_url: "🐺", username: "said.new" }]);
  assert.equal(fake.row()?.username, "said.new"); assert.equal(fake.row()?.privacy, "PRIVATE");
  assert.equal(await syncExistingSocialProfileAvatar(fake.client, "owner-a", "🐺", "said.new"), "updated");
  assert.equal(fake.updates.length, 1);
  const other = fakeClient({ authId: "owner-b" });
  await assert.rejects(syncExistingSocialProfileAvatar(other.client, "owner-a", "🐺", "stolen"), { code: "PROFILE_OWNER_MISMATCH" });
  assert.equal(other.updates.length, 0);
  const absent = fakeClient({ row: null });
  assert.equal(await syncExistingSocialProfileAvatar(absent.client, "owner-a", "🐺", "said.new"), "absent");
  assert.equal(absent.updates.length, 0);
});

test("conflicto único Social no confirma pending: retry converge sin tocar identidad ajena", async () => {
  const local = pendingStorage();
  const pending = queuePendingProfileWrite(local, "owner-a", { displayName: "Said", defaultHandicap: 7, avatarUrl: "🐺", username: "said.new" });
  const fake = fakeClient({ updateError: Object.assign(new Error("unique conflict"), { code: "23505" }) });
  const sync = async () => {
    await syncExistingSocialProfileAvatar(fake.client, "owner-a", pending.profile.avatarUrl, pending.profile.username);
    return acknowledgePendingProfileWrite(local, "owner-a", pending.revision);
  };
  await assert.rejects(sync(), { code: "23505" });
  assert.equal(readPendingProfileWrite(local, "owner-a")?.profile.username, "said.new");
  assert.equal(fake.row()?.username, "said"); assert.equal(fake.row()?.privacy, "PRIVATE");
  fake.setUpdateError(null); assert.equal(await sync(), true);
  assert.equal(readPendingProfileWrite(local, "owner-a"), null);
  assert.equal(fake.row()?.username, "said.new"); assert.equal(fake.row()?.privacy, "PRIVATE");
});

test("rename Social no convierte schema ausente en un guardado confirmado", async () => {
  for (const code of ["42P01", "PGRST205"]) {
    const error = Object.assign(new Error("schema unavailable"), { code });
    await assert.rejects(syncExistingSocialProfileAvatar(fakeClient({ selectError: error }).client, "owner-a", "😎", "said.new"), { code });
    await assert.rejects(syncExistingSocialProfileAvatar(fakeClient({ updateError: error }).client, "owner-a", "😎", "said.new"), { code });
  }
});
