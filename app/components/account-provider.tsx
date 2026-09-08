"use client";
import { cloudAccountErrorMessage, ensureCloudProfile, saveCloudProfile } from "../../lib/cloud-account";

import Link from "next/link";
import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  ACCOUNT_STORAGE_KEYS,
  authErrorMessage,
  clearLegalAcceptancesForUser,
  hasLocalGolfData,
  guestBackyardProfile,
  isValidEmail,
  mergeLegalAcceptances,
  mergeBackyardProfile,
  migrationDecisionStorageKey,
  normalizeBackyardProfileCache,
  normalizeOtp,
  parseLegalAcceptances,
  profileHandicapInput,
  readOfflineAuthenticatedProfile,
  validateProfileDraft,
  type AccountMode,
  type BackyardProfile,
  type LegalAcceptance,
} from "../../lib/account-state";
import { getSupabaseBrowser } from "../../lib/supabase/client";
import { AuthSessionRecoveryError, authIdentityChanged, clearDeletedAuthSession, closeAuthSession, isAccountSession, recoverAuthSession, restoreAuthSession, sendEmailOtp, startSocialOAuth, verifyEmailOtp, OtpSendGate, otpRetrySeconds, OTP_COOLDOWN_KEY } from "../../lib/auth-flow";
import { discardAccountWorkspace, ownsLocalWorkspace, switchAccountWorkspace, WORKSPACE_OWNER_KEY } from "../../lib/account-workspace";
import { CLOUD_LOCAL_META_KEY, type CloudPreferences } from "../../lib/cloud-sync";
import type { AuthProviderStatus } from "../../lib/auth-provider-status";
import { cloudIssueFromError, cloudIssuePriority, type CloudIssue, type CloudIssueDomain } from "../../lib/cloud-issues";
import { BrandLockup } from "./brand-lockup";
import { BettingConsentDialog } from "./betting-consent-dialog";
import { LegalConsentScreen, type LegalCeremonyChoices } from "./legal-consent-screen";
import {
  hasCurrentCoreLegalChoices,
  hasCurrentFinancialConsent,
  hasCurrentMarketingConsent,
  legalActorForIdentity,
  legalClientEnvironment,
  legalEvidenceStateKey,
  legalEvidenceRequestBody,
  latestLegalEvidence,
  markLegalEvidenceFailed,
  markLegalEvidenceSynced,
  mergeServerLegalEvidence,
  pendingLegalEvidence,
  readLegalEvidence,
  recordLocalLegalEvidence,
  replaceLegalEvidence,
  type LegalEvidenceEvent,
  type LegalEnvironment,
  type LegalEvidenceServerRow,
} from "../../lib/legal-choice-state";
import type { LegalEvidenceAction, LegalEvidenceSubject } from "../../lib/legal-documents";
import { buildLocalAccountExport } from "../../lib/account-data-export";

export type BackyardIdentity = BackyardProfile & {
  mode: Exclude<AccountMode, "undecided">;
  providers: string[];
  accessToken: string | null;
};

type AccountContextValue = {
  identity: BackyardIdentity;
  updateProfile: (profile: Pick<BackyardProfile, "displayName" | "defaultHandicap" | "avatarUrl">) => Promise<void>;
  logout: () => Promise<void>;
  finishAccountDeletion: () => Promise<void>;
  openAccess: () => void;
  acceptances: LegalAcceptance[];
  legalEvents: LegalEvidenceEvent[];
  bettingConsentGranted: boolean;
  bettingConsentResolved: boolean;
  requestBettingConsent: () => Promise<boolean>;
  marketingConsentGranted: boolean;
  recordLegalChoice: (subject: LegalEvidenceSubject, action: LegalEvidenceAction, origin?: "account_privacy" | "financial_gate") => Promise<void>;
  cloudLinked: boolean;
  cloudStatus: "local" | "saving" | "offline" | "syncing" | "synced" | "pending" | "error";
  setCloudStatus: (status: AccountContextValue["cloudStatus"]) => void;
  requestCloudLink: () => void;
  lastCloudSync: string | null;
  cloudIssues: CloudIssue[];
  retryCloudSync: () => void | Promise<void>;
  refreshCloudSession: () => Promise<string>;
  reportCloudSyncError: (error: unknown) => void;
  clearCloudSyncError: () => void;
  applyCloudPreferences: (preferences: CloudPreferences) => void;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function useBackyardAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useBackyardAccount debe usarse dentro de AccountProvider");
  return value;
}

