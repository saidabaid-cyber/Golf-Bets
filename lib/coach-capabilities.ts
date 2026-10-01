/** Unavailable engines are explicit; these flags never manufacture results. */
export const COACH_CAPABILITIES = {
  swingAnalysis: false,
  drills: false,
  trainingRecommendations: false,
} as const;
