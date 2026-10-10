/** Existing QA accounts only. Password verification remains Supabase Auth. */
export function devFixtureEnvironment(env: Readonly<Record<string, string | undefined>>, origin: string, host: string) {
  return origin === 'https://dev.thebackyard.com.mx' && host === 'dev.thebackyard.com.mx'
    && env.VERCEL === '1' && env.VERCEL_ENV === 'preview'
    && env.VERCEL_GIT_COMMIT_REF === 'integration/backyard-current'
    && env.GPS_LA_VISTA_1_PILOT_ENABLED === 'true'
    && env.PREVIEW_DB_REF === 'bymeopxkxapfizeeqeyb'
    && env.NEXT_PUBLIC_SUPABASE_URL === 'https://bymeopxkxapfizeeqeyb.supabase.co';
}

export function devFixtureAccount(user: { id: string; app_metadata?: Record<string, unknown> }) {
  return ['73ef00d0-ab1a-4b37-a02b-4ccc3072d098', 'cb3b5897-55d1-41b2-a64c-05b9f6def033'].includes(user.id)
    && user.app_metadata?.qa_fixture_kind === 'PERSISTENT_DEV_QA';
}
