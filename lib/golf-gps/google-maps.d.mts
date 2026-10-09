import type { MapFactory } from './map-session.mjs';
export type GoogleMapsOptions = { enabled: boolean; apiKey: string };
export function googleMapGate(options: GoogleMapsOptions & { origin: string; online?: boolean }): string | null;
export function loadGoogleMaps(options: GoogleMapsOptions, runtime?: Window): Promise<unknown>;
export function googleMapsFactory(options: GoogleMapsOptions, runtime?: Window): MapFactory;
