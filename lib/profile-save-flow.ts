export type ProfileSaveResult = "local" | "cloud" | "cloud_pending";

export type ProfilePrimarySaveOutcome =
  | { status: "saved" }
  | { status: "failed"; error: unknown }
  | { status: "timeout" };

/**
 * The profile row is the canonical save. Social/Auth projections may continue
 * after this deadline, but they must never keep the profile CTA locked.
 */
export async function waitForProfilePrimarySave(
  primarySave: Promise<unknown>,
  timeoutMs = 8_000,
): Promise<ProfilePrimarySaveOutcome> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ProfilePrimarySaveOutcome>((resolve) => {
    timeout = setTimeout(() => resolve({ status: "timeout" }), Math.max(1, timeoutMs));
  });
  const settled = primarySave.then<ProfilePrimarySaveOutcome, ProfilePrimarySaveOutcome>(
    () => ({ status: "saved" }),
    (error: unknown) => ({ status: "failed", error }),
  );
  try {
    return await Promise.race([settled, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
