export type PhotoAvatarGenerationRequest = {
  sourceImageDataUrl: string;
  style: "backyard-premium-portrait";
};

export type PhotoAvatarGenerationResult = {
  avatarDataUrl: string;
  provider: string;
  model: string;
};

/** No image-generation provider/model is configured and verified today. */
export const PHOTO_AVATAR_GENERATION_CAPABILITY = {
  available: false,
  reason: "provider_not_configured",
} as const;
