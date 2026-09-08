export const MAX_SCORECARD_PHOTOS = 4;
/** Vercel Functions reject request bodies above 4.5 MB. Keep enough room for
 * JSON, consent and round hints instead of treating that infrastructure limit
 * as usable image capacity. */
export const MAX_SCORECARD_REQUEST_BYTES = 4_250_000;
export const MAX_SCORECARD_TOTAL_DATA_URL_LENGTH = 3_950_000;
export const MAX_SCORECARD_TOTAL_IMAGE_BYTES = 2_950_000;
export const MAX_SCORECARD_DATA_URL_LENGTH = MAX_SCORECARD_TOTAL_DATA_URL_LENGTH;
export const MAX_SCORECARD_IMAGE_BYTES = MAX_SCORECARD_TOTAL_IMAGE_BYTES;
export const MAX_SCORECARD_PHOTO_ID_LENGTH = 180;

/** Splits the total binary budget across the selected photos. One photo keeps
 * substantially more detail; a four-photo scan is compressed more strongly so
 * its combined base64 payload still fits the same request. */
export function scorecardImageByteBudget(photoCount: number) {
  const safeCount = Number.isFinite(photoCount)
    ? Math.min(MAX_SCORECARD_PHOTOS, Math.max(1, Math.trunc(photoCount)))
    : 1;
  return Math.floor(MAX_SCORECARD_TOTAL_IMAGE_BYTES / safeCount);
}