function profileFromUser(user: User): BackyardProfile {
  const base = {
    userId: user.id,
    displayName: String(user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Jugador"),
    email: user.email || "",
    avatarUrl: String(user.user_metadata?.avatar_url || user.user_metadata?.picture || ""),
    defaultHandicap: typeof user.user_metadata?.default_handicap === "number" ? user.user_metadata.default_handicap : null,
  };
  try {
    const cached = JSON.parse(localStorage.getItem(`backyard-profile-cache-v1:${user.id}`) || "null");
    return normalizeBackyardProfileCache(cached, base);
  } catch { return base; }
}

function guestProfile(): BackyardProfile {
  try {
    const saved = JSON.parse(localStorage.getItem(ACCOUNT_STORAGE_KEYS.guestProfile) || "null");
    return guestBackyardProfile(saved);
  } catch { /* keep safe guest defaults */ }
  return guestBackyardProfile();
}

function AccessScreen({ onGuest, onAuthenticated, sessionError }: { onGuest: () => void | Promise<void>; onAuthenticated: (session: Session) => void; sessionError: string }) {
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [socialEnabled, setSocialEnabled] = useState(true);
  const [providers, setProviders] = useState<AuthProviderStatus | null>(null);
  const sendGate = useRef(new OtpSendGate());
  const [retrySeconds, setRetrySeconds] = useState(0);
  useEffect(() => {
    try { sendGate.current.nextSendAt = Number(sessionStorage.getItem(OTP_COOLDOWN_KEY)) || 0; }
    catch { /* Private-mode storage may be unavailable; the in-memory cooldown still applies. */ }
    const tick = () => setRetrySeconds(otpRetrySeconds(sendGate.current.nextSendAt));
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/features", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((features) => { if (!active) return; if (features?.authSocialEnabled === false) setSocialEnabled(false); setProviders(features?.authProviders || { status: "unavailable", email: false, google: false, apple: false }); })
      .catch(() => { if (active) setProviders({ status: "unavailable", email: false, google: false, apple: false }); });
    return () => { active = false; };
  }, []);

  async function social() {
    if (!providers || providers.status === "unavailable") {
      setMessage("No pudimos comprobar el proveedor de acceso. Revisa tu conexión y vuelve a intentar.");
      return;
    }
    if (!socialEnabled || !providers.google) {
      setMessage("Acceso con Google pendiente de configuración.");
      return;
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setMessage("Acceso con Google pendiente de configuración.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      await startSocialOAuth(supabase.auth, "google", `${window.location.origin}/auth/callback`);
    } catch (error) {
      setMessage(authErrorMessage(error, "google"));
      setBusy(false);
    }
  }

  async function sendCode() {
    if (!isValidEmail(email)) { setMessage("Escribe un correo electrónico válido."); return; }
    const supabase = getSupabaseBrowser();
    if (!supabase) { setMessage("Acceso con correo pendiente de configuración."); return; }
    if (providers?.status === "ready" && !providers.email) { setMessage("Acceso con correo pendiente de configuración."); return; }
    if (!sendGate.current.begin()) return;
    try { sessionStorage.setItem(OTP_COOLDOWN_KEY, String(sendGate.current.nextSendAt)); }
    catch { /* Never prevent OTP capture because optional cooldown persistence failed. */ }
    setRetrySeconds(otpRetrySeconds(sendGate.current.nextSendAt));
    setBusy(true); setMessage("");
    try {
      await sendEmailOtp(supabase.auth, email, `${window.location.origin}/auth/callback`);
      setCodeSent(true);
      setMessage("Código enviado. Revisa tu correo.");
    } catch (error) {
      setMessage(authErrorMessage(error, "email"));
    } finally { sendGate.current.finish(); setBusy(false); }
  }

  async function verifyCode() {
    if (otp.length !== 8) { setMessage("Introduce los 8 dígitos del código."); return; }
    const supabase = getSupabaseBrowser();
    if (!supabase) { setMessage("Acceso con correo pendiente de configuración."); return; }
    setBusy(true); setMessage("");
    try {
      onAuthenticated(await verifyEmailOtp(supabase.auth, email, otp));
    } catch (error) {
      setMessage(authErrorMessage(error, "otp"));
    } finally { setBusy(false); }
  }

  return <main className="accessScreen">
    <section className="accessCard">
      <BrandLockup />
      <p className="accessPromise">Tu juego. Tus grupos. Tus reglas. Tu historia.</p>
      {!emailMode ? <div className="accessActions">
        {(() => {
          const available = socialEnabled && providers?.status === "ready" && providers.google;
          const label = !providers ? "Google · comprobando acceso…" : providers.status === "unavailable" ? "Google · acceso no disponible" : !available ? "Google · pendiente de configuración" : "Continuar con Google";
          return <button className="oauthButton google" disabled={busy || !available} onClick={social}>{label}</button>;
        })()}
        <button className="secondary big" disabled={busy} onClick={() => { setEmailMode(true); setMessage(""); }}>Continuar con correo</button>
        <button className="guestButton" disabled={busy} onClick={async () => {
          setBusy(true); setMessage("");
          try { await onGuest(); } catch { setMessage("No pudimos salir de la sesión anterior. Reintenta antes de continuar como invitado."); }
          finally { setBusy(false); }
        }}>Continuar como invitado</button>
      </div> : <div className="emailAccess">
        {!codeSent ? <>
          <label htmlFor="access-email">Correo electrónico</label>
          <input id="access-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" />
          <button className="primary big" disabled={busy || retrySeconds > 0} onClick={sendCode}>{busy ? "Enviando…" : retrySeconds ? `Enviar en ${retrySeconds}s` : "Enviar código"}</button>
          <button className="textButton" disabled={busy} onClick={() => setEmailMode(false)}>← Volver</button>
        </> : <>
          <h2>Código de verificación</h2>
          <p>Enviado a {email.trim()}</p>
          <label htmlFor="access-otp">Introduce los 8 dígitos del correo</label>
          <input id="access-otp" className="otpInput" aria-label="Código de ocho dígitos" inputMode="numeric" autoComplete="one-time-code" maxLength={8} disabled={busy} value={otp} onChange={(event) => setOtp(normalizeOtp(event.target.value))} placeholder="8 dígitos" />
          <p className="hint">Todavía no has iniciado sesión. Tu cuenta se abrirá solo al verificar el código.</p>
          <details className="hint"><summary>¿Recibiste un enlace en lugar del código?</summary><p>El correo de Supabase necesita la plantilla de código de ocho dígitos. Ese enlace no sustituye esta verificación; puedes regresar y elegir explícitamente el modo invitado.</p></details>
          <button className="primary big" disabled={busy || otp.length !== 8} onClick={verifyCode}>{busy ? "Verificando…" : "Verificar"}</button>
          <div className="otpLinks"><button className="textButton" disabled={busy || retrySeconds > 0} onClick={sendCode}>{retrySeconds ? `Reenviar en ${retrySeconds}s` : "Reenviar código"}</button><button className="textButton" disabled={busy} onClick={() => { setCodeSent(false); setOtp(""); setMessage(""); }}>Cambiar correo</button></div>
          <button className="textButton" disabled={busy} onClick={() => { setEmailMode(false); setMessage(""); }}>← Regresar al acceso</button>
        </>}
      </div>}
      {!socialEnabled && <p id="social-auth-status" className="hint">Google · Pendiente de configuración</p>}
      {socialEnabled && providers?.status === "ready" && !providers.google && <p className="hint">Google · Pendiente de configuración.</p>}
      {(message || sessionError) && <div className="accessMessage" role="status">{message || sessionError}</div>}
      <p className="hint">Invitado es un acceso independiente: no inicia sesión ni sincroniza tus datos con una cuenta.</p>
      <div className="legalLead accessLegalNotice">
        <b>Aviso de Privacidad Simplificado</b>
        <p>Antes de proporcionar datos puedes consultar cómo los trata The Backyard. Continuar al acceso no acepta automáticamente Términos, marketing ni tratamiento económico.</p>
        <p><Link href="/legal/privacy-simplified?returnTo=access">Leer Aviso Simplificado</Link> · <Link href="/legal/privacy?returnTo=access">Aviso Integral</Link> · <Link href="/legal/terms?returnTo=access">Términos y Condiciones</Link></p>
      </div>
    </section>
  </main>;
}

function ProfileSetupScreen({ identity, onSave, onBack }: {
  identity: BackyardIdentity;
  onSave: (profile: Pick<BackyardProfile, "displayName" | "defaultHandicap" | "avatarUrl">) => Promise<void>;
  onBack: () => Promise<void>;
}) {
  const [name, setName] = useState(identity.displayName === "Jugador" ? "" : identity.displayName);
  const [handicap, setHandicap] = useState(profileHandicapInput(identity.defaultHandicap));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateProfileDraft(name, handicap);
    if (!validation.ok) { setMessage(validation.message); return; }
    setBusy(true); setMessage("");
    try { await onSave({ displayName: validation.displayName, defaultHandicap: validation.defaultHandicap, avatarUrl: identity.avatarUrl }); }
    catch { setMessage("No pudimos completar el perfil. Revisa tu conexión e intenta nuevamente."); }
    finally { setBusy(false); }
  }
  return <main className="consentScreen profileSetupScreen"><section className="consentCard profileSetupCard">
    <BrandLockup compact />
    <div className="eyebrow">THE BACKYARD ACCOUNT</div>
    <h1>Completa tu perfil</h1>
    <p>Solo necesitamos lo esencial para identificarte en tus rondas.</p>
    <form className="profileSetupForm" onSubmit={saveProfile} noValidate>
      <label htmlFor="profile-setup-name">Nombre</label>
      <input id="profile-setup-name" autoComplete="name" enterKeyHint="next" value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" />
      <label htmlFor="profile-setup-hcp">HCP Index (opcional)</label>
      <input id="profile-setup-hcp" type="text" inputMode="text" enterKeyHint="done" autoComplete="off" value={handicap} onChange={(event) => setHandicap(event.target.value)} placeholder="Ej. 8.4 o +1.2" aria-describedby="profile-setup-hcp-help" />
      <small id="profile-setup-hcp-help" className="profileFieldHelp">Puedes dejarlo vacío. El HCP de juego se define por separado en cada ronda.</small>
      {message && <div className="accessMessage" role="alert">{message}</div>}
      <button type="submit" className="primary big" disabled={busy}>{busy ? "Guardando…" : "Guardar y continuar"}</button>
    </form>
    <button className="textButton" disabled={busy} onClick={onBack}>← Volver al acceso</button>
  </section></main>;
}

function downloadLocalData(identity: BackyardIdentity) {
  const payload = buildLocalAccountExport(localStorage, identity);
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `the-backyard-datos-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function LegalRestrictedScreen({ identity, onReview, onLogout, onDeleted }: {
  identity: BackyardIdentity;
  onReview: () => void;
  onLogout: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function deleteAccount() {
    if (identity.mode !== "authenticated" || !identity.accessToken) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/account/delete", { method: "DELETE", headers: { authorization: `Bearer ${identity.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ confirmation: "ELIMINAR" }) });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se completó la eliminación.");
      await onDeleted();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se completó la eliminación. La cuenta sigue activa."); }
    finally { setBusy(false); }
  }
  return <main className="consentScreen legalRestrictedScreen"><section className="consentCard">
    <BrandLockup compact />
    <div className="eyebrow">LEGAL Y PRIVACIDAD</div>
    <h1>Acceso deportivo en pausa</h1>
    <p>No aceptaste o revocaste los Términos vigentes. Tu información no se borró y conservas acceso a los documentos, tus derechos, exportación y eliminación.</p>
    <div className="legalDocumentSummary">
      <Link href="/legal/privacy-simplified?returnTo=access">Aviso Simplificado</Link>
      <Link href="/legal/privacy?returnTo=access">Aviso Integral</Link>
      <Link href="/legal/terms?returnTo=access">Términos y Condiciones</Link>
      <a href="mailto:privacidad@thebackyard.com.mx">Privacidad, ARCO y revocación</a>
    </div>
    <button className="primary big" onClick={onReview}>Revisar mis elecciones</button>
    <button className="secondary big" onClick={() => downloadLocalData(identity)}>Exportar copia local</button>
    {identity.mode === "authenticated" && <button className="dangerButton big" onClick={() => setConfirmDelete(true)}>Eliminar cuenta y datos</button>}
    <button className="textButton" onClick={() => void onLogout()}>Cerrar sesión</button>
    {message && <p className="notice bad" role="alert">{message}</p>}
    {confirmDelete && <div className="modalBackdrop"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="restricted-delete-title"><h2 id="restricted-delete-title">Eliminar cuenta y datos</h2><p>Esta acción es definitiva. La evidencia legal se elimina junto con la cuenta cuando corresponda.</p><div className="dialogActions"><button className="secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancelar</button><button className="dangerButton" disabled={busy} onClick={deleteAccount}>{busy ? "Eliminando…" : "Eliminar definitivamente"}</button></div></section></div>}
  </section></main>;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<BackyardIdentity | null>(null);
  const [acceptances, setAcceptances] = useState<LegalAcceptance[]>([]);
  const [legalEvents, setLegalEvents] = useState<LegalEvidenceEvent[]>([]);
  const [legalEnvironment, setLegalEnvironment] = useState<LegalEnvironment>("development");
  const [legalReconsidering, setLegalReconsidering] = useState(false);
  const [legalUpdateDeferred, setLegalUpdateDeferred] = useState(false);
  const [bettingConsentOpen, setBettingConsentOpen] = useState(false);
  const [accessRequested, setAccessRequested] = useState(false);
  const [showMigration, setShowMigration] = useState(false);
  const [cloudConsentChecked, setCloudConsentChecked] = useState(false);
  const [cloudLinked, setCloudLinked] = useState(false);
  const [cloudStatus, setRawCloudStatus] = useState<AccountContextValue["cloudStatus"]>("local");
  const [lastCloudSync, setLastCloudSync] = useState<string | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationError, setMigrationError] = useState("");
  const [profileSetupRequired, setProfileSetupRequired] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);
  const activeUserId = useRef<string | null>(null);
  const sessionRecovery = useRef<{ userId: string; promise: Promise<string> } | null>(null);
  const bettingConsentRequest = useRef<{ userId: string; promise: Promise<boolean>; resolve: (accepted: boolean) => void } | null>(null);
  const [cloudIssuesByDomain, setCloudIssuesByDomain] = useState<Partial<Record<CloudIssueDomain, CloudIssue>>>({});
  const [legalRetryRevision, setLegalRetryRevision] = useState(0);
  const [accountReloadRevision, setAccountReloadRevision] = useState(0);
  const cloudProfileFallback = useMemo(() => ({
    displayName: identity?.displayName || "Jugador",
    defaultHandicap: identity?.defaultHandicap ?? null,
    avatarUrl: identity?.avatarUrl || "",
  }), [identity?.displayName, identity?.defaultHandicap, identity?.avatarUrl]);
  const setCloudIssue = useCallback((domain: CloudIssueDomain, issue: CloudIssue | null) => {
    setCloudIssuesByDomain((current) => {
      if (!issue && !current[domain]) return current;
      const next = { ...current };
      if (issue) next[domain] = issue;
      else delete next[domain];
      return next;
    });
  }, []);
  const issueWithMessage = useCallback((domain: CloudIssueDomain, message: string, kind: CloudIssue["kind"] = "server") => {
    setCloudIssue(domain, message ? { domain, kind, message, retryable: kind !== "session_expired" } : null);
  }, [setCloudIssue]);
  const accountCloudError = cloudIssuesByDomain.auth?.message || cloudIssuesByDomain.profile?.message || "";
  const reportCloudSyncError = useCallback((error: unknown) => {
    const issue = cloudIssueFromError("round", error, navigator.onLine);
    setCloudIssue(issue.domain, issue);
  }, [setCloudIssue]);
  const clearCloudSyncError = useCallback(() => {
    setCloudIssue("round", null);
    setCloudIssue("files", null);
    setCloudIssue("conflict", null);
  }, [setCloudIssue]);
  const setCloudStatus = useCallback((status: AccountContextValue["cloudStatus"]) => {
    setRawCloudStatus(status);
    if (status === "synced" && activeUserId.current) {
      const at = new Date().toISOString();
      setLastCloudSync(at);
      localStorage.setItem(`backyard-last-sync-v1:${activeUserId.current}`, at);
    }
  }, []);
  const applyCloudPreferences = useCallback((preferences: CloudPreferences) => {
    setIdentity(current => current?.mode === "authenticated" && !Object.is(current.defaultHandicap, preferences.defaultHandicap)
      ? { ...current, defaultHandicap: preferences.defaultHandicap }
      : current);
  }, []);
  const readIdentityLegalEvents = useCallback((nextIdentity: Pick<BackyardIdentity, "mode" | "userId">) => {
    const nextEnvironment = legalClientEnvironment();
    setLegalEnvironment(nextEnvironment);
    const actor = legalActorForIdentity(localStorage, nextIdentity);
    return readLegalEvidence(localStorage, actor.actorKey, nextEnvironment);
  }, []);

  const syncLegalEvidence = useCallback(async (userId: string, accessToken: string, current: LegalEvidenceEvent[]) => {
    const queued = pendingLegalEvidence(current);
    if (!queued.length) return current;
    try {
      const response = await fetch("/api/legal/evidence", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ events: queued.map(legalEvidenceRequestBody) }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; receipts?: Array<{ idempotencyKey: string; serverReceivedAt: string }> };
      if (!response.ok || !Array.isArray(result.receipts)) throw new Error(result.error || "No pudimos confirmar tus elecciones legales en el servidor.");
      const synced = markLegalEvidenceSynced(current, result.receipts);
      if (activeUserId.current !== userId) throw new Error("La sesión cambió antes de confirmar tus elecciones.");
      replaceLegalEvidence(localStorage, `account:${userId}`, legalEnvironment, synced);
      return synced;
    } catch (error) {
      const failed = markLegalEvidenceFailed(current, queued.map((event) => event.idempotencyKey));
      replaceLegalEvidence(localStorage, `account:${userId}`, legalEnvironment, failed);
      throw error;
    }
  }, [legalEnvironment]);
  useEffect(() => {
    if (identity?.mode === "authenticated") {
      const { displayName, defaultHandicap, avatarUrl, email } = identity;
      try { localStorage.setItem(`backyard-profile-cache-v1:${identity.userId}`, JSON.stringify({ displayName, defaultHandicap, avatarUrl, email })); }
      catch { issueWithMessage("profile", "No se pudo guardar el perfil local. Libera espacio y reintenta."); }
    }
  }, [identity, issueWithMessage]);

  const activateSession = useCallback((session: Session, options: { rehydrate?: boolean } = {}) => {
    if (!isAccountSession(session)) throw new Error("account_session_missing");
    if (!authIdentityChanged(activeUserId.current, session.user.id)) {
      setIdentity((current) => current ? { ...current, accessToken: session.access_token, email: session.user.email || current.email } : current);
      setCloudIssue("auth", null);
      if (options.rehydrate !== false) {
        setCloudStatus(navigator.onLine ? "pending" : "offline");
        setAccountReloadRevision((value) => value + 1);
        setLegalRetryRevision((value) => value + 1);
        window.setTimeout(() => window.dispatchEvent(new Event("backyard-sync-retry")), 0);
      }
      return;
    }
    switchAccountWorkspace(localStorage, session.user.id);
    activeUserId.current = session.user.id;
    setLastCloudSync(localStorage.getItem(`backyard-last-sync-v1:${session.user.id}`));
    setCloudIssuesByDomain({});
    const profile = profileFromUser(session.user);
    const authenticatedIdentity = { ...profile, mode: "authenticated" as const, providers: session.user.app_metadata?.providers || [session.user.app_metadata?.provider].filter((value): value is string => Boolean(value)), accessToken: session.access_token };
    setIdentity(authenticatedIdentity);
    setLegalEvents(readIdentityLegalEvents(authenticatedIdentity));
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.mode, "authenticated");
    setCloudConsentChecked(false);
    setProfileChecked(false);
    const migrationDecision = localStorage.getItem(migrationDecisionStorageKey(session.user.id));
    const localDataExists = hasLocalGolfData(localStorage);
    if (!localDataExists && !migrationDecision) localStorage.setItem(migrationDecisionStorageKey(session.user.id), "linked");
    setCloudLinked(migrationDecision === "linked" || !localDataExists);
    setCloudStatus(migrationDecision === "linked" || !localDataExists ? "pending" : "local");
    setShowMigration(localDataExists && !migrationDecision);
  }, [readIdentityLegalEvents, setCloudIssue, setCloudStatus]);

  const activateOfflineWorkspace = useCallback(() => {
    const ownerId = localStorage.getItem(WORKSPACE_OWNER_KEY) || "";
    const profile = readOfflineAuthenticatedProfile(localStorage, ownerId);
    if (!profile || !ownsLocalWorkspace(localStorage, profile.userId)) return false;
    activeUserId.current = profile.userId;
    const linked = localStorage.getItem(migrationDecisionStorageKey(profile.userId)) === "linked";
    const offlineIdentity = { ...profile, mode: "authenticated" as const, providers: [], accessToken: null };
    setIdentity(offlineIdentity);
    setLegalEvents(readIdentityLegalEvents(offlineIdentity));
    setCloudLinked(linked);
    setCloudStatus("offline");
    setLastCloudSync(localStorage.getItem(`backyard-last-sync-v1:${profile.userId}`));
    setCloudConsentChecked(true);
    setProfileChecked(true);
    setProfileSetupRequired(localStorage.getItem(`backyard-profile-ready-v1:${profile.userId}`) !== "true");
    setReady(true);
    return true;
  }, [readIdentityLegalEvents, setCloudStatus]);

  useEffect(() => {
    const localAcceptances = parseLegalAcceptances(localStorage.getItem(ACCOUNT_STORAGE_KEYS.acceptances));
    setAcceptances(localAcceptances);
    const supabase = getSupabaseBrowser();
    let mounted = true;
    let authEventRevision = 0;
    if (supabase) restoreAuthSession(supabase.auth).then((session) => {
      if (!mounted || authEventRevision !== 0) return;
      if (session) activateSession(session);
      else if (!navigator.onLine && activateOfflineWorkspace()) return;
      else if (localStorage.getItem(ACCOUNT_STORAGE_KEYS.mode) === "guest") {
        const profile = guestProfile();
        const guestIdentity = { ...profile, mode: "guest" as const, providers: [], accessToken: null };
        setIdentity(guestIdentity);
        setLegalEvents(readIdentityLegalEvents(guestIdentity));
        setCloudConsentChecked(true);
      }
      setReady(true);
    }).catch((error) => {
      if (!mounted || authEventRevision !== 0) return;
      const issue = cloudIssueFromError("auth", error instanceof AuthSessionRecoveryError ? error.cause : error, navigator.onLine);
      if (activateOfflineWorkspace()) setCloudIssue("auth", issue);
      else setCloudIssue("auth", issue);
      setReady(true);
    });
    if (!supabase) {
      if (localStorage.getItem(ACCOUNT_STORAGE_KEYS.mode) === "guest") {
        const profile = guestProfile();
        const guestIdentity = { ...profile, mode: "guest" as const, providers: [], accessToken: null };
        setIdentity(guestIdentity);
        setLegalEvents(readIdentityLegalEvents(guestIdentity));
        setCloudConsentChecked(true);
      }
      setReady(true);
    }
    const listener = supabase?.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      authEventRevision += 1;
      const revision = authEventRevision;
      // Supabase holds an auth lock during callbacks. Read getSession only after
      // the callback returns; stale reads cannot reactivate a logged-out identity.
      window.setTimeout(() => {
        if (!mounted || revision !== authEventRevision) return;
        void restoreAuthSession(supabase.auth).then(current => {
          if (!mounted || revision !== authEventRevision) return;
          if (current && current.user.id === session?.user.id) activateSession(current, { rehydrate: event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "USER_UPDATED" });
          else if (!current) {
            if (!navigator.onLine && activateOfflineWorkspace()) return;
            activeUserId.current = null;
            if (localStorage.getItem(ACCOUNT_STORAGE_KEYS.mode) === "guest") {
              const guestIdentity = { ...guestProfile(), mode: "guest" as const, providers: [], accessToken: null };
              setIdentity(guestIdentity);
              setLegalEvents(readIdentityLegalEvents(guestIdentity));
              setCloudConsentChecked(true);
            } else { switchAccountWorkspace(localStorage, "guest"); setIdentity(null); }
            setCloudLinked(false); setCloudStatus("local"); setLastCloudSync(null);
          }
          setReady(true);
        }).catch(error => {
          if (!mounted || revision !== authEventRevision) return;
          const issue = cloudIssueFromError("auth", error instanceof AuthSessionRecoveryError ? error.cause : error, navigator.onLine);
          if (activateOfflineWorkspace()) setCloudIssue("auth", issue);
          else setCloudIssue("auth", issue);
          setReady(true);
        });
      }, 0);
    });
    const restoreWhenOnline = () => {
      if (!supabase) return;
      void restoreAuthSession(supabase.auth).then(session => {
        if (mounted && session) activateSession(session);
      }).catch(error => {
        if (!mounted) return;
        const issue = cloudIssueFromError("auth", error instanceof AuthSessionRecoveryError ? error.cause : error, navigator.onLine);
        if (activateOfflineWorkspace()) setCloudIssue("auth", issue);
        else setCloudIssue("auth", issue);
      });
    };
    window.addEventListener("online", restoreWhenOnline);
    return () => { mounted = false; listener?.data.subscription.unsubscribe(); window.removeEventListener("online", restoreWhenOnline); };
  }, [activateSession, activateOfflineWorkspace, readIdentityLegalEvents, setCloudIssue, setCloudStatus]);

  useEffect(() => {
    if (identity?.mode !== "authenticated" || !identity.accessToken) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    let mounted = true;
    Promise.all([
      supabase.from("legal_acceptances").select("user_id,type,version,accepted_at,locale").eq("user_id", identity.userId),
      ensureCloudProfile(supabase, identity.userId, cloudProfileFallback)
        .then((value) => ({ status: "fulfilled" as const, value }))
        .catch((reason: unknown) => ({ status: "rejected" as const, reason })),
      supabase.from("user_preferences").select("default_handicap").eq("user_id", identity.userId).maybeSingle(),
    ]).then(([legalResult, profileResult, preferencesResult]) => {
      if (!mounted) return;
      if (!legalResult.error && Array.isArray(legalResult.data)) {
        const cloud = parseLegalAcceptances(JSON.stringify(legalResult.data.map((item) => ({ userId: item.user_id, type: item.type, documentVersion: item.version, acceptedAt: item.accepted_at, locale: item.locale, persistenceStatus: "persisted", syncStatus: "synced" }))));
        setAcceptances((current) => {
          const merged = mergeLegalAcceptances(current, cloud);
          localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(merged));
          return merged;
        });
      }
      if (profileResult.status === "fulfilled") {
        const cloudProfile = profileResult.value;
        setIdentity((current) => {
          if (!current) return current;
          const displayName = typeof cloudProfile.display_name === "string" && cloudProfile.display_name.trim() ? cloudProfile.display_name : current.displayName;
          const avatarUrl = typeof cloudProfile.avatar_url === "string" ? cloudProfile.avatar_url : current.avatarUrl;
          // Existing preference clocks belong to the full sync merge. Updating
          // just HCP here would masquerade as a local edit on the next autosave.
          const defaultHandicap = preferencesResult.error || localStorage.getItem(CLOUD_LOCAL_META_KEY) ? current.defaultHandicap : preferencesResult.data ? preferencesResult.data.default_handicap : cloudProfile.default_handicap ?? null;
          if (current.displayName === displayName && current.avatarUrl === avatarUrl && current.defaultHandicap === defaultHandicap) return current;
          return { ...current, displayName, avatarUrl, defaultHandicap };
        });
        setProfileSetupRequired(!cloudProfile.onboarding_completed_at);
        if (cloudProfile.onboarding_completed_at) localStorage.setItem(`backyard-profile-ready-v1:${identity.userId}`, "true");
      } else {
        issueWithMessage("profile", navigator.onLine
          ? cloudAccountErrorMessage(profileResult.reason, "tu perfil")
          : "Trabajando sin conexión · estamos usando el perfil guardado en este dispositivo.", navigator.onLine ? "server" : "offline");
        // A failed query is not proof that the profile is missing. Keep the
        // authenticated local profile usable; only a successful cloud row
        // without onboarding_completed_at may open profile setup.
        setProfileSetupRequired(false);
      }
      if (preferencesResult.error) setCloudIssue("profile", cloudIssueFromError("profile", preferencesResult.error, navigator.onLine));
      else if (profileResult.status === "fulfilled") setCloudIssue("profile", null);
    }).catch((error) => { if (mounted) setCloudIssue("profile", cloudIssueFromError("profile", error, navigator.onLine)); }).finally(() => { if (mounted) setProfileChecked(true); });
    return () => { mounted = false; };
  }, [identity?.mode, identity?.userId, identity?.accessToken, cloudProfileFallback, accountReloadRevision, issueWithMessage, setCloudIssue]);

  useEffect(() => {
    if (identity?.mode !== "authenticated" || !identity.accessToken) return;
    const userId = identity.userId;
    const accessToken = identity.accessToken;
    const actorKey = `account:${userId}`;
    let mounted = true;
    setCloudConsentChecked(false);
    const local = readLegalEvidence(localStorage, actorKey, legalEnvironment);
    void fetch("/api/legal/evidence", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as { error?: string; events?: LegalEvidenceServerRow[] };
        if (!response.ok || !Array.isArray(result.events)) throw new Error(result.error || "No pudimos consultar tus elecciones legales.");
        const merged = mergeServerLegalEvidence(local, result.events, userId, legalEnvironment);
        replaceLegalEvidence(localStorage, actorKey, legalEnvironment, merged);
        return syncLegalEvidence(userId, accessToken, merged);
      })
      .then((next) => {
        if (!mounted || activeUserId.current !== userId) return;
        setLegalEvents(next);
        setCloudIssue("legal", null);
      })
      .catch((error) => {
        if (!mounted || activeUserId.current !== userId) return;
        setLegalEvents(readLegalEvidence(localStorage, actorKey, legalEnvironment));
        setCloudIssue("legal", {
          ...cloudIssueFromError("legal", error, navigator.onLine),
          message: navigator.onLine
            ? (error instanceof Error ? error.message : "No pudimos verificar tus elecciones legales.")
            : "Sin conexión · tus elecciones locales quedan pendientes de sincronizar.",
        });
      })
      .finally(() => { if (mounted && activeUserId.current === userId) setCloudConsentChecked(true); });
    return () => { mounted = false; };
  }, [identity?.mode, identity?.userId, identity?.accessToken, legalEnvironment, legalRetryRevision, setCloudIssue, syncLegalEvidence]);

  const currentConsent = hasCurrentCoreLegalChoices(legalEvents);
  const bettingConsentGranted = hasCurrentFinancialConsent(legalEvents);
  const marketingConsentGranted = hasCurrentMarketingConsent(legalEvents);
  const bettingConsentResolved = Boolean(identity && (identity.mode === "guest" || cloudConsentChecked));
  const priorLegalHistory = Boolean(identity && (
    legalEvents.length
    || acceptances.some((item) => item.userId === identity.userId)
  ));
  const termsRejected = latestLegalEvidence(legalEvents, "terms")?.action === "rejected"
    || latestLegalEvidence(legalEvents, "terms")?.action === "revoked";

  useEffect(() => {
    if (!identity || currentConsent || !priorLegalHistory || latestLegalEvidence(legalEvents, "terms")) {
      setLegalUpdateDeferred(false);
      return;
    }
    let hasActiveDraft = false;
    try {
      const draft = localStorage.getItem("golfbets-draft-v1");
      hasActiveDraft = Boolean(draft && draft !== "null" && draft !== "{}");
    } catch { /* The update remains visible if storage cannot be inspected. */ }
    setLegalUpdateDeferred(hasActiveDraft);
    if (!hasActiveDraft) window.dispatchEvent(new Event("backyard-before-legal-navigation"));
  }, [identity, currentConsent, priorLegalHistory, legalEvents]);

  useEffect(() => {
    const safePoint = () => {
      window.dispatchEvent(new Event("backyard-before-legal-navigation"));
      setLegalUpdateDeferred(false);
    };
    window.addEventListener("backyard-legal-safe-point", safePoint);
    return () => window.removeEventListener("backyard-legal-safe-point", safePoint);
  }, []);

  useEffect(() => {
    const beforeLegalLink = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor) return;
      try {
        const destination = new URL(anchor.href, window.location.href);
        if (destination.origin === window.location.origin && destination.pathname.startsWith("/legal/")) {
          window.dispatchEvent(new Event("backyard-before-legal-navigation"));
        }
      } catch { /* Invalid links are not treated as legal navigation. */ }
    };
    document.addEventListener("click", beforeLegalLink, true);
    return () => document.removeEventListener("click", beforeLegalLink, true);
  }, []);

  const closeBettingConsent = useCallback((accepted: boolean) => {
    const pending = bettingConsentRequest.current;
    bettingConsentRequest.current = null;
    setBettingConsentOpen(false);
    pending?.resolve(accepted);
  }, []);

  const requestBettingConsent = useCallback(() => {
    if (!identity) return Promise.resolve(false);
    if (hasCurrentFinancialConsent(legalEvents)) return Promise.resolve(true);
    if (bettingConsentRequest.current?.userId === identity.userId) return bettingConsentRequest.current.promise;
    let resolveRequest!: (accepted: boolean) => void;
    const promise = new Promise<boolean>((resolve) => { resolveRequest = resolve; });
    bettingConsentRequest.current = { userId: identity.userId, promise, resolve: resolveRequest };
    if (identity.mode === "guest" || cloudConsentChecked) setBettingConsentOpen(true);
    return promise;
  }, [identity, legalEvents, cloudConsentChecked]);

  useEffect(() => {
    const pending = bettingConsentRequest.current;
    if (pending && pending.userId !== identity?.userId) closeBettingConsent(false);
  }, [identity?.userId, closeBettingConsent]);

  async function recordChoiceBatch(
    choices: Array<{ subject: LegalEvidenceSubject; action: LegalEvidenceAction }>,
    origin: "onboarding" | "existing_user_update" | "financial_gate" | "account_privacy",
  ) {
    if (!identity) throw new Error("No se pudo identificar el contexto de esta elección.");
    window.dispatchEvent(new Event("backyard-before-legal-navigation"));
    const actor = legalActorForIdentity(localStorage, identity);
    let next = readLegalEvidence(localStorage, actor.actorKey, legalEnvironment);
    for (const choice of choices) {
      const latest = latestLegalEvidence(next, choice.subject);
      if (latest?.action === choice.action) continue;
      recordLocalLegalEvidence(localStorage, identity, {
        environment: legalEnvironment,
        subject: choice.subject,
        action: choice.action,
        origin,
      });
      next = readLegalEvidence(localStorage, actor.actorKey, legalEnvironment);
    }
    if (identity.mode === "guest") {
      setLegalEvents(next);
      setCloudIssue("legal", null);
      return;
    }
    if (!identity.accessToken || !navigator.onLine) {
      setLegalEvents(next);
      setCloudIssue("legal", {
        domain: "legal",
        kind: "offline",
        message: "Sin conexión · tus elecciones están guardadas en este dispositivo y pendientes de recepción del servidor.",
        retryable: true,
      });
      return;
    }
    try {
      const synced = await syncLegalEvidence(identity.userId, identity.accessToken, next);
      setLegalEvents(synced);
      setCloudIssue("legal", null);
    } catch (error) {
      setCloudIssue("legal", {
        ...cloudIssueFromError("legal", error, navigator.onLine),
        message: error instanceof Error ? error.message : "No pudimos confirmar tus elecciones legales.",
      });
      throw error;
    }
  }

  async function acceptConsent(choices: LegalCeremonyChoices) {
    const origin = priorLegalHistory ? "existing_user_update" : "onboarding";
    await recordChoiceBatch([
      { subject: "privacy_notice", action: "presented" },
      { subject: "terms", action: "accepted" },
      { subject: "age_declaration", action: "accepted" },
      { subject: "financial_data", action: choices.financial },
      { subject: "marketing", action: choices.marketing },
    ], origin);
    setLegalReconsidering(false);
    setLegalUpdateDeferred(false);
  }

  async function rejectTerms() {
    const origin = priorLegalHistory ? "existing_user_update" : "onboarding";
    await recordChoiceBatch([
      { subject: "privacy_notice", action: "presented" },
      { subject: "terms", action: "rejected" },
    ], origin);
    setLegalReconsidering(false);
    setLegalUpdateDeferred(false);
  }

  async function recordLegalChoice(subject: LegalEvidenceSubject, action: LegalEvidenceAction, origin: "account_privacy" | "financial_gate" = "account_privacy") {
    await recordChoiceBatch([{ subject, action }], origin);
  }

  async function acceptBettingConsent() {
    await recordChoiceBatch([{ subject: "financial_data", action: "accepted" }], "financial_gate");
    closeBettingConsent(true);
  }

  async function rejectBettingConsent() {
    await recordChoiceBatch([{ subject: "financial_data", action: "rejected" }], "financial_gate");
    closeBettingConsent(false);
  }

  async function updateProfile(profile: Pick<BackyardProfile, "displayName" | "defaultHandicap" | "avatarUrl">) {
    if (!identity) return;
    const next = mergeBackyardProfile(identity, profile);
    if (identity.mode === "guest") {
      setIdentity(next);
      localStorage.setItem(ACCOUNT_STORAGE_KEYS.guestProfile, JSON.stringify(profile));
      return;
    }
    const supabase = getSupabaseBrowser();
    const updatedAt = new Date().toISOString();
    if (!supabase) throw new Error("Supabase unavailable");
    await saveCloudProfile(supabase, identity.userId, profile, updatedAt);
    if (activeUserId.current !== identity.userId) return;
    setIdentity(next);
    localStorage.setItem(`backyard-profile-cache-v1:${identity.userId}`, JSON.stringify(profile));
    setProfileSetupRequired(false);
    localStorage.setItem(`backyard-profile-ready-v1:${identity.userId}`, "true");
    setCloudIssue("profile", null);
  }

  async function logout() {
    try {
      const supabase = getSupabaseBrowser();
      if (supabase) await closeAuthSession(supabase.auth);
    } catch {
      issueWithMessage("auth", "No pudimos cerrar la sesión. Revisa tu conexión e inténtalo nuevamente.");
      return;
    }
    {
      switchAccountWorkspace(localStorage, "guest");
      localStorage.removeItem(ACCOUNT_STORAGE_KEYS.mode);
      activeUserId.current = null;
      setIdentity(null);
      setAccessRequested(false);
      setCloudLinked(false);
      setCloudStatus("local");
      setLastCloudSync(null);
      setCloudIssuesByDomain({});
    }
  }

  async function finishAccountDeletion() {
    if (!identity || identity.mode !== "authenticated") return;
    const deletedUserId = identity.userId;
    // Invalidate every in-flight sync before touching the local Supabase cache.
    activeUserId.current = null;
    discardAccountWorkspace(localStorage, deletedUserId);
    localStorage.removeItem(legalEvidenceStateKey(`account:${deletedUserId}`, legalEnvironment));
    localStorage.removeItem(ACCOUNT_STORAGE_KEYS.mode);
    const remainingAcceptances = clearLegalAcceptancesForUser(acceptances, deletedUserId);
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(remainingAcceptances));
    setAcceptances(remainingAcceptances);
    setLegalEvents([]);
    const supabase = getSupabaseBrowser();
    if (supabase) await clearDeletedAuthSession(supabase.auth);
    setIdentity(null);
    setAccessRequested(false);
    setCloudLinked(false);
    setCloudStatus("local");
    setLastCloudSync(null);
    setCloudIssuesByDomain({});
    setShowMigration(false);
  }

  async function keepLocalDataForAccount() {
    if (!identity || identity.mode !== "authenticated" || !identity.accessToken) return;
    setMigrationBusy(true); setMigrationError(""); setCloudStatus("pending");
    // Legal evidence is identity-bound and is never reassigned from a guest
    // merely because the user imports that guest's golf workspace.
    // Approval enables the same guarded sync cycle as all later syncs. Do not
    // blindly upload before downloading/merging the account's existing data.
    if (!ownsLocalWorkspace(localStorage, identity.userId)) return;
    localStorage.setItem(migrationDecisionStorageKey(identity.userId), "linked");
    setCloudLinked(true);
    setCloudStatus("pending");
    setShowMigration(false);
    setMigrationBusy(false);
  }

  const cloudSessionUserId = identity?.mode === "authenticated" ? identity.userId : "";
  const recoverCloudSession = useCallback(async (forceRefresh = false) => {
    const expectedUserId = cloudSessionUserId;
    if (!expectedUserId) throw new AuthSessionRecoveryError("invalid", new Error("account_session_missing"));
    if (sessionRecovery.current?.userId === expectedUserId) return sessionRecovery.current.promise;
    const recovery = (async () => {
      const supabase = getSupabaseBrowser();
      if (!supabase) throw new AuthSessionRecoveryError("invalid", new Error("account_session_missing"));
      try {
        const session = await recoverAuthSession(supabase.auth, { forceRefresh });
        if (!session || session.user.id !== expectedUserId) throw new AuthSessionRecoveryError("invalid", new Error("account_session_missing"));
        if (activeUserId.current !== expectedUserId) throw new AuthSessionRecoveryError("transient", new Error("account_session_changed"));
        activateSession(session, { rehydrate: true });
        setCloudIssue("auth", null);
        return session.access_token;
      } catch (error) {
        // A late response from account A must never update account B's notices
        // or provide A's token to B's synchronization cycle.
        if (activeUserId.current !== expectedUserId) throw error;
        const cause = error instanceof AuthSessionRecoveryError ? error.cause : error;
        const issue = cloudIssueFromError("auth", cause, navigator.onLine);
        setCloudIssue("auth", issue);
        if (issue.kind === "session_expired") {
          setIdentity((current) => current?.mode === "authenticated" ? { ...current, accessToken: null } : current);
          setRawCloudStatus("error");
        }
        throw error;
      }
    })();
    sessionRecovery.current = { userId: expectedUserId, promise: recovery };
    try { return await recovery; }
    finally { if (sessionRecovery.current?.promise === recovery) sessionRecovery.current = null; }
  }, [activateSession, cloudSessionUserId, setCloudIssue]);

  // A cloud 401 uses a forced, single refresh. Manual retry first validates
  // the persisted session and refreshes only when expired/near expiry, which
  // avoids unnecessary refresh-token rotations across Safari/PWA tabs.
  const refreshCloudSession = useCallback(() => recoverCloudSession(true), [recoverCloudSession]);

  const retryAllCloud = async () => {
    if (!navigator.onLine) {
      setRawCloudStatus("offline");
      setCloudIssue("round", cloudIssueFromError("round", new Error("offline"), false));
      return;
    }
    if (identity?.mode === "authenticated") {
      try {
        await recoverCloudSession(false);
      } catch { return; }
    } else {
      setLegalRetryRevision(value => value + 1);
      setAccountReloadRevision(value => value + 1);
      window.setTimeout(() => window.dispatchEvent(new Event("backyard-sync-retry")), 0);
    }
    setRawCloudStatus("pending");
  };
  const cloudIssues = Object.values(cloudIssuesByDomain).filter((issue): issue is CloudIssue => Boolean(issue)).sort((left, right) => cloudIssuePriority(left) - cloudIssuePriority(right));
  const blockingCloudIssues = cloudIssues.filter((issue) => issue.kind === "session_expired");
  const effectiveCloudStatus: AccountContextValue["cloudStatus"] = cloudIssues.some((issue) => issue.kind === "offline") ? "offline" : cloudIssues.some((issue) => issue.kind === "conflict") ? "pending" : cloudIssues.length ? "error" : cloudStatus;
  const context = identity ? ({ identity, updateProfile, logout, finishAccountDeletion, openAccess: () => setAccessRequested(true), acceptances, legalEvents, bettingConsentGranted, bettingConsentResolved, requestBettingConsent, marketingConsentGranted, recordLegalChoice, cloudLinked, cloudStatus: effectiveCloudStatus, setCloudStatus, lastCloudSync, cloudIssues, applyCloudPreferences,
    reportCloudSyncError,
    clearCloudSyncError,
    retryCloudSync: retryAllCloud,
    refreshCloudSession,
    requestCloudLink: () => { setMigrationError(""); setShowMigration(true); } }) : null;
  const migrationDialog = showMigration && <div className="modalBackdrop"><section className="confirmDialog migrationDialog" role="dialog" aria-modal="true" aria-labelledby="migration-title">
    <h2 id="migration-title">Encontramos datos de The Backyard en este dispositivo.</h2>
    <p>Nada se borrará de este dispositivo. La importación usa los mismos identificadores para poder reintentarse sin duplicar rondas.</p>
    {migrationError && <div className="notice bad" role="alert">{migrationError}</div>}
    <div className="migrationActions"><button className="primary" disabled={migrationBusy} onClick={keepLocalDataForAccount}>{migrationBusy ? "Vinculando…" : "Vincular a mi cuenta"}</button><button className="secondary" disabled={migrationBusy} onClick={() => { if (identity) localStorage.setItem(migrationDecisionStorageKey(identity.userId), "skip"); setCloudLinked(false); setCloudStatus("local"); setShowMigration(false); }}>Ahora no</button></div>
  </section></div>;

  if (!ready) return <main className="accessScreen"><div className="accessLoading">Cargando The Backyard…</div></main>;
  if (!identity || accessRequested) return <AccessScreen onGuest={async () => {
    if (activeUserId.current) {
      const supabase = getSupabaseBrowser();
      if (!supabase) throw new Error("Session unavailable");
      await closeAuthSession(supabase.auth);
    }
    switchAccountWorkspace(localStorage, "guest");
    activeUserId.current = null;
    const profile = guestProfile();
    const guestIdentity = { ...profile, mode: "guest" as const, providers: [], accessToken: null };
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.mode, "guest");
    setIdentity(guestIdentity);
    setLegalEvents(readIdentityLegalEvents(guestIdentity));
    setCloudConsentChecked(true);
    setAccessRequested(false);
    setCloudIssuesByDomain({}); setCloudStatus("local"); setCloudLinked(false); setLastCloudSync(null); setShowMigration(false);
  }} sessionError={accountCloudError} onAuthenticated={(session) => { activateSession(session); setAccessRequested(false); }} />;
  if (identity.mode === "authenticated" && !currentConsent && !cloudConsentChecked) return <main className="accessScreen"><div className="accessLoading">Verificando tus consentimientos…</div></main>;
  if (!currentConsent && !priorLegalHistory) return <>{accountCloudError && <div role="alert" className="notice bad">{accountCloudError}</div>}<LegalConsentScreen mode="first_access" onSubmit={acceptConsent} onRejectTerms={rejectTerms} /></>;
  if (identity.mode === "authenticated" && !profileChecked) return <main className="accessScreen"><div className="accessLoading">Preparando tu perfil…</div></main>;
  if (identity.mode === "authenticated" && profileSetupRequired) return <>{accountCloudError && <div role="alert" className="notice bad">{accountCloudError}</div>}<ProfileSetupScreen identity={identity} onSave={updateProfile} onBack={logout} /></>;

  return <AccountContext.Provider value={context!}>
    {blockingCloudIssues.map((issue) => <div className="notice bad" role="alert" key={issue.domain}>{issue.message}<button onClick={() => setAccessRequested(true)}>Volver a iniciar sesión</button></div>)}
    <Fragment key={identity.userId}>{children}</Fragment>
    {migrationDialog}
    {!currentConsent && legalUpdateDeferred && !termsRejected && <div className="legalUpdateBanner" role="status"><span>Actualización legal pendiente · tu ronda actual sigue disponible.</span><button type="button" onClick={() => { window.dispatchEvent(new Event("backyard-before-legal-navigation")); setLegalUpdateDeferred(false); }}>Revisar ahora</button></div>}
    {!currentConsent && !legalUpdateDeferred && !termsRejected && <div className="legalModalLayer"><LegalConsentScreen mode="update" onSubmit={acceptConsent} onRejectTerms={rejectTerms} /></div>}
    {!currentConsent && termsRejected && !legalReconsidering && <div className="legalModalLayer"><LegalRestrictedScreen identity={identity} onReview={() => setLegalReconsidering(true)} onLogout={logout} onDeleted={finishAccountDeletion} /></div>}
    {!currentConsent && termsRejected && legalReconsidering && <div className="legalModalLayer"><LegalConsentScreen mode="update" onSubmit={acceptConsent} onRejectTerms={rejectTerms} /></div>}
    {bettingConsentOpen && <div className="legalModalLayer"><BettingConsentDialog onDismiss={() => closeBettingConsent(false)} onReject={rejectBettingConsent} onAccept={acceptBettingConsent} /></div>}
  </AccountContext.Provider>;
}
