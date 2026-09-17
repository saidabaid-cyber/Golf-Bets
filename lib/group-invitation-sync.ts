import type { FrequentGroup, FrequentGroupMember } from "./types";

const accountIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only verified server membership is imported; matching names are not identity. */
export function mergeAcceptedGroupMembers(current: FrequentGroupMember[], accepted: FrequentGroupMember[]) {
  let merged = current;
  for (const candidate of accepted) {
    if (!candidate || !accountIdPattern.test(candidate.accountUserId || "") || !candidate.name?.trim()) continue;
    if (merged.some((member) => member.accountUserId === candidate.accountUserId || Boolean(member.memberId && member.memberId === candidate.memberId))) continue;
    if (merged === current) merged = [...current];
    merged.push({
      memberId: candidate.memberId || `account-${candidate.accountUserId}`,
      kind: "account", accountUserId: candidate.accountUserId, name: candidate.name.trim(),
      handicap: typeof candidate.handicap === "number" && Number.isFinite(candidate.handicap) ? candidate.handicap : null,
      ...(candidate.username ? { username: candidate.username } : {}),
    });
  }
  return merged;
}

export type SavedGroupSnapshot = { group: FrequentGroup; mode: "cloud" | "local"; notice: string };

/** Called only by an explicit Save, never by render or a background effect.
 * This upserts the existing canonical group; it does not create/send invitations. */
export async function saveExplicitGroupSnapshot(input: {
  group: FrequentGroup;
  accessToken?: string | null;
  authenticated: boolean;
  online: boolean;
  fetcher?: typeof fetch;
}): Promise<SavedGroupSnapshot> {
  const { group, accessToken, authenticated, online, fetcher = fetch } = input;
  if (!online || !authenticated) return { group, mode: "local", notice: "Grupo guardado en este dispositivo. Conéctate e inicia sesión para guardar los cambios del grupo compartido. No se enviaron invitaciones." };
  if (!accessToken) throw new Error("No pudimos verificar tu sesión. Conservamos el borrador; vuelve a intentar guardar.");
  let response: Response;
  try {
    response = await fetcher("/api/groups/invitations", {
      method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ensure", group }), signal: AbortSignal.timeout(25_000),
    });
  } catch { throw new Error("No pudimos guardar el grupo compartido. Conservamos el borrador; revisa tu conexión y reintenta."); }
  if (!response.ok) throw new Error(response.status === 401 ? "Tu sesión necesita renovarse. Conservamos el borrador; vuelve a iniciar sesión para guardar." : "No pudimos confirmar el guardado del grupo compartido. Conservamos el borrador; puedes reintentar.");
  let result: { groupId?: unknown; groupSnapshot?: Partial<FrequentGroup> };
  try { result = await response.json(); }
  catch { throw new Error("No pudimos verificar el grupo guardado. Conservamos el borrador; puedes reintentar."); }
  if (!result || typeof result.groupId !== "string" || !accountIdPattern.test(result.groupId) || result.groupSnapshot?.id !== group.id || !Array.isArray(result.groupSnapshot.players)) {
    throw new Error("No pudimos verificar el grupo guardado. Conservamos el borrador; puedes reintentar.");
  }
  // SQL ensure preserves members accepted after the editor opened. Read them
  // back before writing the frequent-group cache, preserving the edited template.
  return { group: { ...group, players: mergeAcceptedGroupMembers(group.players, result.groupSnapshot.players) }, mode: "cloud", notice: "Grupo y apuestas guardados. Las rondas anteriores no cambian." };
}
