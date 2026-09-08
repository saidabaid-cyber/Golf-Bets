import { BackyardAiRequestError, blobToDataUrl } from "../client-api";
import {
  compressScorecardPhoto,
  saveCompressedScorecardPhoto,
  ScorecardPhotoError,
} from "../../scorecard-photo";
import {
  MAX_SCORECARD_TOTAL_DATA_URL_LENGTH,
  MAX_SCORECARD_TOTAL_IMAGE_BYTES,
  scorecardImageByteBudget,
} from "./limits";

export type ScorecardClientPhoto = { id: string; file: File };

export type PreparedScorecardClientPhoto = {
  id: string;
  blob: Blob;
  dataUrl: string;
};

export type ScorecardPhotoPersistenceResult = {
  persistedPhotoIds: string[];
  failedPhotoIds: string[];
};

export type ScorecardPhotoAnalysisResult<T> = {
  response: T;
  preparedPhotoIds: string[];
  preparationFailures: Array<{ photoId: string; error: unknown }>;
  persistence: Promise<ScorecardPhotoPersistenceResult>;
};

export type ScorecardPhotoAnalysisDependencies<T> = {
  compress?: (file: File, maxBytes?: number) => Promise<Blob>;
  encode?: (blob: Blob) => Promise<string>;
  persist?: (photoId: string, blob: Blob, ownerId: string) => Promise<unknown>;
  analyze: (photos: Array<{ id: string; dataUrl: string }>) => Promise<T>;
  onPhotoPersisted?: (photoId: string) => void;
  onPhotoPersistenceFailed?: (photoId: string) => void;
};

export class ScorecardClientPipelineError extends Error {
  readonly code:
    | "photo_open_failed"
    | "photo_compression_failed"
    | "photo_too_large"
    | "invalid_extraction"
    | "photo_source_mismatch";

  constructor(code: ScorecardClientPipelineError["code"], message: string) {
    super(message);
    this.name = "ScorecardClientPipelineError";
    this.code = code;
  }
}

function preparationError(error: unknown) {
  if (error instanceof ScorecardPhotoError) return error;
  return new ScorecardClientPipelineError("photo_open_failed", "No pude abrir la foto.");
}

async function preparePhoto(
  photo: ScorecardClientPhoto,
  compress: (file: File, maxBytes?: number) => Promise<Blob>,
  encode: (blob: Blob) => Promise<string>,
  maxBytes: number,
) {
  let blob: Blob;
  try {
    blob = await compress(photo.file, maxBytes);
  } catch (error) {
    throw preparationError(error);
  }
  if (!blob.size || blob.size > maxBytes) {
    throw new ScorecardClientPipelineError("photo_too_large", "La foto supera el tamaño permitido.");
  }
  try {
    return { id: photo.id, blob, dataUrl: await encode(blob) } satisfies PreparedScorecardClientPhoto;
  } catch {
    throw new ScorecardClientPipelineError("photo_open_failed", "No pude abrir la foto.");
  }
}

/** Prepares every usable image in memory, begins best-effort persistence, and
 * immediately sends those in-memory payloads to the analyzer. The analysis
 * never awaits or depends on IndexedDB. */
export async function runScorecardPhotoAnalysis<T>(
  photos: readonly ScorecardClientPhoto[],
  ownerId: string,
  dependencies: ScorecardPhotoAnalysisDependencies<T>,
): Promise<ScorecardPhotoAnalysisResult<T>> {
  const compress = dependencies.compress || ((file: File, maxBytes?: number) => compressScorecardPhoto(file, { maxBytes }));
  const encode = dependencies.encode || blobToDataUrl;
  const persist = dependencies.persist || saveCompressedScorecardPhoto;
  const perPhotoBudget = scorecardImageByteBudget(photos.length);
  const settledPreparation = await Promise.allSettled(photos.map((photo) => preparePhoto(photo, compress, encode, perPhotoBudget)));
  const prepared: PreparedScorecardClientPhoto[] = [];
  const preparationFailures: Array<{ photoId: string; error: unknown }> = [];
  settledPreparation.forEach((result, index) => {
    if (result.status === "fulfilled") prepared.push(result.value);
    else preparationFailures.push({ photoId: photos[index].id, error: result.reason });
  });
  if (!prepared.length) throw preparationFailures[0]?.error || new ScorecardClientPipelineError("photo_open_failed", "No pude abrir la foto.");
  const totalImageBytes = prepared.reduce((sum, photo) => sum + photo.blob.size, 0);
  const totalDataUrlLength = prepared.reduce((sum, photo) => sum + photo.dataUrl.length, 0);
  if (totalImageBytes > MAX_SCORECARD_TOTAL_IMAGE_BYTES || totalDataUrlLength > MAX_SCORECARD_TOTAL_DATA_URL_LENGTH) {
    throw new ScorecardClientPipelineError("photo_too_large", "Las fotos superan el tamaño permitido.");
  }

  const persistence = Promise.all(prepared.map(async (photo) => {
    try {
      await persist(photo.id, photo.blob, ownerId);
      dependencies.onPhotoPersisted?.(photo.id);
      return { id: photo.id, persisted: true as const };
    } catch {
      dependencies.onPhotoPersistenceFailed?.(photo.id);
      return { id: photo.id, persisted: false as const };
    }
  })).then((items): ScorecardPhotoPersistenceResult => ({
    persistedPhotoIds: items.filter((item) => item.persisted).map((item) => item.id),
    failedPhotoIds: items.filter((item) => !item.persisted).map((item) => item.id),
  }));

  const response = await dependencies.analyze(prepared.map(({ id, dataUrl }) => ({ id, dataUrl })));
  return {
    response,
    preparedPhotoIds: prepared.map((photo) => photo.id),
    preparationFailures,
    persistence,
  };
}

export function scorecardScanErrorMessage(error: unknown) {
  if (error instanceof ScorecardPhotoError || error instanceof ScorecardClientPipelineError) return error.message;
  if (error instanceof BackyardAiRequestError) {
    if (["disabled", "missing_config", "rate_limit_config", "provider_config"].includes(error.code || "")) {
      return "Backyard AI no está configurado.";
    }
    if (error.code === "timeout") return "El análisis tardó demasiado.";
    if (["rate_limit", "global_rate_limit", "rate_limit_unavailable", "quota"].includes(error.code || "")) {
      return "Se alcanzó el límite temporal. Intenta nuevamente en un momento.";
    }
    if (["request_too_large", "invalid_photos"].includes(error.code || "")) return "Las fotos superan el tamaño permitido o no son compatibles.";
    if (["invalid_extraction", "invalid_json"].includes(error.code || "")) return "La respuesta no pasó validación.";
    if (["provider_error", "empty_response", "incomplete_response"].includes(error.code || "")) return "El proveedor no pudo leer la imagen.";
    return error.message;
  }
  if (error instanceof TypeError) return "No pude enviar la foto. Revisa tu conexión e intenta nuevamente.";
  return "No pudimos leer la tarjeta.";
}

export function scorecardLocalPersistenceWarning(failedPhotoCount: number) {
  return failedPhotoCount > 0
    ? "No pude guardar una copia local de esta foto, pero sí puedo analizarla."
    : "";
}
