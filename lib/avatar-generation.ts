import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const AVATAR_GENERATION_CONSENT_VERSION = "avatar-generation-v1";
export const MAX_AVATAR_DESCRIPTION_LENGTH = 1_000;
export const MAX_AVATAR_REFERENCE_DATA_URL_LENGTH = 180_000;
export const MAX_GENERATED_AVATAR_BYTES = 2_000_000;
export const MAX_GENERATED_AVATAR_DATA_URL_LENGTH = 2_700_000;
export const GENERATION_TOKEN_TTL_MS = 10 * 60_000;

export const AVATAR_STYLES = ["realistic", "illustrated", "cartoon", "minimalist"] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];
export type AvatarSource = "description" | "photo";
export type AvatarMime = "image/jpeg" | "image/png" | "image/webp";

export type AvatarGenerationConfig = {
  available: boolean;
  missing: string[];
  model: string;
  signingSecret: string;
  bucket: string;
  supabaseOrigin: string;
  apiKey: string;
};

export type GenerateAvatarRequest = {
  source: AvatarSource;
  description: string;
  style: AvatarStyle;
  photoDataUrl?: string;
};

export type GeneratedImage = {
  dataUrl: string;
  bytes: Buffer;
  mime: AvatarMime;
  extension: "jpeg" | "png" | "webp";
  hash: string;
};

export type GenerationProof = {
  v: 1;
  uid: string;
  aid: string;
  src: AvatarSource;
  mime: AvatarMime;
  hash: string;
  exp: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function configuredOrigin(value: string | undefined) {
  try {
    const parsed = new URL(value?.trim() || "");
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      && !parsed.search && !parsed.hash && (parsed.pathname === "/" || parsed.pathname === "")
      ? parsed.origin : "";
  } catch { return ""; }
}

/** Production never opts in implicitly. Preview must bind both the avatar
 * storage project and the existing AI consent ledger to its isolated URL. */
export function avatarGenerationConfig(env: Record<string, string | undefined>): AvatarGenerationConfig {
  const missing: string[] = [];
  const apiKey = env.OPENAI_API_KEY?.trim() || "";
  const model = env.OPENAI_AVATAR_IMAGE_MODEL?.trim() || "";
  const signingSecret = env.BACKYARD_AVATAR_SIGNING_SECRET?.trim() || "";
  const bucket = env.BACKYARD_AVATAR_STORAGE_BUCKET?.trim() || "";
  const supabaseOrigin = configuredOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const storagePreviewOrigin = configuredOrigin(env.BACKYARD_AVATAR_PREVIEW_SUPABASE_URL);
  const consentPreviewOrigin = configuredOrigin(env.BACKYARD_AI_CONSENT_PREVIEW_SUPABASE_URL);
  if (env.VERCEL_ENV !== "preview") missing.push("VERCEL_ENV=preview");
  if (!/^(?:1|true|on|yes)$/i.test(env.BACKYARD_AVATAR_GENERATION_ENABLED?.trim() || "")) missing.push("BACKYARD_AVATAR_GENERATION_ENABLED");
  if (!apiKey) missing.push("OPENAI_API_KEY");
  if (!/^(?:gpt-image-[a-z0-9][a-z0-9.-]*|chatgpt-image-latest)$/i.test(model) || model.length > 120) missing.push("OPENAI_AVATAR_IMAGE_MODEL");
  if (Buffer.byteLength(signingSecret, "utf8") < 32) missing.push("BACKYARD_AVATAR_SIGNING_SECRET");
  if (!supabaseOrigin) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() && !env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!env.SUPABASE_SECRET_KEY?.trim() && !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) missing.push("SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY");
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket)) missing.push("BACKYARD_AVATAR_STORAGE_BUCKET");
  if (!storagePreviewOrigin || storagePreviewOrigin !== supabaseOrigin) missing.push("BACKYARD_AVATAR_PREVIEW_SUPABASE_URL");
  if (!consentPreviewOrigin || consentPreviewOrigin !== supabaseOrigin) missing.push("BACKYARD_AI_CONSENT_PREVIEW_SUPABASE_URL");
  if (["0", "false", "off", "no"].includes(env.CLOUD_ENABLED?.trim().toLowerCase() || "")) missing.push("CLOUD_ENABLED");
  return { available: missing.length === 0, missing, model, signingSecret, bucket, supabaseOrigin, apiKey };
}

export function parseGenerateAvatarRequest(value: unknown): GenerateAvatarRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!Object.keys(source).every(key => ["source", "description", "style", "photoDataUrl", "consent", "consentVersion"].includes(key))) return null;
  if (source.consent !== true || source.consentVersion !== AVATAR_GENERATION_CONSENT_VERSION) return null;
  if (source.source !== "description" && source.source !== "photo") return null;
  if (!AVATAR_STYLES.includes(source.style as AvatarStyle)) return null;
  if (typeof source.description !== "string" || source.description.length > MAX_AVATAR_DESCRIPTION_LENGTH) return null;
  const description = source.description.trim();
  if (source.source === "description") {
    if (description.length < 1 || source.photoDataUrl !== undefined) return null;
    return { source: "description", description, style: source.style as AvatarStyle };
  }
  if (!decodeAvatarDataUrl(source.photoDataUrl, MAX_AVATAR_REFERENCE_DATA_URL_LENGTH, 140_000)) return null;
  return { source: "photo", description, style: source.style as AvatarStyle, photoDataUrl: source.photoDataUrl as string };
}

