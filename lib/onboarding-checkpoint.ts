import { normalizeBetaOnboardingProgress, type BetaOnboardingProgress } from './beta-onboarding';
// UX progress only. This metadata never grants access, consent or entitlements.
export const ONBOARDING_CHECKPOINT_KEY = 'backyard_onboarding_checkpoint_v1';
export function onboardingCheckpoint(value: unknown, userId: string) {
  return normalizeBetaOnboardingProgress(value, userId);
}
export async function saveOnboardingCheckpoint(token: string, progress: BetaOnboardingProgress) {
  const response = await fetch('/api/account/onboarding', {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(progress), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('No pudimos guardar tu avance en la cuenta. Reintenta; tus respuestas siguen aquí.');
}
