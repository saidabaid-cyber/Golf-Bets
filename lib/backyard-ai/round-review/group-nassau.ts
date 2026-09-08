import type { BetConfig } from "../../types";

export type GroupNassauReviewComponent = "first9" | "second9" | "total18";

export type GroupNassauReviewItem = {
  id: string;
  label: string;
  componentLabels: string[];
  config: BetConfig["polla"][GroupNassauReviewComponent];
};

const COMPONENTS: ReadonlyArray<{
  key: GroupNassauReviewComponent;
  label: "Frente" | "Vuelta" | "Total";
}> = [
  { key: "first9", label: "Frente" },
  { key: "second9", label: "Vuelta" },
  { key: "total18", label: "Total" },
];

function participantSignature(ids: readonly string[]) {
  return [...new Set(ids)].sort().join("\u0000");
}

function sameVisibleConfig(
  left: BetConfig["polla"][GroupNassauReviewComponent],
  right: BetConfig["polla"][GroupNassauReviewComponent],
) {
  return left.value === right.value
    && participantSignature(left.participantIds) === participantSignature(right.participantIds)
    && left.hcpPct === right.hcpPct
    && left.decimals === right.decimals;
}

/** Collapses Nassau only when every enabled component has the same visible and
 * deterministic configuration. Divergent components remain independently
 * reviewable so no roster, HCP, rounding rule or amount is hidden. */
export function groupNassauReviewItems(polla: BetConfig["polla"]): GroupNassauReviewItem[] {
  const enabled = COMPONENTS.flatMap(({ key, label }) => polla[key].enabled
    ? [{ key, label, config: polla[key] }]
    : []);
  if (!enabled.length) return [];
  const first = enabled[0];
  if (enabled.every(({ config }) => sameVisibleConfig(first.config, config))) {
    return [{
      id: "nassau",
      label: "Nassau",
      componentLabels: enabled.map(({ label }) => label),
      config: first.config,
    }];
  }
  return enabled.map(({ key, label, config }) => ({
    id: `nassau-${key}`,
    label: `Nassau · ${label}`,
    componentLabels: [label],
    config,
  }));
}
