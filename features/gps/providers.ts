import type { GolfHoleMap, GolfMapLookup, GolfMapProvider, ProviderResult } from "../../lib/golf-providers";

export type HoleMapProvider = GolfMapProvider;

export function createLocalHoleMapProvider(maps: readonly GolfHoleMap[]): HoleMapProvider {
  return {
    id: "backyard-local-hole-map",
    label: "Mapa local de The Backyard",
    capabilities: { hole_geometry: true, green_targets: true, hazards: true, layups: true },
    async getHoleMap(input: GolfMapLookup): Promise<ProviderResult<GolfHoleMap>> {
      const map = maps.find((candidate) => candidate.courseId === input.courseId && candidate.holeNumber === input.holeNumber);
      return map
        ? { ok: true, data: { ...map, targets: map.targets.map((target) => ({ ...target, point: { ...target.point } })) }, providerId: this.id }
        : { ok: false, code: "not_found", message: "Este hoyo aún no tiene un mapa verificado.", providerId: this.id };
    },
  };
}
