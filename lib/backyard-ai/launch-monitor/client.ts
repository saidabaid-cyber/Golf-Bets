import { blobToDataUrl } from "../client-api";
import { compressScorecardPhoto } from "../../scorecard-photo";
import {
  MAX_SCORECARD_TOTAL_DATA_URL_LENGTH,
  MAX_SCORECARD_TOTAL_IMAGE_BYTES,
  scorecardImageByteBudget,
} from "../scorecard/limits";

export const MIN_LAUNCH_MONITOR_PHOTOS = 2;
export const MAX_LAUNCH_MONITOR_PHOTOS = 4;

export type LaunchMonitorClientPhoto = { id: string; file: File };

/** Launch-monitor photos are prepared only in memory. Saving the reviewed
 * numeric session is explicit; raw screens never become a storage dependency. */
export async function prepareLaunchMonitorPhotos(
  photos: readonly LaunchMonitorClientPhoto[],
  dependencies: {
    compress?: (file: File, maxBytes?: number) => Promise<Blob>;
    encode?: (blob: Blob) => Promise<string>;
  } = {},
) {
  if (photos.length < MIN_LAUNCH_MONITOR_PHOTOS || photos.length > MAX_LAUNCH_MONITOR_PHOTOS) {
    throw new Error("Selecciona de 2 a 4 fotos del launch monitor.");
  }
  const compress = dependencies.compress || ((file: File, maxBytes?: number) => compressScorecardPhoto(file, { maxBytes }));
  const encode = dependencies.encode || blobToDataUrl;
  const perPhotoBudget = scorecardImageByteBudget(photos.length);
  const prepared = await Promise.all(photos.map(async (photo) => {
    const blob = await compress(photo.file, perPhotoBudget);
    if (!blob.size || blob.size > perPhotoBudget) throw new Error("Una foto supera el tamaño permitido.");
    return { id: photo.id, dataUrl: await encode(blob) };
  }));
  const totalDataUrlLength = prepared.reduce((total, photo) => total + photo.dataUrl.length, 0);
  const estimatedBytes = prepared.reduce((total, photo) => {
    const encoded = photo.dataUrl.split(",", 2)[1] || "";
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    return total + Math.max(0, encoded.length / 4 * 3 - padding);
  }, 0);
  if (totalDataUrlLength > MAX_SCORECARD_TOTAL_DATA_URL_LENGTH || estimatedBytes > MAX_SCORECARD_TOTAL_IMAGE_BYTES) {
    throw new Error("Las fotos superan el tamaño permitido.");
  }
  return prepared;
}
