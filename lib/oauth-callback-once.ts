import type { AuthFlowClient } from './auth-flow';
import { restoreAuthSession } from './auth-flow';

type CallbackAuth = AuthFlowClient & { exchangeCodeForSession: (code: string) => Promise<{ error: unknown }> };
const exchanges = new WeakMap<CallbackAuth, { code: string; promise: ReturnType<typeof restoreAuthSession>; expiresAt: number }>();
/** PKCE codes are single-use. React effect replay shares the same exchange;
 * no code/token is persisted or logged. A different code starts a new flow. */
export function finishOAuthOnce(auth: CallbackAuth, code: string | null) {
  const prior = exchanges.get(auth);
  if (prior && prior.code === (code ?? '') && prior.expiresAt > Date.now()) return prior.promise;
  const promise = (async () => {
    if (code) { const result = await auth.exchangeCodeForSession(code); if (result.error) throw result.error; }
    const session = await restoreAuthSession(auth);
    if (!session) throw new Error('account_session_missing');
    return session;
  })();
  exchanges.set(auth, { code: code ?? '', promise, expiresAt: Date.now() + 300_000 });
  return promise;
}
