export const ADMIN_DOCUMENT_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export type AdminDocumentMimeType = (typeof ADMIN_DOCUMENT_MIME_TYPES)[number];

function starts(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export function validateAdminDocument(bytes: Uint8Array, mimeType: string, sizeLimit = 10 * 1024 * 1024) {
  if (bytes.byteLength === 0 || bytes.byteLength > sizeLimit) return { ok: false as const, code: "INVALID_SIZE" };
  if (!(ADMIN_DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) return { ok: false as const, code: "INVALID_MIME" };
  const valid = mimeType === "application/pdf" ? starts(bytes, [0x25, 0x50, 0x44, 0x46])
    : mimeType === "image/png" ? starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : mimeType === "image/jpeg" ? starts(bytes, [0xff, 0xd8, 0xff])
        : starts(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return valid ? { ok: true as const, mimeType: mimeType as AdminDocumentMimeType } : { ok: false as const, code: "MAGIC_BYTES_MISMATCH" };
}

