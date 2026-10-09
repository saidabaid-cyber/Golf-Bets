import type { GpsCoordinate, GpsHole } from './types';
import type { GpsReading } from './location.mjs';
export type MapScene = { holeKey: string; hole: GpsHole; player: GpsReading | null; target: GpsCoordinate | null; unit: 'm' | 'yd'; playerTargetLabel: string; targetCenterLabel: string };
export type MapCallbacks = { onTarget: (coordinate: GpsCoordinate) => void; onError: (code: string) => void };
export type MapSurface = { update(scene: MapScene): void; fitHole(scene: MapScene): void; centerPlayer(coordinate: GpsCoordinate): void; resize?(): void; destroy(): void };
export type MapFactory = (container: HTMLElement, callbacks: MapCallbacks, signal?: AbortSignal, scene?: MapScene | null) => Promise<MapSurface>;
export class GpsMapSession {
  constructor(factory: MapFactory, onStatus: (status: string) => void);
  open(container: HTMLElement, callbacks: MapCallbacks): Promise<void>; update(scene: MapScene): void;
  fitHole(): void; centerPlayer(): void; resize(): void; dispose(): void;
}
