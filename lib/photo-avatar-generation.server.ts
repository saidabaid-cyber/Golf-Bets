import "server-only";

import { Buffer } from "node:buffer";
import OpenAI, { toFile } from "openai";

import {
  MAX_GENERATED_AVATAR_DATA_URL_LENGTH,
  MAX_PHOTO_AVATAR_SOURCE_DATA_URL_LENGTH,
  MAX_PHOTO_AVATAR_VARIANTS,
} from "./photo-avatar-generation";
import { profileImageFormatFromBytes } from "./profile-image";

export type ParsedPhotoAvatarSource = {
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
};

type PhotoAvatarImageResponse = {
  data?: Array<{ b64_json?: string }>;
  output_format?: "jpeg" | "png" | "webp";
};

export type PhotoAvatarImageClient = {
  images: {
    edit: (params: Record<string, unknown>) => Promise<PhotoAvatarImageResponse>;
  };
};

const SOURCE_FORMATS = {
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  png: { mimeType: "image/png", extension: "png" },
  webp: { mimeType: "image/webp", extension: "webp" },
} as const;

export function parsePhotoAvatarSourceDataUrl(value: unknown): ParsedPhotoAvatarSource | null {
  if (typeof value !== "string" || value.length > MAX_PHOTO_AVATAR_SOURCE_DATA_URL_LENGTH) return null;
  const match = /^data:image\/(jpeg|png|webp);base64,([a-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return null;
  const encoded = match[2];
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.toString("base64") !== encoded) return null;
  const detected = profileImageFormatFromBytes(bytes);
  const declared = match[1].toLocaleLowerCase("en-US") as keyof typeof SOURCE_FORMATS;
  if (detected !== declared) return null;
  return { bytes, ...SOURCE_FORMATS[declared] };
}

export function premiumGolfAvatarPrompt(variant: number) {
  const variation = [
    "Use a warm neutral studio backdrop with a restrained green accent.",
    "Use a softly blurred golf-course backdrop with natural morning light.",
    "Use a minimal deep-green backdrop with subtle depth and no graphic marks.",
  ][Math.max(0, Math.min(MAX_PHOTO_AVATAR_VARIANTS - 1, variant - 1))];
  return [
    "Transform the supplied portrait into a premium illustrated golf avatar.",
    "Preserve the same person's recognizable identity: facial structure, skin tone, eyes, hair, age range and distinctive features.",
    "Create an adult, natural, friendly head-and-shoulders portrait with consistent 2.5D modern illustration, soft lighting and realistic proportions.",
    "A tasteful generic golf polo or quarter-zip is acceptable. Do not add any real brand, logo, text or trademark.",
    "Avoid childish styling, grotesque exaggeration, face distortion, beauty-filter identity changes, extra people, extra limbs or busy scenery.",
    "Center the face with enough safe margin for a circular profile crop. The final image must be a square avatar.",
    variation,
    `This is visual variant ${variant}; vary lighting, clothing color or background treatment, never the person's identity.`,
  ].join("\n");
}

export async function generatePremiumGolfAvatar(input: {
  apiKey: string;
  model: string;
  source: ParsedPhotoAvatarSource;
  variant: number;
  userHash: string;
  client?: PhotoAvatarImageClient;
}) {
  const client = input.client ?? new OpenAI({
    apiKey: input.apiKey,
    timeout: 110_000,
    maxRetries: 1,
  }) as unknown as PhotoAvatarImageClient;
  const image = await toFile(input.source.bytes, `profile-reference.${input.source.extension}`, { type: input.source.mimeType });
  const result = await client.images.edit({
    model: input.model,
    image,
    prompt: premiumGolfAvatarPrompt(input.variant),
    input_fidelity: "high",
    quality: "medium",
    size: "1024x1024",
    background: "opaque",
    output_format: "webp",
    output_compression: 72,
    n: 1,
    user: input.userHash,
  });
  const encoded = result.data?.length === 1 ? result.data[0]?.b64_json : undefined;
  if (!encoded || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) {
    throw Object.assign(new Error("invalid_image_output"), { code: "invalid_image_output" });
  }
  const format = result.output_format === "jpeg" || result.output_format === "png" || result.output_format === "webp"
    ? result.output_format
    : "webp";
  const avatarDataUrl = `data:image/${format};base64,${encoded}`;
  if (avatarDataUrl.length > MAX_GENERATED_AVATAR_DATA_URL_LENGTH) {
    throw Object.assign(new Error("image_output_too_large"), { code: "image_output_too_large" });
  }
  return avatarDataUrl;
}
