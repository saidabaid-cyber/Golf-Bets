"use client";
import { saveCloudProfile } from "../../lib/cloud-account";

import Link from "next/link";
import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  ACCOUNT_STORAGE_KEYS,
  authErrorMessage,
  buildLegalAcceptances,
  hasCurrentLegalConsent,
  hasLocalGolfData,
  isValidEmail,
  mergeLegalAcceptances,
  mergeBackyardProfile,
  migrationDecisionStorageKey,
  normalizeBackyardProfileCache,
  normalizeOtp,
  parseLegalAcceptances,
  type AccountMode,
  type BackyardProfile,
  type LegalAcceptance,
} from "../../lib/account-state";
import { getSupabaseBrowser } from "../../lib/supabase/client";
import { authIdentityChanged, closeAuthSession, isAccountSession, requireCloudWrites, restoreAuthSession, sendEmailOtp, startSocialOAuth, verifyEmailOtp, OtpSendGate, otpRetrySeconds, OTP_COOLDOWN_KEY } from "../../lib/auth-flow";
import { ownsLocalWorkspace, switchAccountWorkspace } from "../../lib/account-workspace";
import { CLOUD_LOCAL_META_KEY, type CloudPreferences } from "../../lib/cloud-sync";
import type { AuthProviderStatus } from "../../lib/auth-provider-status";
import { BrandLockup } from "./brand-lockup";

export type BackyardIdentity = BackyardProfile & {
  mode: Exclude<AccountMode, "undecided">;
  providers: string[];
  accessToken: string | null;
};

type AccountContextValue = {
  identity: BackyardIdentity;
  updateProfile: (profile: Pick<BackyardProfile, "displayName" | "defaultHandicap" | "avatarUrl">) => Promise<void>;
  logout: () => Promise<void>;
  openAccess: () => void;
  acceptances: LegalAcceptance[];
  cloudLinked: boolean;
  cloudStatus: "local" | "syncing" | "synced" | "pending" | "error";
  setCloudStatus: (status: AccountContextValue["cloudStatus"]) => void;
  requestCloudLink: () => void;
  lastCloudSync: string | null;
  cloudError: string;
  retryCloudSync: () => void;
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
    if (saved && typeof saved === "object") return {
      userId: "guest",
      displayName: typeof saved.displayName === "string" ? saved.displayName : "Invitado",
      email: "",
      avatarUrl: typeof saved.avatarUrl === "string" ? saved.avatarUrl : "",
      defaultHandicap: typeof saved.defaultHandicap === "number" ? saved.defaultHandicap : null,
    };
  } catch { /* keep safe guest defaults */ }
  return { userId: "guest", displayName: "Invitado", email: "", avatarUrl: "", defaultHandicap: null };
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

  async function social(provider: "google" | "apple") {
    if (!providers || providers.status === "unavailable") {
      setMessage("No pudimos comprobar el proveedor de acceso. Revisa tu conexión y vuelve a intentar.");
      return;
    }
    if (!socialEnabled || !providers[provider]) {
      setMessage(`Acceso con ${provider === "google" ? "Google" : "Apple"} pendiente de configuración.`);
      return;
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setMessage(`Acceso con ${provider === "google" ? "Google" : "Apple"} pendiente de configuración.`);
      return;
    }
    setBusy(true); setMessage("");
    try {
      await startSocialOAuth(supabase.auth, provider, `${window.location.origin}/auth/callback`);
    } catch (error) {
      setMessage(authErrorMessage(error, provider));
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
    if (otp.length !== 6) { setMessage("Introduce los 6 dígitos del código."); return; }
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
        {(["apple", "google"] as const).map(provider => {
          const name = provider === "apple" ? "Apple" : "Google";
          const available = socialEnabled && providers?.status === "ready" && providers[provider];
          const label = !providers ? `${name} · comprobando acceso…` : providers.status === "unavailable" ? `${name} · acceso no disponible` : !available ? `${name} · pendiente de configuración` : `Continuar con ${name}`;
          return <button key={provider} className={`oauthButton ${provider}`} disabled={busy || !available} onClick={() => social(provider)}>{label}</button>;
        })}
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
          <label htmlFor="access-otp">Introduce los 6 dígitos del correo</label>
          <input id="access-otp" className="otpInput" aria-label="Código de seis dígitos" inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={busy} value={otp} onChange={(event) => setOtp(normalizeOtp(event.target.value))} placeholder="6 dígitos" />
          <p className="hint">Todavía no has iniciado sesión. Tu cuenta se abrirá solo al verificar el código.</p>
          <details className="hint"><summary>¿Recibiste un enlace en lugar del código?</summary><p>El correo de Supabase necesita la plantilla de código de seis dígitos. Ese enlace no sustituye esta verificación; puedes regresar y elegir explícitamente el modo invitado.</p></details>
          <button className="primary big" disabled={busy || otp.length !== 6} onClick={verifyCode}>{busy ? "Verificando…" : "Verificar"}</button>
          <div className="otpLinks"><button className="textButton" disabled={busy || retrySeconds > 0} onClick={sendCode}>{retrySeconds ? `Reenviar en ${retrySeconds}s` : "Reenviar código"}</button><button className="textButton" disabled={busy} onClick={() => { setCodeSent(false); setOtp(""); setMessage(""); }}>Cambiar correo</button></div>
          <button className="textButton" disabled={busy} onClick={() => { setEmailMode(false); setMessage(""); }}>← Regresar al acceso</button>
        </>}
      </div>}
      {!socialEnabled && <p id="social-auth-status" className="hint">Google y Apple · Pendiente de configuración</p>}
      {socialEnabled && providers?.status === "ready" && <p className="hint">{!providers.google && "Google · Pendiente de configuración. "}{!providers.apple && "Apple · Pendiente de configuración."}</p>}
      {(message || sessionError) && <div className="accessMessage" role="status">{message || sessionError}</div>}
      <p className="hint">Invitado es un acceso independiente: no inicia sesión ni sincroniza tus datos con una cuenta.</p>
      <p className="legalLead">Al continuar aceptas los <Link href="/legal/terms">Términos de Uso</Link> y el <Link href="/legal/privacy">Aviso de Privacidad</Link>.</p>
    </section>
  </main>;
}

