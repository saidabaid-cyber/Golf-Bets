import type { IndividualNassauBet, PersonalBet, Player, SupplementalBet } from "./types";

type NassauMigrationSource = {
  ownerId?: string;
  startHole?: number;
  players?: Player[];
  personalBets?: PersonalBet[];
  supplementalBets?: SupplementalBet[];
};

export function migrateSupplementalNassau<T extends NassauMigrationSource>(source: T): T {
  const supplemental = Array.isArray(source.supplementalBets) ? source.supplementalBets : [];
  const legacyNassau = supplemental.filter((bet): bet is IndividualNassauBet => bet?.type === "individual_nassau");
  if (!legacyNassau.length) return source;

  const ownerId = source.ownerId || source.players?.[0]?.id || "";
  const current = Array.isArray(source.personalBets) ? source.personalBets : [];
  const existingIds = new Set(current.map((bet) => bet.id));
  const migrated: PersonalBet[] = [];
  const unrepresentable = new Set<string>();
  const represented = new Set<string>();

  for (const bet of legacyNassau) {
    const rivalPlayerId = bet.playerAId === ownerId ? bet.playerBId : bet.playerBId === ownerId ? bet.playerAId : "";
    if (!ownerId || !rivalPlayerId) {
      // A legacy head-to-head that did not include the round owner cannot be
      // represented by the owner-centric Personal engine without changing its
      // math. Keep it intact (but hidden from the canonical setup list).
      unrepresentable.add(bet.id);
      continue;
    }
    if (existingIds.has(bet.id)) {
      represented.add(bet.id);
      continue;
    }
    const rival = source.players?.find((player) => player.id === rivalPlayerId);
    migrated.push({
      id: bet.id,
      enabled: bet.enabled !== false,
      rivalMode: "group",
      rivalPlayerId,
      rivalName: rival?.name || "Rival",
      rivalHandicap: rival?.handicap ?? null,
      externalScores: {},
      baseValue: bet.value,
      advantageReceiver: !bet.advantageReceiverId ? "none" : bet.advantageReceiverId === ownerId ? "owner" : "rival",
      advantageStrokes: bet.advantageStrokes,
      back9Multiplier: 1,
      pressureMultiplier: 1,
      pressureNine: source.startHole === 10 ? "holes_1_9" : "holes_10_18",
      nassauVersion: 2,
      carryEnabled: bet.carryEnabled,
      components: { ...bet.components },
    });
    represented.add(bet.id);
  }

  if (!migrated.length && !represented.size) return source;
  return {
    ...source,
    personalBets: [...current, ...migrated],
    supplementalBets: supplemental.filter((bet) => bet.type !== "individual_nassau" || unrepresentable.has(bet.id) || !represented.has(bet.id)),
  };
}
