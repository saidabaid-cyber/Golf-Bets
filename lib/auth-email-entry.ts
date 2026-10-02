export type EmailEntryIntent = "login" | "create";

export const EMAIL_RATE_LIMIT_MESSAGE = "Has solicitado varios códigos. Espera un momento antes de intentar nuevamente.";

/** Preserve provider rate-limit semantics without exposing provider diagnostics. */
export function emailOtpFailure(error: unknown) {
  const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const limited = detail.status === 429 || ["over_email_send_rate_limit", "over_request_rate_limit"].includes(String(detail.code));
  return limited
    ? { status: 429, code: "RATE_LIMITED", message: EMAIL_RATE_LIMIT_MESSAGE }
    : { status: 502, code: "OTP_SEND_FAILED", message: "No pudimos enviar el código. Intenta nuevamente." };
}

export type EmailEntryDecision =
  | { sent: true }
  | { sent: false; code: "ACCOUNT_NOT_FOUND" };

/**
 * Keeps account discovery and OTP delivery inside one server operation. A
 * login miss never calls the mail provider; creation sends only after the
 * user explicitly chooses the create intent.
 */
export async function processEmailOtpEntry(input: {
  email: string;
  intent: EmailEntryIntent;
  accountExists: (email: string) => Promise<boolean>;
  sendOtp: (email: string, intent: EmailEntryIntent) => Promise<void>;
}): Promise<EmailEntryDecision> {
  const email = input.email.trim().toLocaleLowerCase("en-US");
  if (input.intent === "login" && !await input.accountExists(email)) {
    return { sent: false, code: "ACCOUNT_NOT_FOUND" };
  }
  await input.sendOtp(email, input.intent);
  return { sent: true };
}
