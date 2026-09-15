export const PROFILE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
// Keep this in lockstep with validateProfileAvatarUrl in account-state.ts.
export const PROFILE_IMAGE_MAX_DATA_URL_LENGTH = 180_000;

export type SquareCropRect = { sourceX: number; sourceY: number; sourceSize: number };
export type ProfileImageFormat = "jpeg" | "png" | "webp" | "heic" | "heif";

/** Center-crop geometry shared by all supported source formats. */
export function squareCropRect(width: number, height: number): SquareCropRect {
  const safeWidth = Math.max(1, Math.trunc(width));
  const safeHeight = Math.max(1, Math.trunc(height));
  const sourceSize = Math.min(safeWidth, safeHeight);
  return {
    sourceX: Math.max(0, Math.floor((safeWidth - sourceSize) / 2)),
    sourceY: Math.max(0, Math.floor((safeHeight - sourceSize) / 2)),
    sourceSize,
  };
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** MIME alone is user-controlled metadata. Confirm the container signature too. */
export function profileImageFormatFromBytes(bytes: Uint8Array): ProfileImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  if (bytes.length >= 16 && ascii(bytes, 4, 4) === "ftyp") {
    // HEIC/HEIF are ISO-BMFF containers. Require a known image brand and
    // reject AVIF/video even when they share a structural mif1 brand.
    const heicBrands = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
    const boxSize = (bytes[0] * 0x1000000 + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]) >>> 0;
    if (boxSize < 16) return null;
    const boxEnd = Math.min(bytes.length, boxSize);
    const brands: string[] = [];
    for (let index = 8; index + 4 <= boxEnd; index += 4) {
      if (index === 12) continue; // minor version, not a brand
      brands.push(ascii(bytes, index, 4));
    }
    if (brands.some(brand => brand === "avif" || brand === "avis")) return null;
    if (brands.some(brand => heicBrands.has(brand))) return "heic";
    // Generic HEIF can use a non-HEVC codec. Accept its still-image brand
    // only when the browser subsequently decodes it successfully.
    if (brands[0] === "mif1" && brands.slice(1).includes("mif1")) return "heif";
  }
  return null;
}

const SOURCE_MIME: Record<ProfileImageFormat, ReadonlySet<string>> = {
  jpeg: new Set(["image/jpeg", "image/jpg"]),
  png: new Set(["image/png"]),
  webp: new Set(["image/webp"]),
  heic: new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]),
  heif: new Set(["image/heif", "image/heif-sequence"]),
};

/** Empty MIME is common with iOS file transfers; bytes still have to match. */
export function profileImageFormatForFile(mime: string, bytes: Uint8Array): ProfileImageFormat {
  const format = profileImageFormatFromBytes(bytes);
  if (!format) throw new Error("image_content");
  if (mime && !SOURCE_MIME[format].has(mime.toLowerCase())) throw new Error("image_type");
  return format;
}

type DrawableImage = CanvasImageSource & { width: number; height: number; close?: () => void };

async function decodedProfileImage(file: File, objectUrl: string, format: ProfileImageFormat): Promise<DrawableImage> {
  if (typeof createImageBitmap === "function") {
    try {
      // Let the native decoder apply EXIF exactly once. Manual EXIF rotation
      // here would double-rotate on modern phone browsers.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Some Safari versions reject the option or HEIC bitmap decoding yet
      // can still load the image through HTMLImageElement.
    }
  }
  const isHeif = format === "heic" || format === "heif";
  if (typeof Image !== "function") throw new Error(isHeif ? "image_heic_unsupported" : "image_open");
  const image = new Image();
  image.decoding = "async";
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(isHeif ? "image_heic_unsupported" : "image_open"));
      // Install handlers before src; cached object URLs can load immediately.
      image.src = objectUrl;
    });
    return Object.assign(image, { width: image.naturalWidth, height: image.naturalHeight });
  } finally {
    image.onload = null;
    image.onerror = null;
  }
}

const OUTPUT_QUALITIES = [.84, .76, .68, .60, .52, .44, .36, .28];

/** Browsers may silently return PNG for unsupported WebP/JPEG. Never persist
 * that fallback as if it were the requested compressed format. */
export function compressedProfileImageDataUrl(canvas: Pick<HTMLCanvasElement, "toDataURL">): string {
  for (const type of ["image/webp", "image/jpeg"] as const) {
    for (const quality of OUTPUT_QUALITIES) {
      const encoded = canvas.toDataURL(type, quality);
      if (!encoded.startsWith(`data:${type};base64,`)) break;
      if (encoded.length <= PROFILE_IMAGE_MAX_DATA_URL_LENGTH) return encoded;
    }
  }
  throw new Error("image_encoded_size");
}

export async function profileImageFromFile(file: File, size = 512): Promise<string> {
  if (file.size > PROFILE_IMAGE_MAX_BYTES) throw new Error("image_size");
  if (file.size === 0) throw new Error("image_content");
  const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const format = profileImageFormatForFile(file.type, header);

  const objectUrl = URL.createObjectURL(file);
  let image: DrawableImage | null = null;
  try {
    image = await decodedProfileImage(file, objectUrl, format);
    if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > 80_000_000) throw new Error("image_dimensions");
    const crop = squareCropRect(image.width, image.height);
    const outputSize = Number.isFinite(size) ? Math.max(64, Math.min(512, Math.trunc(size))) : 512;
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("image_canvas");
    // JPEG fallback needs an opaque background for transparent PNG/WebP.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outputSize, outputSize);
    context.drawImage(image, crop.sourceX, crop.sourceY, crop.sourceSize, crop.sourceSize, 0, 0, outputSize, outputSize);
    return compressedProfileImageDataUrl(canvas);
  } finally {
    image?.close?.();
    URL.revokeObjectURL(objectUrl);
  }
}

export function profileImageErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "image_size") return "Esta imagen es demasiado grande. Elige una imagen menor a 20 MB.";
  if (code === "image_type") return "Elige una imagen JPEG, PNG, WebP o HEIC/HEIF compatible con este navegador.";
  if (code === "image_content") return "El archivo no parece contener una imagen válida. Elige otra foto.";
  if (code === "image_heic_unsupported") return "Este navegador no puede abrir esta foto HEIC/HEIF. Elige JPEG, PNG o WebP.";
  if (code === "image_dimensions") return "Esta foto tiene una resolución demasiado grande o inválida. Elige otra imagen.";
  if (code === "image_encoded_size") return "No pudimos comprimir esta foto para guardarla en tu perfil. Elige otra imagen.";
  if (code === "image_canvas") return "Este navegador no pudo procesar la foto. Intenta con otra imagen.";
  return "No pudimos abrir esa imagen. Intenta con otra foto.";
}
