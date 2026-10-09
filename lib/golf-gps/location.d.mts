import type { GpsCoordinate } from './types';
export type GpsReading = { wgs84: GpsCoordinate; accuracyMeters: number; timestamp: number; method: string; synthetic: boolean };
export type LocationState = { status: string; permission: string; reading: GpsReading | null; active: boolean; simulated: boolean; ageSeconds: number | null };
export type LocationAdapter = { secure: boolean; geolocation?: Pick<Geolocation, 'watchPosition' | 'clearWatch'>; permissions?: Pick<Permissions, 'query'>; simulated?: boolean };
export class GpsLocationSession {
  constructor(adapter: LocationAdapter, onChange: (state: LocationState) => void, runtime?: Record<string, unknown>);
  snapshot(): LocationState; start(): void; stop(): void; dispose(): void;
}
export function browserLocationAdapter(): LocationAdapter;
