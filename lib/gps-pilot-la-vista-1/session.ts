import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { AuthSessionRecoveryError, restoreAuthSession, type AuthFlowClient } from "../auth-flow";

export type PilotSessionState = { status: "checking" | "anonymous" | "error"; token: null } |
  { status: "authenticated"; token: string };
type PilotAuth = AuthFlowClient & { onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) =>
  { data: { subscription: { unsubscribe: () => void } } } };

/** Supabase owns refresh/session locks. Validate outside its event callback and
 * reject stale completions after token rotation, sign-out or component unmount. */
export function watchGpsPilotSession(auth: PilotAuth, onState: (value: PilotSessionState) => void,
  recover: (auth: AuthFlowClient) => Promise<Session | null> = restoreAuthSession) {
  let active = true, revision = 0;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  function refresh() {
    const attempt = ++revision;
    clearTimeout(scheduled); clearTimeout(timeout);
    onState({ status: "checking", token: null });
    timeout = setTimeout(() => {
      if (active && revision === attempt) { ++revision; onState({ status: "error", token: null }); }
    }, 15000);
    scheduled = setTimeout(() => {
      void recover(auth).then(session => {
        if (!active || revision !== attempt) return;
        clearTimeout(timeout);
        onState(session ? { status: "authenticated", token: session.access_token } : { status: "anonymous", token: null });
      }).catch(error => {
        if (!active || revision !== attempt) return;
        clearTimeout(timeout);
        onState({ status: error instanceof AuthSessionRecoveryError && error.failure === "invalid" ? "anonymous" : "error", token: null });
      });
    }, 0);
  }
  const { data } = auth.onAuthStateChange((event) => {
    if (!active) return;
    if (event === "SIGNED_OUT") {
      ++revision; clearTimeout(scheduled); clearTimeout(timeout);
      onState({ status: "anonymous", token: null });
    } else refresh();
  });
  refresh();
  return () => { active = false; ++revision; clearTimeout(scheduled); clearTimeout(timeout); data.subscription.unsubscribe(); };
}
