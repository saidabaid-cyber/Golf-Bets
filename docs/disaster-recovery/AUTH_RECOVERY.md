# Authentication recovery

Source of truth: lib/auth-flow.ts, lib/oauth-callback-once.ts, lib/supabase/client.ts, account mapping and consent routes/migrations.

## Existing flow

Email: choose access/create intent → request OTP using Supabase signInWithOtp (shouldCreateUser follows intent) → verify 8-digit email code → resolve verified auth user/account profile → existing account or incomplete/new onboarding. Do not implement public email enumeration or create duplicate profiles by email.

Google: initiate OAuth once with PKCE, prompt select_account → Google returns to Supabase provider callback → Supabase redirects to the originating app /auth/callback → singleflight code exchange/session restoration → canonical account mapping. Code verifier/session storage stays on the original origin. Five-minute in-memory callback sharing prevents duplicate code exchange; do not replay codes or copy another browser's PKCE verifier.

Browser client: persistSession=true, autoRefreshToken=true, detectSessionInUrl=false, flowType=pkce, custom browser storage fallback. Server Supabase clients do not persist sessions. Restoring DB rows does not restore a user's browser session. Prefer fresh sign-in after incident and revoke stale sessions according to an approved recovery policy.

Apple has code/UI entry points, but no verified live provider availability was established in this task. Do not present it as recovered until authorized Apple provider setup and human testing pass.

## Recover identity safely

Restore auth users/identities consistently with UUID-owned app tables. Do not regenerate UUIDs, merge by email or accept legal/AI consent automatically. Password hashes and identities require private encrypted dumps; provider JWT/signing/Vault keys and SMTP secrets require separate protected custody. A new signing key/project ref invalidates old sessions and signed URLs; that is not reason to weaken verification.

Managed Supabase Auth infrastructure has its own schemas/migrations. Use a compatible platform restore procedure, not blind replay of app migrations over a live Auth database. Preserve custom auth triggers and legal/account mapping. Audit RLS with two synthetic identities on the new isolated target before exposing users.

## Operator console settings checklist

Supabase Dashboard → target project → Authentication:
- Providers → Email: enabled, signup policy, OTP length/expiry, rate limits.
- Email → SMTP settings: verified sender/domain, provider host/port/username and private password.
- Email templates: compare repo supabase/templates and approved current templates; token template must match app's code flow.
- URL Configuration: approved Site URL and exact allowed Preview app /auth/callback origins; avoid broad unrelated wildcards.
- Providers → Google: correct OAuth client ID + secret from owner Google Cloud account.
- Providers → Apple only if previously authorized/configured.
- Sessions/security settings: document expiry, refresh rotation and signing-key strategy privately.

Google Cloud Console → APIs & Services → Credentials → authorized web OAuth client → Authorized redirect URIs. Actual existing QA URI is:
`https://bymeopxkxapfizeeqeyb.supabase.co/auth/v1/callback`.
For a new Supabase ref, obtain the callback shown by **that** project and add it to the matching Google client. App deployment URLs are a separate Supabase allowlist; Google does not normally need every Vercel URL.

Last owner-confirmed QA SMTP configuration used Resend at smtp.resend.com:465, username resend, sender no-reply@auth.thebackyard.com.mx. This audit did NOT retest delivery or retrieve its password. Recover/reissue that secret inside the provider consoles; do not reuse it implicitly as the group/feedback API key.

## Verification

Human-controlled OTP receipt + login, Google selector → callback → Home, logout/re-login, restored account UUID, incomplete onboarding, account switching, two-user isolation. Pending real OAuth/OTP is PENDING_INTERACTIVE_QA, not PASS because callback code compiles. Consent lookup failure must not grant AI authorization or block general app access.
