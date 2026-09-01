import type { RoundSnapshot } from "./types";

export type LocalRoundMigrationResult = { uploaded: string[]; duplicates: string[]; failed: Array<{ id: string; error: string }> };

/** Experimental and deliberately opt-in: local data is never deleted. */
export async function migrateLocalRoundsToCloud(rounds: RoundSnapshot[], accessToken: string): Promise<LocalRoundMigrationResult> {
  const result: LocalRoundMigrationResult = { uploaded: [], duplicates: [], failed: [] };
  for (const round of rounds) {
    try {
      const response = await fetch("/api/cloud/rounds", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ round }),
      });
      if (response.status === 409) result.duplicates.push(round.id);
      else if (response.ok) result.uploaded.push(round.id);
      else result.failed.push({ id: round.id, error: (await response.json()).error || "Error al subir" });
    } catch (error) {
      result.failed.push({ id: round.id, error: error instanceof Error ? error.message : "Error de red" });
    }
  }
  return result;
}
