import { createHash, timingSafeEqual } from "node:crypto";
import type { GeneratedImage } from "./avatar-generation";

type UploadAttempt = { path: string | null; error: unknown };

/** A retry with the *same signed proof* uses the same object path. If an
 * upload response was lost, never overwrite or infer success from a public
 * URL: download that exact object and compare its bytes to the signed image. */
export async function reconcileGeneratedAvatarUpload(
  path: string,
  image: GeneratedImage,
  deps: {
    upload: () => Promise<UploadAttempt>;
    download: () => Promise<Buffer | null>;
    publicUrl: () => string;
  },
) {
  let attempt: UploadAttempt | null = null;
  try { attempt = await deps.upload(); } catch { /* A timeout may follow a completed upload. */ }
  if (attempt?.error === null && attempt.path === path) return { path, publicUrl: deps.publicUrl() };
  let existing: Buffer | null = null;
  try { existing = await deps.download(); } catch { /* Never trust an unverified existing object. */ }
  if (!existing || existing.length !== image.bytes.length || existing.length > 134_900) {
    throw new Error("avatar_storage_upload_unconfirmed");
  }
  const observed = createHash("sha256").update(existing).digest();
  const expected = Buffer.from(image.hash, "hex");
  if (!timingSafeEqual(observed, expected)) throw new Error("avatar_storage_image_mismatch");
  return { path, publicUrl: deps.publicUrl() };
}
