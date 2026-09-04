import type { SupabaseClient } from "@supabase/supabase-js";

const SCORECARD_BUCKET = "scorecard-photos";

export const ACCOUNT_OWNED_ROWS = [
  ["account_data_migrations", "user_id"],
  ["rules_referee_acceptances", "user_id"],
  ["legal_acceptances", "user_id"],
  ["user_preferences", "user_id"],
  ["user_cloud_state", "user_id"],
  ["cloud_deletions", "owner_id"],
  ["frequent_groups_cloud", "owner_id"],
  ["personal_rivals_cloud", "owner_id"],
  ["rounds_cloud", "owner_id"],
  ["courses_cloud", "owner_id"],
  ["players", "owner_id"],
  ["tournament_access", "user_id"],
  ["profiles", "id"],
] as const;

export const ACCOUNT_REFERENCE_COLUMNS = [
  ["course_versions", "created_by"],
  ["tournament_groups", "confirmed_by"],
  ["tournament_scores", "entered_by"],
  ["tournament_oyes", "entered_by"],
] as const;

export type AccountStorageEntry = { name: string; isFolder: boolean };
export type OwnedTournament = { id: string; publicId: string };
export type AccountDeletionGateway = {
  listStorage: (prefix: string, offset: number) => Promise<AccountStorageEntry[]>;
  removeStorage: (paths: string[]) => Promise<void>;
  ownedTournaments: (userId: string) => Promise<OwnedTournament[]>;
  deleteWhere: (table: string, column: string, value: string) => Promise<void>;
  deleteWhereIn: (table: string, column: string, values: string[]) => Promise<void>;
  clearReference: (table: string, column: string, userId: string) => Promise<void>;
  deleteAuthUser: (userId: string) => Promise<void>;
};

async function listAccountPhotos(gateway: AccountDeletionGateway, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 4) throw new Error("La carpeta de fotos tiene una estructura inesperada.");
  const paths: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const entries = await gateway.listStorage(prefix, offset);
    for (const entry of entries) {
      if (!entry.name || entry.name === "." || entry.name === "..") continue;
      const path = `${prefix}/${entry.name}`;
      if (entry.isFolder) paths.push(...await listAccountPhotos(gateway, path, depth + 1));
      else paths.push(path);
    }
    if (entries.length < 100) break;
  }
  return paths;
}

/** Ordered deletion: private media first (Auth refuses users that still own
 * Storage objects), then account-owned data/references, Auth user last. */
export async function deleteAccountGraph(gateway: AccountDeletionGateway, userId: string) {
  if (!userId || userId === "guest") throw new Error("Cuenta inválida.");
  const photos = await listAccountPhotos(gateway, userId);
  for (let index = 0; index < photos.length; index += 100) await gateway.removeStorage(photos.slice(index, index + 100));

  const tournaments = await gateway.ownedTournaments(userId);
  const tournamentIds = tournaments.map(tournament => tournament.id);
  const publicTournamentIds = tournaments.map(tournament => tournament.publicId).filter(Boolean);
  for (let index = 0; index < tournamentIds.length; index += 100) {
    await gateway.deleteWhereIn("score_audit_log", "tournament_id", tournamentIds.slice(index, index + 100));
  }
  for (let index = 0; index < publicTournamentIds.length; index += 100) {
    await gateway.deleteWhereIn("polla_join_attempts", "public_id", publicTournamentIds.slice(index, index + 100));
  }
  await gateway.deleteWhere("score_audit_log", "changed_by", userId);
  await gateway.deleteWhere("tournaments", "created_by", userId);
  for (const [table, column] of ACCOUNT_REFERENCE_COLUMNS) await gateway.clearReference(table, column, userId);
  for (const [table, column] of ACCOUNT_OWNED_ROWS) await gateway.deleteWhere(table, column, userId);
  await gateway.deleteAuthUser(userId);
  return { deletedPhotoCount: photos.length, deletedTournamentCount: tournamentIds.length };
}

function assertResult(result: { error: unknown }) {
  if (result.error) throw result.error;
}

export function supabaseAccountDeletionGateway(admin: SupabaseClient): AccountDeletionGateway {
  return {
    listStorage: async (prefix, offset) => {
      const result = await admin.storage.from(SCORECARD_BUCKET).list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
      assertResult(result);
      return (result.data || []).map((entry) => ({ name: entry.name, isFolder: !entry.id }));
    },
    removeStorage: async paths => { if (paths.length) assertResult(await admin.storage.from(SCORECARD_BUCKET).remove(paths)); },
    ownedTournaments: async userId => {
      const result = await admin.from("tournaments").select("id,public_id").eq("created_by", userId);
      assertResult(result);
      return (result.data || []).map(row => ({ id: String(row.id), publicId: String(row.public_id || "") }));
    },
    deleteWhere: async (table, column, value) => { assertResult(await admin.from(table).delete().eq(column, value)); },
    deleteWhereIn: async (table, column, values) => { if (values.length) assertResult(await admin.from(table).delete().in(column, values)); },
    clearReference: async (table, column, userId) => { assertResult(await admin.from(table).update({ [column]: null }).eq(column, userId)); },
    deleteAuthUser: async userId => { assertResult(await admin.auth.admin.deleteUser(userId, false)); },
  };
}
