export type PendingPollaScore = {
  id: string;
  tournamentId: string;
  groupId: string;
  playerId: string;
  hole: number;
  score: number;
  baseUpdatedAt?: string;
  queuedAt: string;
  status?: "pending" | "conflict";
};

const KEY = "golfbets-polla-offline-v1";
type PollaQueueStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function readPendingPollaScores(storage: Pick<Storage, "getItem"> | null = defaultStorage()) {
  if (!storage) return [] as PendingPollaScore[];
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed as PendingPollaScore[] : [];
  } catch {
    return [] as PendingPollaScore[];
  }
}

export function enqueuePollaScore(item: PendingPollaScore, storage: PollaQueueStorage | null = defaultStorage()) {
  if (!storage) return;
  const current = readPendingPollaScores(storage);
  const withoutSameScore = current.filter((entry) => !(entry.tournamentId === item.tournamentId && entry.playerId === item.playerId && entry.hole === item.hole));
  storage.setItem(KEY, JSON.stringify([...withoutSameScore, { ...item, status: item.status || "pending" }]));
}

export function acknowledgePollaScore(itemId: string, storage: PollaQueueStorage | null = defaultStorage()) {
  if (!storage) return;
  storage.setItem(KEY, JSON.stringify(readPendingPollaScores(storage).filter((entry) => entry.id !== itemId)));
}

export function discardPollaScoreConflicts(tournamentId: string, groupId: string, storage: PollaQueueStorage | null = defaultStorage()) {
  if (!storage) return 0;
  const current = readPendingPollaScores(storage);
  const discarded = current.filter((entry) => entry.tournamentId === tournamentId && entry.groupId === groupId && entry.status === "conflict").length;
  storage.setItem(KEY, JSON.stringify(current.filter((entry) => !(entry.tournamentId === tournamentId && entry.groupId === groupId && entry.status === "conflict"))));
  return discarded;
}

export async function flushPollaScoreQueue(
  accessToken: string,
  options: { storage?: PollaQueueStorage | null; fetcher?: typeof fetch; tournamentId?: string; groupId?: string } = {},
) {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const fetcher = options.fetcher || fetch;
  const all = readPendingPollaScores(storage);
  const inScope = (item: PendingPollaScore) => (!options.tournamentId || item.tournamentId === options.tournamentId) && (!options.groupId || item.groupId === options.groupId);
  const pending = all.filter(inScope);
  const untouched = all.filter((item) => !inScope(item));
  const conflicts: PendingPollaScore[] = [];
  const remaining: PendingPollaScore[] = [];
  for (const item of pending) {
    try {
      const response = await fetcher("/api/polla/scores", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(item),
      });
      if (response.status === 409) conflicts.push({ ...item, status: "conflict" });
      else if (!response.ok) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  storage?.setItem(KEY, JSON.stringify([...untouched, ...conflicts, ...remaining]));
  return { synced: pending.length - conflicts.length - remaining.length, conflicts, remaining };
}
