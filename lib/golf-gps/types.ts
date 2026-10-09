export type GpsCoordinate = [longitude: number, latitude: number];
export type GpsReference = { label: string; coordinate: GpsCoordinate; kind: string };
export type GpsHole = {
  position: number; lap: number; physicalHoleId: string | null; physicalNumber: number | null;
  green: Record<'front' | 'center' | 'back', GpsCoordinate | null>;
  references: GpsReference[]; pairingStatus: string; pairingDifferencesMeters: Record<string, number | null> | null;
};
export type GpsCourse = {
  id: string; name: string; physicalHoleCount: number; cardPositionCount: number;
  holes: GpsHole[]; source: { provider: 'GOLFAPI'; recordUpdatedAt: string | null; fieldVerified: false; accuracyMeters: null; coordinateCaptureDate: null };
};
export type GpsCoursesResponse = { schemaVersion: 1; courses: GpsCourse[]; unavailable: string[]; mapsEnabled: boolean };
