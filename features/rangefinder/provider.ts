export type RangefinderReading = { distanceYards: number; capturedAt: string; deviceId?: string };

export interface RangefinderProvider {
  readonly id: string;
  readonly configured: boolean;
  readDistance(): Promise<RangefinderReading | null>;
}

export const unavailableRangefinderProvider: RangefinderProvider = {
  id: "rangefinder-unavailable",
  configured: false,
  async readDistance() { return null; },
};
