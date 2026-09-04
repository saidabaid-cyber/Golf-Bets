import type { Session } from "@supabase/supabase-js";

export type AuthFlowClient = {
  signInWithOtp: (input: { email: string; options: { shouldCreateUser: boolean; emailRedirectTo: string } }) => Promise<{ error: unknown }>;
  verifyOtp: (input: { email: string; token: string; type: "email" }) => Promise<{ data: { session: Session | null }; error: unknown }>;
  signInWithOAuth: (input: { provider: "google" | "apple"; options: { redirectTo: string; queryParams?: Record<string, string> } }) => Promise<{ error: unknown }>;
  getSession: () => Promise<{ data: { session: Session | null }; error: unknown }>;
  signOut: (options?: { scope: "global" | "local" }) => Promise<{ error: unknown }>;
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
  const results = await Promise.allSettled(Array.from(writes));
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
    throwIfError(result.value.error);
  }
}

export async function sendEmailOtp(auth: AuthFlowClient, email: string, redirectTo: string) {
  const result = await auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: redirectTo } });
  throwIfError(result.error);
}

export async function verifyEmailOtp(auth: AuthFlowClient, email: string, token: string) {
  if (!/^\d{8}$/.test(token)) throw new Error("invalid otp");
  const result = await auth.verifyOtp({ email: email.trim(), token, type: "email" });
  throwIfError(result.error);
  if (!isAccountSession(result.data.session)) throw new Error("account_session_missing");
  const session = await restoreAuthSession(auth);
  if (!session || session.user.id !== result.data.session.user.id || session.user.email?.toLowerCase() !== email.trim().toLowerCase()) throw new Error("account_session_missing");
  return session;
}

export async function startSocialOAuth(auth: AuthFlowClient, provider: "google" | "apple", redirectTo: string) {
  const options = provider === "google" ? { redirectTo, queryParams: { prompt: "select_account" } } : { redirectTo };
  const result = await auth.signInWithOAuth({ provider, options });
  throwIfError(result.error);
}

export async function restoreAuthSession(auth: AuthFlowClient) {
  const result = await auth.getSession();
  throwIfError(result.error);
  if (result.data.session && !isAccountSession(result.data.session)) throw new Error("account_session_missing");
  return result.data.session;
}

/** UI gate only. Authorization remains server-side/JWT + RLS, never this predicate. */
export function isAccountSession(session: Session | null): session is Session {
  return Boolean(session?.user?.id && session.user.id !== "guest" && !session.user.is_anonymous &&
    session.access_token?.trim() && session.refresh_token?.trim() &&
    typeof session.expires_at === "number" && session.expires_at * 1000 > Date.now());
}

export async function closeAuthSession(auth: AuthFlowClient) {
  // Default/global sign-out revokes refresh sessions at Supabase instead of
  // merely hiding the token in this browser. Local workspace data is managed
  // separately and is never removed by this operation.
  const result = await auth.signOut();
  throwIfError(result.error);
}

/** The Auth user has already been deleted server-side. This local cleanup must
 * not fail just because that now-invalid token can no longer reach Auth. */
export async function clearDeletedAuthSession(auth: AuthFlowClient) {
  try { await auth.signOut({ scope: "local" }); } catch { /* local state still clears in the provider */ }
}

export const OTP_COOLDOWN_KEY = "backyard-otp-next-send-v1";
export function otpRetrySeconds(nextSendAt: number, now = Date.now()) { return Math.max(0, Math.ceil((nextSendAt - now) / 1000)); }
export class OtpSendGate {
  pending = false;
  nextSendAt = 0;
  begin(now = Date.now()) {
    if (this.pending || otpRetrySeconds(this.nextSendAt, now)) return false;
    this.pending = true;
    this.nextSendAt = now + 60_000;
    return true;
  }
  finish() { this.pending = false; }
}
