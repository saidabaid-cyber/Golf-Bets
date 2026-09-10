export type WearableEvent = "distance_view" | "score_entry" | "shot_start" | "shot_end";

export interface WearableProvider {
  readonly id: string;
  readonly configured: boolean;
  supports(event: WearableEvent): boolean;
}

export const unavailableWearableProvider: WearableProvider = {
  id: "wearable-unavailable",
  configured: false,
  supports: () => false,
};
