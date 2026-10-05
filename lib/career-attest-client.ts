import type { CareerAttestSummary } from "./career-index-presentation";

/** Own-account read only. Keep Career requests outside the Social route allowlist. */
export async function readCareerAttestSummary(accessToken: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<CareerAttestSummary> {
  if (!accessToken) throw new Error("AUTH_REQUIRED");
  const response = await fetcher("/api/career/attest", {
    method: "GET", headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store", redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("CAREER_ATTEST_UNAVAILABLE");
  const value: CareerAttestSummary = await response.json();
  if (!Array.isArray(value.cards) || value.cards.length > 20 || !Array.isArray(value.slots) || value.slots.length !== 20
    || value.slots.some(slot => typeof slot !== "boolean") || !Number.isInteger(value.count) || value.count < 0 || value.count > 20
    || value.percent !== value.count * 5 || value.cards.some(card => typeof card.attested !== "boolean")
    || value.cards.filter(card => card.attested).length !== value.count) throw new Error("CAREER_ATTEST_INVALID_RESPONSE");
  return value;
}
