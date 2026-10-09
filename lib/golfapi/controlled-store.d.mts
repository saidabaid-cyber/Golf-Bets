import type { GolfApiSnapshot } from './normalize.mjs';
export type GolfApiSavedResponse = { schemaVersion: 1; provider: 'GOLFAPI'; apiVersion: '2.3'; requestKey: string; endpoint: string; parameters: Record<string, string>; fetchedAt: string; httpStatus: number; contentType: string | null; bodyText: string; bodySha256: string };
export type GolfApiRequest = { endpoint: string; parameters: Record<string, string>; url: string; requestKey: string };
export const GOLFAPI_STAGE_ID: string;
export const GOLFAPI_REQUEST_LIMIT: 10;
export const GOLFAPI_ORIGIN: string;
export function documentedRequest(endpoint: string, parameters?: Record<string, string>): GolfApiRequest;
export class GolfApiFileStore {
  constructor(root: string);
  initialize(): Promise<unknown>;
  ledger(): Promise<unknown>;
  cached(request: GolfApiRequest): Promise<GolfApiSavedResponse | null>;
  readNormalized(courseId: string): Promise<GolfApiSnapshot>;
  putNormalized(courseId: string, snapshot: GolfApiSnapshot): Promise<void>;
  request(request: GolfApiRequest, options?: { apiKey?: string; reason?: string; networkEnabled?: boolean }): Promise<{ response: GolfApiSavedResponse; cached: boolean }>;
}
