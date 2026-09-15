import sharp from "sharp";
import {
  MAX_GENERATED_AVATAR_BYTES,
  MAX_GENERATED_AVATAR_DATA_URL_LENGTH,
  decodeAvatarDataUrl,
} from "./avatar-generation";

export const GENERATED_AVATAR_SIZE = 512;
export const MAX_PERSISTABLE_AVATAR_DATA_URL_LENGTH = 180_000;
const MAX_PERSISTABLE_AVATAR_BYTES = 134_900;
const MAX_SOURCE_PIXELS = 16_000_000;

/** Decode, orient, center-crop and compress the provider image before it can
 * be signed or returned to the browser. This is a real image transform, not a
 * MIME/header-only check. Sharp strips metadata by default. */
export async function optimizeGeneratedAvatarDataUrl(value: string): Promise<string> {
  const source = decodeAvatarDataUrl(value, MAX_GENERATED_AVATAR_DATA_URL_LENGTH, MAX_GENERATED_AVATAR_BYTES);
  if (!source) throw new Error("invalid_provider_image");
  const pipeline = sharp(source.bytes, { limitInputPixels: MAX_SOURCE_PIXELS, failOn: "error" });
  const metadata = await pipeline.metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_SOURCE_PIXELS
    || (metadata.pages || 1) !== 1 || !["jpeg", "png", "webp"].includes(metadata.format || "")) {
    throw new Error("invalid_provider_image_dimensions");
  }
  const square = pipeline.rotate().resize(GENERATED_AVATAR_SIZE, GENERATED_AVATAR_SIZE, {
    fit: "cover",
    position: "centre",
    withoutEnlargement: false,
  });
  for (const quality of [84, 76, 68, 60, 52, 44, 36, 28]) {
    const { data, info } = await square.clone().webp({ quality, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (info.format !== "webp" || info.width !== GENERATED_AVATAR_SIZE || info.height !== GENERATED_AVATAR_SIZE) {
      throw new Error("invalid_optimized_image");
    }
    if (data.length > MAX_PERSISTABLE_AVATAR_BYTES) continue;
    const result = `data:image/webp;base64,${data.toString("base64")}`;
    if (result.length > MAX_PERSISTABLE_AVATAR_DATA_URL_LENGTH
      || !decodeAvatarDataUrl(result, MAX_PERSISTABLE_AVATAR_DATA_URL_LENGTH, MAX_PERSISTABLE_AVATAR_BYTES)) {
      throw new Error("invalid_optimized_image");
    }
    return result;
  }
  throw new Error("image_optimization_budget_exceeded");
}
