import type { Course } from "./types";

export const SCORECARD_PROFILE_PROVENANCE = [
  "GHIN_OFFICIAL", "USGA_OFFICIAL", "CLUB_SCORECARD_VERIFIED", "CLUB_OPERATIONAL",
  "CLUB_TEMPORARY", "TOURNAMENT", "ADMIN_VERIFIED", "PROVIDER_REVIEWED", "PROVIDER_VERIFIED",
] as const;
export type ScorecardProfileProvenance = (typeof SCORECARD_PROFILE_PROVENANCE)[number];
export type ScorecardProfileOption = {
  id: string; name: string; provenance: ScorecardProfileProvenance; defaultForPlay: boolean;
  effectiveFrom?: string; effectiveTo?: string; verifiedAt?: string; historical: boolean; cards: Course[];
};

export function roundTeeSelectionId(course: Course): string {
  return course.roundTeeSelectionId || course.catalogTeeId || course.id;
}

export function scorecardProfileLabel(profile: Pick<ScorecardProfileOption, "name" | "provenance">): string {
  const source = profile.provenance === "GHIN_OFFICIAL" ? "GHIN / Oficial"
    : profile.provenance === "USGA_OFFICIAL" ? "USGA / Oficial"
      : profile.provenance === "CLUB_SCORECARD_VERIFIED" ? "Tarjeta del club"
        : profile.provenance === "CLUB_OPERATIONAL" ? "Club / Operativa"
          : profile.provenance === "CLUB_TEMPORARY" ? "Temporal / Reparación"
            : profile.provenance === "TOURNAMENT" ? "Torneo"
              : profile.provenance === "ADMIN_VERIFIED" ? "Verificada por The Backyard"
                : profile.provenance === "PROVIDER_REVIEWED" ? "Fuente pendiente de autorización" : "Proveedor verificado";
  return profile.name.localeCompare(source, "es-MX", { sensitivity: "base" }) === 0 ? source : `${profile.name} · ${source}`;
}

export function scorecardProfilesForCards(cards: readonly Course[]): ScorecardProfileOption[] {
  const groups = new Map<string, ScorecardProfileOption>();
  for (const card of cards) {
    const id = card.scorecardProfileId || "legacy-default";
    const current = groups.get(id);
    if (current) { current.cards.push(card); continue; }
    groups.set(id, {
      id, name: card.scorecardProfileName || "Tarjeta disponible",
      provenance: card.scorecardProfileProvenance || "ADMIN_VERIFIED",
      defaultForPlay: card.scorecardProfileDefaultForPlay !== false,
      ...(card.scorecardProfileEffectiveFrom ? { effectiveFrom: card.scorecardProfileEffectiveFrom } : {}),
      ...(card.scorecardProfileEffectiveTo ? { effectiveTo: card.scorecardProfileEffectiveTo } : {}),
      ...(card.scorecardProfileVerifiedAt ? { verifiedAt: card.scorecardProfileVerifiedAt } : {}),
      historical: card.scorecardProfileHistorical === true, cards: [card],
    });
  }
  return [...groups.values()].filter((profile) => !profile.historical)
    .sort((left, right) => Number(right.defaultForPlay) - Number(left.defaultForPlay)
      || left.name.localeCompare(right.name, "es-MX") || left.id.localeCompare(right.id));
}

export function cardsForScorecardProfile(cards: readonly Course[], profileId: string): Course[] {
  return scorecardProfilesForCards(cards).find((profile) => profile.id === profileId)?.cards ?? [];
}

/** Detached round evidence: later profile changes cannot rewrite this object. */
export function freezeScorecardProfileSelection(course: Course) {
  if (!course.scorecardProfileId) return undefined;
  return {
    id: course.scorecardProfileId, name: course.scorecardProfileName || "Tarjeta disponible",
    provenance: course.scorecardProfileProvenance || "ADMIN_VERIFIED",
    defaultForPlay: course.scorecardProfileDefaultForPlay === true,
    effectiveFrom: course.scorecardProfileEffectiveFrom || null, effectiveTo: course.scorecardProfileEffectiveTo || null,
    verifiedAt: course.scorecardProfileVerifiedAt || null, teeId: course.catalogTeeId || course.id, teeName: course.teeName,
    rating: typeof course.rating === "number" ? course.rating : null,
    slope: typeof course.slope === "number" ? course.slope : null,
    par: course.holes.reduce((sum, hole) => sum + hole.par, 0),
    strokeIndexes: course.holes.map((hole) => ({ hole: hole.number, strokeIndex: hole.strokeIndex })),
  };
}
