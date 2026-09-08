import type { ScorecardExtraction, ScorecardObservationSource } from "../schemas/scorecard";
import {
  MAX_SCORECARD_DATA_URL_LENGTH,
  MAX_SCORECARD_IMAGE_BYTES,
  MAX_SCORECARD_PHOTO_ID_LENGTH,
  MAX_SCORECARD_PHOTOS,
  MAX_SCORECARD_TOTAL_DATA_URL_LENGTH,
  MAX_SCORECARD_TOTAL_IMAGE_BYTES,
} from "../scorecard/limits";
import { hasOnlyKeys } from "./http-security";

export {
  MAX_SCORECARD_DATA_URL_LENGTH,
  MAX_SCORECARD_IMAGE_BYTES,
  MAX_SCORECARD_PHOTO_ID_LENGTH,
  MAX_SCORECARD_PHOTOS,
  MAX_SCORECARD_REQUEST_BYTES,
  MAX_SCORECARD_TOTAL_DATA_URL_LENGTH,
  MAX_SCORECARD_TOTAL_IMAGE_BYTES,
} from "../scorecard/limits";

export type ScorecardPhotoRequest = {
  /** Caller-controlled identifier, returned locally but never sent to the provider. */
  id: string;
  /** Short request-scoped identifier safe to expose to the vision model. */
  providerId: string;
  dataUrl: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteLength: number;
};

export type ScorecardRoundHint = {
  expectedCourse?: string;
  expectedPlayers?: string[];
  expectedHoles?: 9 | 18;
};

function bytesStartWith(bytes: Uint8Array, prefix: readonly number[]) {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function hasMimeSignature(mimeType: ScorecardPhotoRequest["mimeType"], bytes: Uint8Array) {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 6
      && bytesStartWith(bytes, [0xff, 0xd8, 0xff])
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (mimeType === "image/png") {
    return bytes.length >= 24
      && bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  }
  return bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes.length >= 16
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    && bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38
    && (bytes[15] === 0x20 || bytes[15] === 0x4c || bytes[15] === 0x58);
}

function decodeImageDataUrl(value: unknown) {
  if (typeof value !== "string" || value.length > MAX_SCORECARD_DATA_URL_LENGTH) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return null;
  const mimeType = match[1].toLocaleLowerCase("en-US") as ScorecardPhotoRequest["mimeType"];
  const encoded = match[2];
  if (!encoded || encoded.length % 4 !== 0) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.byteLength > MAX_SCORECARD_IMAGE_BYTES || bytes.toString("base64") !== encoded) return null;
  if (!hasMimeSignature(mimeType, bytes)) return null;
  return { mimeType, byteLength: bytes.byteLength };
}

function parsePhoto(value: unknown, index: number): ScorecardPhotoRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!hasOnlyKeys(source, ["id", "dataUrl"])) return null;
  const id = typeof source.id === "string" ? source.id.trim() : "";
  if (!id || id.length > MAX_SCORECARD_PHOTO_ID_LENGTH || !/^[a-zA-Z0-9._-]+$/.test(id)) return null;
  const image = decodeImageDataUrl(source.dataUrl);
  if (!image) return null;
  return { id, providerId: `photo-${index + 1}`, dataUrl: source.dataUrl as string, ...image };
}

export function parseScorecardPhotos(value: unknown): ScorecardPhotoRequest[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SCORECARD_PHOTOS) return null;
  if (scorecardPhotoPayloadExceedsAggregateLimit(value)) return null;
  const photos = value.map(parsePhoto);
  if (photos.some((photo) => photo === null)) return null;
  const valid = photos as ScorecardPhotoRequest[];
  if (valid.reduce((sum, photo) => sum + photo.byteLength, 0) > MAX_SCORECARD_TOTAL_IMAGE_BYTES) return null;
  return new Set(valid.map((photo) => photo.id)).size === valid.length ? valid : null;
}

/** Classifies an otherwise shape-checked JSON payload as too large before
 * decoding every base64 image. Malformed fields remain the invalid-photo path. */
export function scorecardPhotoPayloadExceedsAggregateLimit(value: unknown) {
  if (!Array.isArray(value)) return false;
  let totalLength = 0;
  let estimatedImageBytes = 0;
  for (const photo of value) {
    if (!photo || typeof photo !== "object" || Array.isArray(photo)) continue;
    const dataUrl = (photo as Record<string, unknown>).dataUrl;
    if (typeof dataUrl !== "string") continue;
    totalLength += dataUrl.length;
    if (totalLength > MAX_SCORECARD_TOTAL_DATA_URL_LENGTH) return true;
    const encoded = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl)?.[1];
    if (encoded && encoded.length % 4 === 0) {
      const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
      estimatedImageBytes += (encoded.length / 4) * 3 - padding;
      if (estimatedImageBytes > MAX_SCORECARD_TOTAL_IMAGE_BYTES) return true;
    }
  }
  return false;
}

function safeLabel(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean && clean.length <= maxLength ? clean : null;
}

export function parseScorecardRoundHint(value: unknown): ScorecardRoundHint | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!hasOnlyKeys(source, ["courseName", "playerNames", "roundHoles"])) return null;

  const result: ScorecardRoundHint = {};
  if (source.courseName !== undefined) {
    const course = safeLabel(source.courseName, 120);
    if (!course) return null;
    result.expectedCourse = course;
  }
  if (source.playerNames !== undefined) {
    if (!Array.isArray(source.playerNames) || source.playerNames.length > 12) return null;
    const players = source.playerNames.map((name) => safeLabel(name, 80));
    if (players.some((name) => name === null)) return null;
    result.expectedPlayers = players as string[];
  }
  if (source.roundHoles !== undefined) {
    if (source.roundHoles !== 9 && source.roundHoles !== 18) return null;
    result.expectedHoles = source.roundHoles;
  }
  return result;
}

function remapSource(source: ScorecardObservationSource, idMap: ReadonlyMap<string, string>): ScorecardObservationSource {
  return { ...source, photoId: idMap.get(source.photoId) || source.photoId };
}

/** Keeps caller photo IDs local; only photo-1...photo-4 are exposed to the provider. */
export function restoreCallerPhotoIds(extraction: ScorecardExtraction, photos: readonly ScorecardPhotoRequest[]): ScorecardExtraction {
  const idMap = new Map(photos.map((photo) => [photo.providerId, photo.id]));
  return {
    ...extraction,
    sourceIds: extraction.sourceIds.map((id) => idMap.get(id) || id),
    course: extraction.course ? { ...extraction.course, source: remapSource(extraction.course.source, idMap) } : null,
    courses: extraction.courses?.map((item) => ({ ...item, source: remapSource(item.source, idMap) })),
    players: extraction.players.map((item) => ({ ...item, source: remapSource(item.source, idMap) })),
    cells: extraction.cells.map((item) => ({ ...item, source: remapSource(item.source, idMap) })),
    pars: extraction.pars.map((item) => ({ ...item, source: remapSource(item.source, idMap) })),
    totals: extraction.totals.map((item) => ({ ...item, source: remapSource(item.source, idMap) })),
  };
}
