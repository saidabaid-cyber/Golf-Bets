export type PendingPollaScore = {
  id: string;
  tournamentId: string;
  groupId: string;
  playerId: string;
  hole: number;
  score: number;
  baseUpdatedAt?: string;
  queuedAt: string;
};

const KEY = "golfbets-polla-offline-v1";

export function readPendingPollaScores() {
  if (typeof window === "undefined") return [] as PendingPollaScore[];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed as PendingPollaScore[] : [];
  } catch {
    return [] as PendingPollaScore[];
  }
}

export function enqueuePollaScore(item: PendingPollaScore) {
  const current = readPendingPollaScores();
  const withoutSameScore = current.filter((entry) => !(entry.tournamentId === item.tournamentId && entry.playerId === item.playerId && entry.hole === item.hole));
  localStorage.setItem(KEY, JSON.stringify([...withoutSameScore, item]));
}

export async function flushPollaScoreQueue(accessToken: string) {
  const pending = readPendingPollaScores();
  const conflicts: PendingPollaScore[] = [];
  const remaining: PendingPollaScore[] = [];
  for (const item of pending) {
    try {
      const response = await fetch("/api/polla/scores", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(item),
      });
      if (response.status === 409) conflicts.push(item);
      else if (!response.ok) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  localStorage.setItem(KEY, JSON.stringify([...conflicts, ...remaining]));
  return { synced: pending.length - conflicts.length - remaining.length, conflicts, remaining };
}
