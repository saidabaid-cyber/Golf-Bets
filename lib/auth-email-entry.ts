export type EmailEntryIntent = "login" | "create";

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
