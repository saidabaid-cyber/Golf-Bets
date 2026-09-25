const SUPABASE_ORIGIN = /https:\/\/[a-z0-9]{20}\.supabase\.co\b/gi;
const PUBLISHABLE_KEY = /sb_publishable_[A-Za-z0-9_-]{15,}/g;
const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{15,}/g;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export function createQaClientBundleEvidence() {
  return { supabaseOrigins: new Set(), publicKeys: new Set(), secretCount: 0 };
}

/** Inspect only public client bytes. A parseable JWT is accepted solely when
 * it is the legacy anon key for the exact isolated QA project. User sessions,
 * provider tokens, service/admin tokens and wrong-project anon keys are never
 * legitimate build artifacts. JWT-like non-JSON application strings are
 * ignored to avoid treating arbitrary minified values as credentials. */
export function scanQaClientSource(source, evidence, expectedProjectRef) {
  for (const origin of source.match(SUPABASE_ORIGIN) || []) evidence.supabaseOrigins.add(new URL(origin).origin.toLowerCase());
  for (const key of source.match(PUBLISHABLE_KEY) || []) evidence.publicKeys.add(key);
  evidence.secretCount += (source.match(SECRET_KEY) || []).length;
  for (const token of source.match(JWT) || []) {
    try {
      const parts = token.split(".");
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (claims?.role === "anon") {
        if (claims.ref !== expectedProjectRef) throw new Error("Client content contains a legacy anon key for another Supabase project.");
        evidence.publicKeys.add(token);
      } else {
        evidence.secretCount++;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("legacy anon key")) throw error;
      // A syntactically JWT-like value without a decodable JSON payload is not
      // enough evidence to classify application data as a credential.
    }
  }
  return evidence;
}
