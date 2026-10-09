export type GolfApiPoint = {
  id: string; position: number; type: string; location: string; sideFW: number | null;
  coordinate: [number, number]; originalIndex: number;
  accuracyMeters: null; observedAt: null; source: string; validation: string; teeId: null; isFlag: false;
};
export type GolfApiSnapshot = {
  schemaVersion: 1; provider: 'GOLFAPI'; externalCourseId: string; externalClubId: string;
  mapping: { courseId: string; clubId: string; physicalHoleCount?: number; referenceCoordinate: [number, number]; allowedNames: string[] };
  source: { coordinatesRequestKey: string; courseRequestKey: string | null; fetchedAt: string; providerCourseUpdatedAt: string | null; validation: string };
  club: { name: string; city: string | null; state: string | null; country: string; generalLocation: [number, number] | null };
  course: { name: string | null; declaredHoles: 9 | 18; measure: string | null };
  tees: Array<{ externalId: string; name: string | null; color: string | null; lengths: Array<{ position: number; originalValue: number | null; originalUnit: string | null; meters: number | null; yards: number | null }>; ratings: Array<{ gender: string; holeCount: number; courseRating: number | null; slope: number | null; frontCourseRating: number | null; backCourseRating: number | null }> }>;
  positions: Array<{ number: number; lap: number; physicalHoleId: string | null; parMen: number | null; parWomen: number | null; strokeIndexMen: number | null; strokeIndexWomen: number | null; green: Record<'front' | 'center' | 'back', GolfApiPoint | null>; points: GolfApiPoint[] }>;
  physicalHoles: Array<{ id: string; number: number; cardPositions: number[]; mappingStatus: string; greenPairDifferencesMeters: Record<string, number | null> | null }>;
  coverage: { positions: number; physicalHoles: number; holesWithCoordinates: number; greenFront: number; greenCenter: number; greenBack: number; teePoints: number; hazardsOrReferences: number; acceptedPoints: number; rejectedPoints: number };
  issues: string[]; rejectedPoints: Array<{ originalIndex: number; reason: string; raw: unknown }>;
};
export function normalizeGolfApiSnapshot(input: { searchCourse: Record<string, unknown>; course?: Record<string, unknown> | null; coordinates: Record<string, unknown>; mapping: GolfApiSnapshot['mapping']; sources: GolfApiSnapshot['source'] }): GolfApiSnapshot;
export function distancesToStoredGreen(snapshot: GolfApiSnapshot, position: number, player: [number, number]): Record<'front' | 'center' | 'back', { meters: number; yards: number; reference: string; fieldVerified: false; isFlag: false } | null>;
export function golfApiGeoJson(snapshot: GolfApiSnapshot): { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; id: string; geometry: { type: 'Point'; coordinates: number[] }; properties: Record<string, unknown> }> };