export function parseUseAvatarRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (!Object.keys(source).every(key => ["imageDataUrl", "generationToken", "consentVersion"].includes(key))) return null;
  if (source.consentVersion !== AVATAR_GENERATION_CONSENT_VERSION || typeof source.generationToken !== "string") return null;
  const image = decodeAvatarDataUrl(source.imageDataUrl, MAX_GENERATED_AVATAR_DATA_URL_LENGTH, MAX_GENERATED_AVATAR_BYTES);
  return image ? { image, token: source.generationToken } : null;
}

function hasValidImageContainer(mime: AvatarMime, bytes: Buffer) {
  if (mime === "image/jpeg") return bytes.length >= 6 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  if (mime === "image/png") return bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && bytes.toString("ascii", 12, 16) === "IHDR" && bytes.toString("ascii", bytes.length - 8, bytes.length - 4) === "IEND";
  return bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16))
    && bytes.readUInt32LE(4) === bytes.length - 8;
}

/** MIME, base64 and bytes all have to agree; no remote URL can be submitted
 * as a source photo or as a supposedly generated image. */
export function decodeAvatarDataUrl(value: unknown, maxLength: number, maxBytes: number): GeneratedImage | null {
  if (typeof value !== "string" || value.length > maxLength) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match || !match[2] || match[2].length % 4 !== 0) return null;
  const mime = match[1].toLowerCase() as AvatarMime;
  const estimatedBytes = Math.floor(match[2].length * 3 / 4);
  if (estimatedBytes > maxBytes + 2) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > maxBytes || bytes.toString("base64") !== match[2] || !hasValidImageContainer(mime, bytes)) return null;
  const extension = mime.slice("image/".length) as GeneratedImage["extension"];
  return { dataUrl: value, bytes, mime, extension, hash: createHash("sha256").update(bytes).digest("hex") };
}

function proofPayloadValid(value: unknown): value is GenerationProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proof = value as Record<string, unknown>;
  return Object.keys(proof).length === 7 && ["v", "uid", "aid", "src", "mime", "hash", "exp"].every(key => Object.hasOwn(proof, key))
    && proof.v === 1 && typeof proof.uid === "string" && UUID_PATTERN.test(proof.uid)
    && typeof proof.aid === "string" && UUID_PATTERN.test(proof.aid)
    && (proof.src === "description" || proof.src === "photo")
    && ["image/jpeg", "image/png", "image/webp"].includes(proof.mime as string)
    && typeof proof.hash === "string" && /^[0-9a-f]{64}$/.test(proof.hash)
    && typeof proof.exp === "number" && Number.isSafeInteger(proof.exp);
}

export function createGenerationToken(proof: GenerationProof, secret: string) {
  if (!proofPayloadValid(proof) || Buffer.byteLength(secret, "utf8") < 32) throw new Error("invalid_generation_proof_config");
  const payload = Buffer.from(JSON.stringify(proof), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGenerationToken(token: string, secret: string, userId: string, image: GeneratedImage, now = Date.now()): GenerationProof | null {
  if (typeof token !== "string" || token.length > 1_500 || Buffer.byteLength(secret, "utf8") < 32) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let proof: unknown;
  try { proof = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
  if (!proofPayloadValid(proof)) return null;
  return proof.uid === userId && proof.hash === image.hash && proof.mime === image.mime
    && proof.exp > now && proof.exp <= now + GENERATION_TOKEN_TTL_MS
    ? proof : null;
}

export function generatedAvatarPath(userId: string, assetId: string, extension: GeneratedImage["extension"]) {
  if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(assetId) || !["webp", "png", "jpeg"].includes(extension)) throw new Error("invalid_generated_avatar_path");
  return `generated-avatar/${userId}/${assetId}.${extension}`;
}

/** getPublicUrl is only a constructor. Compare it with the expected bucket,
 * origin and path; it is never accepted as an arbitrary client-provided URL. */
export function canonicalGeneratedAvatarUrl(publicUrl: string, origin: string, bucket: string, path: string) {
  try {
    const actual = new URL(publicUrl);
    const expected = new URL(`${origin}/storage/v1/object/public/${encodeURIComponent(bucket)}/${path}`);
    return actual.origin === expected.origin && actual.pathname === expected.pathname
      && actual.protocol === "https:" && !actual.username && !actual.password && !actual.search && !actual.hash
      ? actual.toString() : null;
  } catch { return null; }
}
