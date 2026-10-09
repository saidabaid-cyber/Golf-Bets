import type { GpsCoordinate, GpsHole } from './types';
import type { LocationState, GpsReading } from './location.mjs';
export type GpsDistance = { meters: number; yards: number };
export function liveReading(location: LocationState | null, now?: number): GpsReading | null;
export function measuredDistance(origin: GpsCoordinate | null | undefined, destination: GpsCoordinate | null | undefined): GpsDistance | null;
export function gpsMeasurements(hole: GpsHole | null, location: LocationState | null, target: GpsCoordinate | null, now?: number): Record<'front' | 'center' | 'back' | 'playerTarget' | 'targetCenter', GpsDistance | null> & { simulated: boolean };
export function holePoints(hole: GpsHole | null): GpsCoordinate[];
export function displayDistance(distance: GpsDistance | null, unit: 'm' | 'yd'): string;
export function validCoordinate(value: unknown): value is GpsCoordinate;

export function holeViewport(hole: GpsHole, player?: GpsReading | null): {west:number;east:number;south:number;north:number;coverage:string}|null;
