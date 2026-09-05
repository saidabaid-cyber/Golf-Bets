import type { RabbitMode, SkinsMode } from "./types";

export const DEFAULT_RABBIT_MODE: RabbitMode = "continuous";
export const DEFAULT_SKINS_MODE: SkinsMode = "carry";

export function normalizeRabbitMode(value: unknown): RabbitMode {
  return value === "three_hole_blocks" ? value : DEFAULT_RABBIT_MODE;
}

export function normalizeSkinsMode(value: unknown): SkinsMode {
  return value === "no_carry" ? value : DEFAULT_SKINS_MODE;
}
