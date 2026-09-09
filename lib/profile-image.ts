export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_IMAGE_MAX_DATA_URL_LENGTH = 180_000;

export async function profileImageFromFile(file: File, size = 192): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("image_type");
  if (file.size > PROFILE_IMAGE_MAX_BYTES) throw new Error("image_size");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image_open"));
    });
    const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("image_canvas");
    context.drawImage(image, 0, 0, width, height);
    const webp = canvas.toDataURL("image/webp", .76);
    const encoded = webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", .78);
    if (encoded.length > PROFILE_IMAGE_MAX_DATA_URL_LENGTH) throw new Error("image_encoded_size");
    return encoded;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function profileImageErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "image_type") return "Elige una imagen JPEG, PNG o WebP.";
  if (code === "image_size" || code === "image_encoded_size") return "La imagen es demasiado grande. Elige una de máximo 5 MB.";
  return "No pude abrir esa imagen. Intenta con otra foto.";
}