function ConsentScreen({ onAccept, onBack }: { onAccept: () => Promise<void>; onBack: () => Promise<void> }) {
  const [rules, setRules] = useState(false);
  const [age, setAge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <main className="consentScreen"><section className="consentCard">
    <BrandLockup compact />
    <div className="eyebrow">PRIMER ACCESO</div>
    <h1>Antes de la primera controversia</h1>
    <p>The Backyard incorpora un asistente de reglas basado en las Reglas de Golf, aclaraciones y reglas locales disponibles.</p>
    <p>Cuando un grupo acuerde utilizar el Árbitro de Reglas de The Backyard como criterio para resolver una situación durante una partida, sus jugadores aceptan aplicar la resolución mostrada salvo que exista una decisión oficial de un Comité, árbitro autorizado o autoridad competente de la competencia.</p>
    <div className="officialPriority">En una competencia oficial, el Comité o árbitro oficial tiene siempre la decisión final. La IA no es un árbitro oficial USGA.</div>
    <label className="consentCheck"><input type="checkbox" checked={rules} onChange={(event) => setRules(event.target.checked)} /><span>Entiendo el alcance del Árbitro de Reglas y acepto utilizar sus resoluciones como referencia acordada entre los participantes cuando corresponda.</span></label>
    <label className="consentCheck"><input type="checkbox" checked={age} onChange={(event) => setAge(event.target.checked)} /><span>Confirmo que tengo 18 años o más.</span></label>
    <p className="legalLead">También confirmas los <Link href="/legal/terms">Términos de Uso</Link> y el <Link href="/legal/privacy">Aviso de Privacidad</Link>.</p>
    {error && <p role="alert">{error}</p>}
    <button className="primary big" disabled={!rules || !age || busy} onClick={async () => { setBusy(true); setError(""); try { await onAccept(); } catch { setError("No pudimos guardar tu aceptación en Supabase. Revisa tu conexión y vuelve a intentar."); } finally { setBusy(false); } }}>{busy ? "Guardando…" : "Continuar"}</button>
    <button className="textButton consentBack" disabled={busy} onClick={onBack}>← Volver al acceso</button>
  </section></main>;
}

function ProfileSetupScreen({ identity, onSave, onBack }: {
  identity: BackyardIdentity;
  onSave: (profile: Pick<BackyardProfile, "displayName" | "defaultHandicap" | "avatarUrl">) => Promise<void>;
  onBack: () => Promise<void>;
}) {
  const [name, setName] = useState(identity.displayName === "Jugador" ? "" : identity.displayName);
  const [handicap, setHandicap] = useState<string>(identity.defaultHandicap === null ? "" : String(identity.defaultHandicap));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <main className="consentScreen"><section className="consentCard profileSetupCard">
    <BrandLockup compact />
    <div className="eyebrow">THE BACKYARD ACCOUNT</div>
    <h1>Completa tu perfil</h1>
    <p>Solo necesitamos lo esencial para identificarte en tus rondas.</p>
    <label htmlFor="profile-setup-name">Nombre</label>
    <input id="profile-setup-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" />
    <label htmlFor="profile-setup-hcp">HCP predeterminado</label>
    <input id="profile-setup-hcp" type="number" inputMode="decimal" min={-15} max={54} step={0.1} value={handicap} onChange={(event) => setHandicap(event.target.value)} placeholder="Ej. 7.2" />
    {message && <div className="accessMessage" role="status">{message}</div>}
    <button className="primary big" disabled={busy || !name.trim() || handicap === ""} onClick={async () => {
      const parsed = Number(handicap);
      if (!Number.isFinite(parsed) || parsed < -15 || parsed > 54) { setMessage("Escribe un HCP válido entre -15 y 54."); return; }
      setBusy(true); setMessage("");
      try { await onSave({ displayName: name.trim(), defaultHandicap: parsed, avatarUrl: identity.avatarUrl }); }
      catch { setMessage("No pudimos completar el perfil. Revisa tu conexión e intenta nuevamente."); }
      finally { setBusy(false); }
    }}>{busy ? "Guardando…" : "Guardar y continuar"}</button>
    <button className="textButton" disabled={busy} onClick={onBack}>← Volver al acceso</button>
  </section></main>;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<BackyardIdentity | null>(null);
  const [acceptances, setAcceptances] = useState<LegalAcceptance[]>([]);
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
  const [accountCloudError, setAccountCloudError] = useState("");
  const setCloudStatus = useCallback((status: AccountContextValue["cloudStatus"]) => {
    setRawCloudStatus(status);
    if (status === "synced" && activeUserId.current) {
      const at = new Date().toISOString();
      setLastCloudSync(at);
      localStorage.setItem(`backyard-last-sync-v1:${activeUserId.current}`, at);
    }
  }, []);
  const applyCloudPreferences = useCallback((preferences: CloudPreferences) => {
    setIdentity(current => current?.mode === "authenticated" ? { ...current, defaultHandicap: preferences.defaultHandicap } : current);
  }, []);
  useEffect(() => {
    if (identity?.mode === "authenticated") {
      const { displayName, defaultHandicap, avatarUrl } = identity;
      try { localStorage.setItem(`backyard-profile-cache-v1:${identity.userId}`, JSON.stringify({ displayName, defaultHandicap, avatarUrl })); }
      catch { setAccountCloudError("No se pudo guardar el perfil local. Libera espacio y reintenta."); }
    }
  }, [identity]);

  const activateSession = useCallback((session: Session) => {
    if (!isAccountSession(session)) throw new Error("account_session_missing");
    if (!authIdentityChanged(activeUserId.current, session.user.id)) {
      setIdentity((current) => current ? { ...current, accessToken: session.access_token, email: session.user.email || current.email } : current);
      return;
    }
    switchAccountWorkspace(localStorage, session.user.id);
    activeUserId.current = session.user.id;
    setLastCloudSync(localStorage.getItem(`backyard-last-sync-v1:${session.user.id}`));
    setAccountCloudError("");
    const profile = profileFromUser(session.user);
    setIdentity({ ...profile, mode: "authenticated", providers: session.user.app_metadata?.providers || [session.user.app_metadata?.provider].filter((value): value is string => Boolean(value)), accessToken: session.access_token });
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.mode, "authenticated");
    setCloudConsentChecked(false);
    setProfileChecked(false);
    const migrationDecision = localStorage.getItem(migrationDecisionStorageKey(session.user.id));
    const localDataExists = hasLocalGolfData(localStorage);
    if (!localDataExists && !migrationDecision) localStorage.setItem(migrationDecisionStorageKey(session.user.id), "linked");
    setCloudLinked(migrationDecision === "linked" || !localDataExists);
    setCloudStatus(migrationDecision === "linked" || !localDataExists ? "pending" : "local");
    setShowMigration(localDataExists && !migrationDecision);
  }, [setCloudStatus]);

  useEffect(() => {
    const localAcceptances = parseLegalAcceptances(localStorage.getItem(ACCOUNT_STORAGE_KEYS.acceptances));
    setAcceptances(localAcceptances);
    const supabase = getSupabaseBrowser();
    let mounted = true;
    let authEventRevision = 0;
    if (supabase) restoreAuthSession(supabase.auth).then((session) => {
      if (!mounted || authEventRevision !== 0) return;
      if (session) activateSession(session);
      else if (localStorage.getItem(ACCOUNT_STORAGE_KEYS.mode) === "guest") {
        const profile = guestProfile();
        setIdentity({ ...profile, mode: "guest", providers: [], accessToken: null });
        setCloudConsentChecked(true);
      }
      setReady(true);
    }).catch((error) => {
      if (!mounted || authEventRevision !== 0) return;
      setAccountCloudError(authErrorMessage(error));
      setReady(true);
    });
    if (!supabase) {
      if (localStorage.getItem(ACCOUNT_STORAGE_KEYS.mode) === "guest") {
        const profile = guestProfile();
        setIdentity({ ...profile, mode: "guest", providers: [], accessToken: null });
        setCloudConsentChecked(true);
      }
      setReady(true);
    }
    const listener = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      authEventRevision += 1;
      const revision = authEventRevision;
      // Supabase holds an auth lock during callbacks. Read getSession only after
      // the callback returns; stale reads cannot reactivate a logged-out identity.
      window.setTimeout(() => {
        if (!mounted || revision !== authEventRevision) return;
        void restoreAuthSession(supabase.auth).then(current => {
          if (!mounted || revision !== authEventRevision) return;
          if (current && current.user.id === session?.user.id) activateSession(current);
          else if (!current) {
            activeUserId.current = null;
            if (localStorage.getItem(ACCOUNT_STORAGE_KEYS.mode) === "guest") {
              setIdentity({ ...guestProfile(), mode: "guest", providers: [], accessToken: null });
              setCloudConsentChecked(true);
            } else { switchAccountWorkspace(localStorage, "guest"); setIdentity(null); }
            setCloudLinked(false); setCloudStatus("local"); setLastCloudSync(null);
          }
          setReady(true);
        }).catch(error => {
          if (!mounted || revision !== authEventRevision) return;
          setAccountCloudError(authErrorMessage(error)); setReady(true);
        });
      }, 0);
    });
    return () => { mounted = false; listener?.data.subscription.unsubscribe(); };
  }, [activateSession, setCloudStatus]);

  useEffect(() => {
    if (identity?.mode !== "authenticated") return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    let mounted = true;
    Promise.all([
      supabase.from("legal_acceptances").select("user_id,type,version,accepted_at,locale").eq("user_id", identity.userId),
      supabase.from("profiles").select("display_name,avatar_url,default_handicap,onboarding_completed_at").eq("id", identity.userId).maybeSingle(),
      supabase.from("user_preferences").select("default_handicap").eq("user_id", identity.userId).maybeSingle(),
    ]).then(([legalResult, profileResult, preferencesResult]) => {
      if (!mounted) return;
      if (!legalResult.error && Array.isArray(legalResult.data)) {
        const cloud = legalResult.data.map((item) => ({ userId: item.user_id, type: item.type, documentVersion: item.version, acceptedAt: item.accepted_at, locale: item.locale })) as LegalAcceptance[];
        setAcceptances((current) => {
          const merged = mergeLegalAcceptances(current, cloud);
          localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(merged));
          return merged;
        });
      }
      if (!profileResult.error && profileResult.data) {
        const cloudProfile = profileResult.data;
        setIdentity((current) => current ? ({ ...current,
          displayName: typeof cloudProfile.display_name === "string" && cloudProfile.display_name.trim() ? cloudProfile.display_name : current.displayName,
          avatarUrl: typeof cloudProfile.avatar_url === "string" ? cloudProfile.avatar_url : current.avatarUrl,
          // Existing preference clocks belong to the full sync merge. Updating
          // just HCP here would masquerade as a local edit on the next autosave.
          defaultHandicap: preferencesResult.error || localStorage.getItem(CLOUD_LOCAL_META_KEY) ? current.defaultHandicap : preferencesResult.data ? preferencesResult.data.default_handicap : cloudProfile.default_handicap ?? null,
        }) : current);
        setProfileSetupRequired(!cloudProfile.onboarding_completed_at);
      } else {
        setAccountCloudError("No pudimos leer tu perfil en Supabase. Los datos locales siguen disponibles; revisa la conexión y las migraciones.");
        setProfileSetupRequired(true);
      }
      if (legalResult.error) setAccountCloudError("No pudimos leer tus consentimientos en Supabase. No se ha confirmado su sincronización.");
      if (preferencesResult.error) setAccountCloudError("No pudimos leer tus preferencias en Supabase. Reintenta antes de sincronizar cambios.");
    }).catch(() => { if (mounted) setAccountCloudError("No pudimos leer la cuenta en Supabase. Revisa tu conexión."); }).finally(() => { if (mounted) { setCloudConsentChecked(true); setProfileChecked(true); } });
    return () => { mounted = false; };
  }, [identity?.mode, identity?.userId]);

  const currentConsent = identity ? hasCurrentLegalConsent(acceptances, identity.userId) : false;

  useEffect(() => {
    if (identity?.mode !== "authenticated" || !currentConsent) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const current = acceptances.filter((item) => item.userId === identity.userId);
    const rulesAcceptance = current.find((item) => item.type === "rules_referee");
    const writes = [supabase.from("legal_acceptances").upsert(current.map((item) => ({
      user_id: item.userId,
      type: item.type,
      version: item.documentVersion,
      accepted_at: item.acceptedAt,
      locale: item.locale,
    })), { onConflict: "user_id,type,version", ignoreDuplicates: true })];
    if (rulesAcceptance) writes.push(supabase.from("rules_referee_acceptances").upsert({
      user_id: rulesAcceptance.userId,
      document_version: rulesAcceptance.documentVersion,
      accepted_at: rulesAcceptance.acceptedAt,
      locale: rulesAcceptance.locale,
    }, { onConflict: "user_id,document_version", ignoreDuplicates: true }));
    let mounted = true;
    void requireCloudWrites(writes).catch(() => { if (mounted) setAccountCloudError("Tu aceptación está guardada en este dispositivo, pero no se pudo sincronizar con Supabase."); });
    return () => { mounted = false; };
  }, [identity?.mode, identity?.userId, currentConsent, acceptances]);

  async function acceptConsent() {
    if (!identity) return;
    const next = buildLegalAcceptances(identity.userId, new Date().toISOString());
    const merged = mergeLegalAcceptances(acceptances, next);
    if (identity.mode === "authenticated") {
      const supabase = getSupabaseBrowser();
      if (!supabase) throw new Error("Supabase unavailable");
      const writes = [supabase.from("legal_acceptances").upsert(next.map((item) => ({
        user_id: item.userId, type: item.type, version: item.documentVersion, accepted_at: item.acceptedAt, locale: item.locale,
      })), { onConflict: "user_id,type,version", ignoreDuplicates: true })];
      const rulesAcceptance = next.find((item) => item.type === "rules_referee");
      if (rulesAcceptance) writes.push(supabase.from("rules_referee_acceptances").upsert({
        user_id: rulesAcceptance.userId,
        document_version: rulesAcceptance.documentVersion,
        accepted_at: rulesAcceptance.acceptedAt,
        locale: rulesAcceptance.locale,
      }, { onConflict: "user_id,document_version", ignoreDuplicates: true }));
      await requireCloudWrites(writes);
      if (activeUserId.current !== identity.userId) return;
    }
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(merged));
    setAcceptances(merged);
    setAccountCloudError("");
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
    setAccountCloudError("");
  }

  async function logout() {
    try {
      const supabase = getSupabaseBrowser();
      if (supabase) await closeAuthSession(supabase.auth);
    } catch {
      setAccountCloudError("No pudimos cerrar la sesión. Revisa tu conexión e inténtalo nuevamente.");
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
    }
  }

  async function keepLocalDataForAccount() {
    if (!identity || identity.mode !== "authenticated" || !identity.accessToken) return;
    setMigrationBusy(true); setMigrationError(""); setCloudStatus("pending");
    const guestConsent = acceptances.filter((item) => item.userId === "guest");
    if (guestConsent.length && !hasCurrentLegalConsent(acceptances, identity.userId)) {
      const migrated = guestConsent.map((item) => ({ ...item, userId: identity.userId }));
      const merged = mergeLegalAcceptances(acceptances, migrated);
      if (identity.mode === "authenticated") {
        const supabase = getSupabaseBrowser();
        if (!supabase) { setMigrationError("Nube no disponible. Reintenta más tarde."); setMigrationBusy(false); return; }
        if (supabase) {
          const rulesAcceptance = migrated.find((item) => item.type === "rules_referee");
          const writes = [supabase.from("legal_acceptances").upsert(migrated.map((item) => ({ user_id: item.userId, type: item.type, version: item.documentVersion, accepted_at: item.acceptedAt, locale: item.locale })), { onConflict: "user_id,type,version", ignoreDuplicates: true })];
          if (rulesAcceptance) writes.push(supabase.from("rules_referee_acceptances").upsert({ user_id: rulesAcceptance.userId, document_version: rulesAcceptance.documentVersion, accepted_at: rulesAcceptance.acceptedAt, locale: rulesAcceptance.locale }, { onConflict: "user_id,document_version", ignoreDuplicates: true }));
          try { await requireCloudWrites(writes); }
          catch { setMigrationError("No pudimos guardar los consentimientos. Nada se marcó como sincronizado; reintenta."); setMigrationBusy(false); setCloudStatus("error"); return; }
          if (activeUserId.current !== identity.userId) return;
          localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(merged));
          setAcceptances(merged);
        }
      }
    }
    // Approval enables the same guarded sync cycle as all later syncs. Do not
    // blindly upload before downloading/merging the account's existing data.
    if (!ownsLocalWorkspace(localStorage, identity.userId)) return;
    localStorage.setItem(migrationDecisionStorageKey(identity.userId), "linked");
    setCloudLinked(true);
    setCloudStatus("pending");
    setShowMigration(false);
    setMigrationBusy(false);
  }

  const context = identity ? ({ identity, updateProfile, logout, openAccess: () => setAccessRequested(true), acceptances, cloudLinked, cloudStatus: accountCloudError ? "error" as const : cloudStatus, setCloudStatus, lastCloudSync, cloudError: accountCloudError, applyCloudPreferences,
    retryCloudSync: () => { if (accountCloudError) window.location.reload(); else window.dispatchEvent(new Event("backyard-sync-retry")); },
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
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.mode, "guest");
    setIdentity({ ...profile, mode: "guest", providers: [], accessToken: null });
    setCloudConsentChecked(true);
    setAccessRequested(false);
    setAccountCloudError(""); setCloudStatus("local"); setCloudLinked(false); setLastCloudSync(null); setShowMigration(false);
  }} sessionError={accountCloudError} onAuthenticated={(session) => { activateSession(session); setAccessRequested(false); }} />;
  if (identity.mode === "authenticated" && !currentConsent && !cloudConsentChecked) return <main className="accessScreen"><div className="accessLoading">Verificando tus consentimientos…</div></main>;
  if (!currentConsent) {
    if (migrationDialog && hasCurrentLegalConsent(acceptances, "guest")) return <main className="accessScreen">{migrationDialog}</main>;
    return <>{accountCloudError && <div role="alert" className="notice bad">{accountCloudError}</div>}<ConsentScreen onAccept={acceptConsent} onBack={logout} /></>;
  }
  if (identity.mode === "authenticated" && !profileChecked) return <main className="accessScreen"><div className="accessLoading">Preparando tu perfil…</div></main>;
  if (identity.mode === "authenticated" && profileSetupRequired) return <>{accountCloudError && <div role="alert" className="notice bad">{accountCloudError}</div>}<ProfileSetupScreen identity={identity} onSave={updateProfile} onBack={logout} /></>;

  return <AccountContext.Provider value={context!}>
    {accountCloudError && <div className="notice bad" role="alert">{accountCloudError}<button onClick={() => window.location.reload()}>Reintentar conexión</button></div>}
    <Fragment key={identity.userId}>{children}</Fragment>
    {migrationDialog}
  </AccountContext.Provider>;
}
