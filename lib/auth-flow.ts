import type { Session } from "@supabase/supabase-js";

export type AuthFlowClient = {
  signInWithOtp: (input: { email: string; options: { shouldCreateUser: boolean; emailRedirectTo: string } }) => Promise<{ error: unknown }>;
  verifyOtp: (input: { email: string; token: string; type: "email" }) => Promise<{ data: { session: Session | null }; error: unknown }>;
  signInWithOAuth: (input: { provider: "google" | "apple"; options: { redirectTo: string } }) => Promise<{ error: unknown }>;
  getSession: () => Promise<{ data: { session: Session | null }; error: unknown }>;
  signOut: () => Promise<{ error: unknown }>;
};

function throwIfError(error: unknown) {
  if (error) throw error;
}

/** TOKEN_REFRESHED/SIGNED_IN may repeat for the same user (focus, OTP callback).
 * Only a different identity restarts onboarding/cloud hydration. */
export function authIdentityChanged(currentUserId: string | null, nextUserId: string) {
  return currentUserId !== nextUserId;
}

export async function requireCloudWrites(writes: ArrayLike<PromiseLike<{ error: unknown }>>) {
  const results = await Promise.all(Array.from(writes));
  for (const result of results) throwIfError(result.error);
}

export async function sendEmailOtp(auth: AuthFlowClient, email: string, redirectTo: string) {
  const result = await auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: redirectTo } });
  throwIfError(result.error);
}

export async function verifyEmailOtp(auth: AuthFlowClient, email: string, token: string) {
  const result = await auth.verifyOtp({ email: email.trim(), token, type: "email" });
  throwIfError(result.error);
  if (!result.data.session) throw new Error("invalid otp session");
  return result.data.session;
}

export async function startSocialOAuth(auth: AuthFlowClient, provider: "google" | "apple", redirectTo: string) {
  const result = await auth.signInWithOAuth({ provider, options: { redirectTo } });
  throwIfError(result.error);
}

export async function restoreAuthSession(auth: AuthFlowClient) {
  const result = await auth.getSession();
  throwIfError(result.error);
  return result.data.session;
}

export async function closeAuthSession(auth: AuthFlowClient) {
  const result = await auth.signOut();
  throwIfError(result.error);
}
