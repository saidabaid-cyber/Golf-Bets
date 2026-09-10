export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_IMAGE_MAX_DATA_URL_LENGTH = 180_000;

export type SquareCropRect = { sourceX: number; sourceY: number; sourceSize: number };

/** Center-crop geometry shared by JPEG/PNG/WebP and covered without needing a DOM. */
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

type DrawableImage = CanvasImageSource & { width: number; height: number; close?: () => void };

async function decodedProfileImage(file: File, objectUrl: string): Promise<DrawableImage> {
  if (typeof createImageBitmap === "function") {
    try {
      // `from-image` keeps phone orientation metadata when the browser exposes it.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Mobile Safari versions differ here. HTMLImageElement is the safe path.
    }
  }
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("image_open"));
  });
  return Object.assign(image, { width: image.naturalWidth, height: image.naturalHeight });
}

export async function profileImageFromFile(file: File, size = 192): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("image_type");
  if (file.size > PROFILE_IMAGE_MAX_BYTES) throw new Error("image_size");
  const objectUrl = URL.createObjectURL(file);
  let image: DrawableImage | null = null;
  try {
    image = await decodedProfileImage(file, objectUrl);
    const crop = squareCropRect(image.width, image.height);
    const outputSize = Math.max(64, Math.min(512, Math.trunc(size)));
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("image_canvas");
    context.drawImage(image, crop.sourceX, crop.sourceY, crop.sourceSize, crop.sourceSize, 0, 0, outputSize, outputSize);
    const webp = canvas.toDataURL("image/webp", .76);
    const encoded = webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", .78);
    if (encoded.length > PROFILE_IMAGE_MAX_DATA_URL_LENGTH) throw new Error("image_encoded_size");
    return encoded;
  } finally {
    image?.close?.();
    URL.revokeObjectURL(objectUrl);
  }
}

export function profileImageErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "image_type") return "Elige una imagen JPEG, PNG o WebP.";
  if (code === "image_size" || code === "image_encoded_size") return "La imagen es demasiado grande. Elige una de máximo 5 MB.";
  return "No pude abrir esa imagen. Intenta con otra foto.";
}
