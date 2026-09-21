"use client";
import { saveOnboardingCheckpoint } from '../../lib/onboarding-checkpoint';
import { STORAGE_KEYS } from '../../lib/round-utils';
import { cloudAccountErrorMessage, ensureCloudProfile, saveCloudProfile } from "../../lib/cloud-account";
import { canonicalProfileUsername, normalizeProfileUsername } from "../../lib/profile-username";

import Link from "next/link";
import Image from "next/image";
import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent } from "react";
import { emailLoginRecovery } from "../../lib/email-login-recovery";
import { ModalCloseButton } from "./modal-shell";
import type { Session, User } from "@supabase/supabase-js";
import { accountDeletionPrewriteRejected, accountDeletionRecoveryAction, accountDeletionRequestBody, accountDeletionResponseConfirmed, clearAccountDeletionIntent, readAccountDeletionIntent } from "../../lib/account-deletion-client";
import { legalConfig } from "../../lib/legal-config";
import {
  ACCOUNT_STORAGE_KEYS,
  ACCOUNT_DELETION_MARKER_PREFIX,
  BETTING_DATA_CONSENT_TYPE,
  accountDeletionMarkerKey,
  authErrorMessage,
  bettingConsentPromptStorageKey,
  buildLegalAcceptances,
  buildBettingDataAcceptance,
  clampBackyardHandicap,
  clearLegalAcceptancesForUser,
  emptyBackyardProfileDetails,
  hasCurrentLegalConsent,
  hasCurrentBettingDataConsent,
  hasLocalGolfData,
  guestBackyardProfile,
  isValidEmail,
  mergeLegalAcceptances,
  markLegalAcceptancesSynced,
  mergeBackyardProfile,
  migrationDecisionStorageKey,
  normalizeBackyardProfileCache,
  normalizeOtp,
  parseLegalAcceptances,
  readOfflineAuthenticatedProfile,
  safeProfileAvatarValue,
  usernameFromEmail,
  validateProfileAvatarUrl,
  validateProfileDraft,
  type AccountMode,
  type BackyardProfile,
  type BackyardProfileUpdate,
  type LegalAcceptance,
} from "../../lib/account-state";
import { authSessionPersistence, getSupabaseBrowser, setAuthSessionPersistence } from "../../lib/supabase/client";
import { AuthSessionRecoveryError, authCallbackUrl, authIdentityChanged, clearDeletedAuthSessionForUser, closeAuthSession, isAccountSession, recoverAuthSession, requireCloudWrites, restoreAuthSession, sendEmailOtp, startSocialOAuth, verifyEmailOtp, OtpSendGate, otpRetrySeconds, OTP_COOLDOWN_KEY } from "../../lib/auth-flow";
import { activeWorkspaceScorecardPhotoIds, discardAccountWorkspace, ownsLocalWorkspace, selectAccountScorecardPhotoIds, switchAccountWorkspace, WORKSPACE_OWNER_KEY } from "../../lib/account-workspace";
import { CLOUD_LOCAL_META_KEY, type CloudPreferences } from "../../lib/cloud-sync";
import { deleteOfflineAccountData, readAllOfflineAccountRecords } from "../../lib/offline-store";
import { adoptScorecardPhotos, deleteScorecardPhotos, scorecardPhotoIdsForOwner } from "../../lib/scorecard-photo";
import { adoptGuestPhotoJobs } from "../../lib/photo-sync-queue";
import { clearPendingLegalSync, legalSyncErrorMessage, markLegalSyncFailed, queueLegalSync, readPendingLegalSync } from "../../lib/legal-sync-queue";
import type { AuthProviderStatus } from "../../lib/auth-provider-status";
import { cloudIssueFromError, cloudIssuePriority, type CloudIssue, type CloudIssueDomain } from "../../lib/cloud-issues";
import { BrandLockup } from "./brand-lockup";
import { ProfileImagePicker } from "./profile-image-picker";
import { ProfileLocationPicker } from "./profile-location-picker";
import { normalizeProfileLocation, validateProfileLocation } from "../../lib/profile-geography";
import { parseStoredProfileLocation, readProfileLocationMetadata, PROFILE_LOCATION_METADATA_KEY } from "../../lib/profile-location-sync";
import { syncExistingSocialProfileAvatar } from "../../lib/profile-avatar-sync";
import { consumeAccountEntryIntent, readAccountEntry, readCurrentAccountEntry, rememberAccountEntryIntent, type AccountEntry } from "../../lib/account-entry";
import { BettingConsentDialog } from "./betting-consent-dialog";
import { persistBettingDataConsent } from "../../lib/betting-consent";
import { acknowledgePendingProfileWrite, cloudProfileFields, cloudProfileRevisionIsNewer, cloudProfileRevisionKey, createProfileWriteCoordinator, queuePendingProfileWrite, readPendingProfileWrite, recordCloudProfileRevision, retimePendingProfileWrite, type CloudProfileFields, type ProfileWriteCoordinator } from "../../lib/profile-sync";
import { createEmptyEquipmentProfile, loadEquipmentProfile, saveEquipmentProfile } from "../../lib/golf-equipment";
import { ballFitDefaultsFromProfile } from "../../lib/ball-fitting";
import { EquipmentOnboarding } from "./equipment-onboarding";
import { BetaOnboardingFlow } from "./beta-onboarding-flow";
import { AccountConsentCheckpoint } from "./account-consent-checkpoint";
import { betaOnboardingIsActive, createBetaOnboardingProgress, persistBetaOnboardingProgress, readBetaOnboardingProgress } from "../../lib/beta-onboarding";

export type BackyardIdentity = BackyardProfile & {
  mode: Exclude<AccountMode, "undecided">;
  providers: string[];
  accessToken: string | null;
};

type AccountContextValue = {
  identity: BackyardIdentity;
  updateProfile: (profile: BackyardProfileUpdate) => Promise<"local" | "cloud">;
  logout: () => Promise<void>;
  finishAccountDeletion: () => Promise<boolean>;
  openAccess: () => void;
  acceptances: LegalAcceptance[];
  bettingConsentGranted: boolean;
  bettingConsentResolved: boolean;
  requestBettingConsent: () => Promise<boolean>;
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

function profileCachePayload(profile: BackyardProfile) {
  const {
    userId, displayName, email, avatarUrl, defaultHandicap, givenName, familyName,
    username, city, state, stateCode, country, countryCode, locationUpdatedAt, homeClub, homeClubId, preferredTee, handedness,
    typicalScore, driverDistanceYards, driverSwingSpeedBand, usualTrajectory,
    shotTendency, greenSpeed, gamePriority, priceImportance, golfProfileUpdatedAt,
    improvementGoals, primaryGoals, primaryGoal, targetHandicap, planId, ghinLinkStatus,
    bio, profileVisibility,
  } = profile;
  return {
    userId, displayName, email, avatarUrl, defaultHandicap, givenName, familyName,
    username, city, state, stateCode, country, countryCode, locationUpdatedAt, homeClub, homeClubId, preferredTee, handedness,
    typicalScore, driverDistanceYards, driverSwingSpeedBand, usualTrajectory,
    shotTendency, greenSpeed, gamePriority, priceImportance, golfProfileUpdatedAt,
    improvementGoals, primaryGoals, primaryGoal, targetHandicap, planId, ghinLinkStatus,
    bio, profileVisibility,
  };
}

export function useBackyardAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useBackyardAccount debe usarse dentro de AccountProvider");
  return value;
}

function profileFromUser(user: User): BackyardProfile {
  const email = user.email || "";
  const location = parseStoredProfileLocation(user.user_metadata?.[PROFILE_LOCATION_METADATA_KEY]);
  const base = {
    userId: user.id,
    // New accounts explicitly capture their golfer name. An email/username is
    // never silently promoted to the visible name.
    displayName: "",
    email,
    avatarUrl: safeProfileAvatarValue(user.user_metadata?.avatar_url || user.user_metadata?.picture),
    defaultHandicap: typeof user.user_metadata?.default_handicap === "number" ? clampBackyardHandicap(user.user_metadata.default_handicap) : null,
    ...emptyBackyardProfileDetails(),
    givenName: typeof user.user_metadata?.given_name === "string" ? user.user_metadata.given_name : "",
    familyName: typeof user.user_metadata?.family_name === "string" ? user.user_metadata.family_name : "",
    ...((user.user_metadata?.backyard_golf_profile_v1 && typeof user.user_metadata.backyard_golf_profile_v1 === "object") ? Object.fromEntries(["handedness", "homeClub", "homeClubId", "preferredTee"].map(key => [key, typeof user.user_metadata.backyard_golf_profile_v1[key] === "string" ? user.user_metadata.backyard_golf_profile_v1[key] : ""])) : {}),
    ...(location ? { ...normalizeProfileLocation(location), locationUpdatedAt: location.updatedAt } : {}),
    username: String(user.user_metadata?.username || usernameFromEmail(email)),
  };
  try {
    const cached = JSON.parse(localStorage.getItem(`backyard-profile-cache-v1:${user.id}`) || "null");
    const restored = normalizeBackyardProfileCache(cached, base);
    if (location && !readPendingProfileWrite(localStorage, user.id)?.profile.location && Date.parse(location.updatedAt) > (Date.parse(restored.locationUpdatedAt || "") || 0)) {
      return { ...restored, ...normalizeProfileLocation(location), locationUpdatedAt: location.updatedAt };
    }
    return restored;
  } catch { return base; }
}

function guestProfile(): BackyardProfile {
  try {
    const saved = JSON.parse(localStorage.getItem(ACCOUNT_STORAGE_KEYS.guestProfile) || "null");
    return guestBackyardProfile(saved);
  } catch { /* keep safe guest defaults */ }
  return guestBackyardProfile();
}

function nextPendingLocalDeletionOwner(storage: Pick<Storage, "getItem" | "key" | "length">, cleanedUserId = "") {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(ACCOUNT_DELETION_MARKER_PREFIX)) continue;
    const state = storage.getItem(key);
    if (state === "completed_cleanup_pending") {
      const userId = key.slice(ACCOUNT_DELETION_MARKER_PREFIX.length);
      if (userId && userId !== "guest" && userId !== cleanedUserId) return userId;
    }
  }
  return "";
}

function AccessScreen({ onGuest, onAuthenticated, sessionError }: { onGuest: () => void | Promise<void>; onAuthenticated: (session: Session) => void; sessionError: string }) {
  const [stage, setStage] = useState<"splash" | "methods">("splash");
  const [intent, setIntent] = useState<"create" | "login">("create");
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [loginRecovery, setLoginRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [socialEnabled, setSocialEnabled] = useState(true);
  const [providers, setProviders] = useState<AuthProviderStatus | null>(null);
  const [rememberSession, setRememberSession] = useState(true);
  const sendGate = useRef(new OtpSendGate());
  const oauthStarting = useRef(false);
  const [retrySeconds, setRetrySeconds] = useState(0);
  useEffect(() => {
    setRememberSession(authSessionPersistence());
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
    if (oauthStarting.current) return;
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
    oauthStarting.current = true;
    setAuthSessionPersistence(rememberSession);
    rememberAccountEntryIntent(sessionStorage, intent);
    setBusy(true); setMessage("");
    try {
      await startSocialOAuth(supabase.auth, provider, authCallbackUrl(window.location.origin));
    } catch (error) {
      oauthStarting.current = false;
      setMessage(authErrorMessage(error, provider));
      setBusy(false);
    }
  }

  async function sendCode() {
    if (!isValidEmail(email)) { setMessage("Escribe un correo electrónico válido."); return; }
    setAuthSessionPersistence(rememberSession);
    const supabase = getSupabaseBrowser();
    if (!supabase) { setMessage("Acceso con correo pendiente de configuración."); return; }
    if (providers?.status === "ready" && !providers.email) { setMessage("Acceso con correo pendiente de configuración."); return; }
    if (!sendGate.current.begin()) return;
    try { sessionStorage.setItem(OTP_COOLDOWN_KEY, String(sendGate.current.nextSendAt)); }
    catch { /* Never prevent OTP capture because optional cooldown persistence failed. */ }
    setRetrySeconds(otpRetrySeconds(sendGate.current.nextSendAt));
    setBusy(true); setMessage("");
    try {
      rememberAccountEntryIntent(sessionStorage, intent);
      await sendEmailOtp(supabase.auth, email, authCallbackUrl(window.location.origin), intent);
      setCodeSent(true);
      setMessage("Código enviado. Revisa tu correo.");
    } catch (error) {
      setMessage(authErrorMessage(error, "email"));
      if (intent === "login") setLoginRecovery(true);
    } finally { sendGate.current.finish(); setBusy(false); }
  }

  async function verifyCode() {
    if (otp.length !== 8) { setMessage("Introduce los 8 dígitos del código."); return; }
    setAuthSessionPersistence(rememberSession);
    const supabase = getSupabaseBrowser();
    if (!supabase) { setMessage("Acceso con correo pendiente de configuración."); return; }
    setBusy(true); setMessage("");
    try {
      onAuthenticated(await verifyEmailOtp(supabase.auth, email, otp));
    } catch (error) {
      setMessage(authErrorMessage(error, "otp"));
    } finally { setBusy(false); }
  }

  const googleAvailable = Boolean(socialEnabled && providers?.status === "ready" && providers.google);
  const appleAvailable = Boolean(socialEnabled && providers?.status === "ready" && providers.apple);
  return <main className="accessScreen">
    <section className={`accessCard ${stage === "splash" ? "splashCard" : ""}`}>
      {stage === "splash" && <div className="accessEditorial"><Image src="/brand/home-swing.jpg" alt="" fill sizes="(max-width: 600px) 100vw, 460px" priority /><span>GOOD GOLF.<br /><em>BETTER FRIENDS.</em></span></div>}
      <BrandLockup />
      <p className="accessTagline">Golf · Friends · More</p>
      <p className="accessPromise">Tu juego, tu grupo habitual y todo lo que pasa después del último putt.</p>
      {stage === "splash" ? <div className="accessActions splashActions">
        <button className="primary big" onClick={() => { setIntent("create"); setStage("methods"); }}>Crear cuenta</button>
        <button className="secondary big" onClick={() => { setIntent("login"); setStage("methods"); }}>Iniciar sesión</button>
        <button className="guestButton" disabled={busy} onClick={async () => {
          setBusy(true); setMessage("");
          try { await onGuest(); } catch { setMessage("No pudimos abrir el modo invitado. Inténtalo nuevamente."); }
          finally { setBusy(false); }
        }}>Continuar como invitado</button>
      </div> : <>
      <div className="accessIntent"><button className="textButton" onClick={() => { setStage("splash"); setEmailMode(false); setMessage(""); }}>← Inicio</button><span>{intent === "create" ? "CREAR CUENTA" : "INICIAR SESIÓN"}</span></div>
      <label className="consentCheck"><input type="checkbox" checked={rememberSession} onChange={(event) => { setRememberSession(event.target.checked); setAuthSessionPersistence(event.target.checked); }} /><span>Mantener sesión iniciada en este dispositivo.</span></label>
      {!emailMode ? <div className="accessActions">
        <button className="oauthButton google" disabled={busy || !googleAvailable} onClick={() => social("google")}>{!providers ? "Google · comprobando acceso…" : googleAvailable ? "Continuar con Google" : "Google · pendiente de configuración"}</button>
        <button className="oauthButton apple" disabled={busy || !appleAvailable} onClick={() => social("apple")}>{appleAvailable ? "Continuar con Apple" : "Apple · Próximamente"}</button>
        <button className="secondary big" disabled={busy} onClick={() => { setEmailMode(true); setMessage(""); }}>{intent === "create" ? "Registro con email" : "Continuar con correo"}</button>
        <button className="guestButton" disabled={busy} onClick={async () => {
          setBusy(true); setMessage("");
          try { await onGuest(); } catch { setMessage("No pudimos salir de la sesión anterior. Reintenta antes de continuar como invitado."); }
          finally { setBusy(false); }
        }}>Continuar como invitado</button>
      </div> : <div className="emailAccess">
        {!codeSent ? <>
          <label htmlFor="access-email">Correo electrónico</label>
          <input id="access-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" />
          {intent === "create" && <p className="hint">Verifica tu correo para continuar; si ya tienes cuenta, entraremos a ella.</p>}
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
      </div>}</>}
      {!socialEnabled && <p id="social-auth-status" className="hint">Google · Pendiente de configuración</p>}
      {socialEnabled && providers?.status === "ready" && !providers.google && <p className="hint">Google · Pendiente de configuración.</p>}
      {(message || sessionError) && <div className="accessMessage" role="status">{message || sessionError}</div>}
      {loginRecovery && <div className="modalBackdrop" onKeyDown={(event) => { if (event.key === "Escape") setLoginRecovery(false); }}><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="email-login-recovery-title">
        <h2 id="email-login-recovery-title">{emailLoginRecovery()}</h2>
        <p>{message}</p>
        <div className="dialogActions"><button autoFocus type="button" className="primary" onClick={() => { setLoginRecovery(false); setIntent("create"); setCodeSent(false); setOtp(""); setMessage("Verifica tu correo para continuar; si ya tienes cuenta, entraremos a ella."); }}>Crear cuenta</button>
          <button type="button" className="secondary" onClick={() => { setLoginRecovery(false); setCodeSent(false); setOtp(""); setMessage(""); requestAnimationFrame(() => document.getElementById("access-email")?.focus()); }}>Cambiar correo</button>
          <button type="button" className="textButton" onClick={() => setLoginRecovery(false)}>Cancelar</button></div>
      </section></div>}
      <p className="hint">Invitado es un acceso independiente: no inicia sesión ni sincroniza tus datos con una cuenta.</p>
      <p className="legalLead">Consulta el <Link href="/legal/privacy-simplified?returnTo=access">Aviso de Privacidad Simplificado</Link>, el <Link href="/legal/privacy?returnTo=access">Aviso de Privacidad Integral</Link> y los <Link href="/legal/terms?returnTo=access">Términos y Condiciones</Link>. La aceptación explícita ocurre antes de crear el perfil.</p>
    </section>
  </main>;
}

function ConsentScreen({ onAccept, onBack }: { onAccept: (includeBettingConsent: boolean) => Promise<void>; onBack: () => Promise<void> }) {
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [rules, setRules] = useState(false);
  const [age, setAge] = useState(false);
  const [betting, setBetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <main className="consentScreen"><section className="consentCard">
    <BrandLockup compact />
    <div className="eyebrow">PRIMER ACCESO</div>
    <h1>Antes de la primera controversia</h1>
    <p>The Backyard incorpora un asistente de reglas basado en las Reglas de Golf, aclaraciones y reglas locales disponibles.</p>
    <p>Cuando un grupo acuerde utilizar el Árbitro de Reglas de The Backyard como criterio para resolver una situación durante una partida, sus jugadores aceptan aplicar la resolución mostrada salvo que exista una decisión oficial de un Comité, árbitro autorizado o autoridad competente de la competencia.</p>
    <div className="officialPriority">En una competencia oficial, el Comité o árbitro oficial tiene siempre la decisión final. La IA no es un árbitro oficial USGA.</div>
    <label className="consentCheck"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} /><span>Acepto los <Link href="/legal/terms?returnTo=onboarding">Términos de Uso</Link>.</span></label>
    <label className="consentCheck"><input type="checkbox" checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} /><span>He leído el <Link href="/legal/privacy-simplified?returnTo=onboarding">Aviso de Privacidad Simplificado</Link> y el <Link href="/legal/privacy?returnTo=onboarding">Aviso de Privacidad Integral</Link>.</span></label>
    <label className="consentCheck"><input type="checkbox" checked={rules} onChange={(event) => setRules(event.target.checked)} /><span>Entiendo el alcance del Árbitro de Reglas y acepto utilizar sus resoluciones como referencia acordada entre los participantes cuando corresponda.</span></label>
    <label className="consentCheck"><input type="checkbox" checked={age} onChange={(event) => setAge(event.target.checked)} /><span>Confirmo que tengo 18 años o más.</span></label>
    <label className="consentCheck expressConsentCheck"><input type="checkbox" checked={betting} onChange={(event) => setBetting(event.target.checked)} /><span>Consiento expresamente el tratamiento de los datos relativos a apuestas registradas, resultados y gastos, conforme al <Link href="/legal/privacy?returnTo=onboarding">Aviso de Privacidad</Link>. Esta autorización es específica y opcional para continuar a funciones que no registran esos datos.</span></label>
    {error && <p role="alert">{error}</p>}
    <button className="primary big" disabled={!terms || !privacy || !rules || !age || busy} onClick={async () => { setBusy(true); setError(""); try { await onAccept(betting); } catch { setError("No pudimos guardar tu aceptación en este dispositivo. Libera espacio y vuelve a intentar."); } finally { setBusy(false); } }}>{busy ? "Guardando…" : "Continuar"}</button>
    <button className="textButton consentBack" disabled={busy} onClick={onBack}>← Volver al acceso</button>
  </section></main>;
}

function ProfileSetupScreen({ identity, onSave, onBack }: {
  identity: BackyardIdentity;
  onSave: (profile: BackyardProfileUpdate) => Promise<"local" | "cloud">;
  onBack: () => Promise<void>;
}) {
  const [givenName, setGivenName] = useState(identity.givenName || "");
  const [familyName, setFamilyName] = useState(identity.familyName || "");
  const [location, setLocation] = useState(() => normalizeProfileLocation(identity.country || identity.countryCode ? identity : { countryCode: "MX" }));
  const [city, setCity] = useState(identity.city || "");
  const [handedness, setHandedness] = useState<"right" | "left">(identity.handedness === "left" ? "left" : "right");
  const [initialHighContrast, setInitialHighContrast] = useState(true);
  useEffect(() => { setInitialHighContrast(localStorage.getItem(STORAGE_KEYS.contrast) !== 'false'); }, []);
  const [avatarUrl, setAvatarUrl] = useState(identity.avatarUrl || "");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (avatarBusy) return;
    const displayName = [givenName.trim(), familyName.trim()].filter(Boolean).join(" ");
    const validation = validateProfileDraft(displayName, "");
    if (!validation.ok) { setMessage(validation.message); return; }
    const avatarValidation = validateProfileAvatarUrl(avatarUrl);
    if (!avatarValidation.ok) { setMessage(avatarValidation.message); return; }
    const locationValidation = validateProfileLocation(location);
    if (!locationValidation.valid) { setMessage(locationValidation.errors.country || locationValidation.errors.state || "Revisa tu país y región."); return; }
    setBusy(true); setMessage("");
    try { await onSave({
      displayName: validation.displayName,
      // This screen edits identity, not the selected index source. Retain any
      // saved golf value while the source selector lives in the next step.
      defaultHandicap: identity.defaultHandicap,
      avatarUrl: avatarValidation.avatarUrl,
      givenName: givenName.trim(),
      familyName: familyName.trim(),
      ...location,
      city: city.trim(),
      handedness,
      golfProfileUpdatedAt: new Date().toISOString(),
    }); }
    catch { setMessage("No pudimos completar el perfil. Revisa tu conexión e intenta nuevamente."); }
    finally { setBusy(false); }
  }
  return <main className={`consentScreen profileSetupScreen ${initialHighContrast ? 'highContrast' : ''}`}><section className="consentCard profileSetupCard">
    <BrandLockup compact />
    <div className="eyebrow">GOLF PROFILE</div>
    <h1>Cuéntanos de ti</h1>
    <p>Lo esencial para reconocerte en el grupo. La foto y la ciudad son opcionales.</p>
    <form className="profileSetupForm" onSubmit={saveProfile} noValidate>
      <div className="grid2"><label htmlFor="profile-setup-given">Nombre<input id="profile-setup-given" autoComplete="given-name" enterKeyHint="next" value={givenName} onChange={(event) => setGivenName(event.target.value)} placeholder="Tu nombre" /></label><label htmlFor="profile-setup-family">Apellidos<input id="profile-setup-family" autoComplete="family-name" enterKeyHint="next" value={familyName} onChange={(event) => setFamilyName(event.target.value)} placeholder="Tus apellidos" /></label></div>
      <label>Foto / avatar opcional</label>
      <ProfileImagePicker value={avatarUrl} onChange={setAvatarUrl} onBusyChange={setAvatarBusy} accessToken={identity.accessToken} userId={identity.userId} />
      <ProfileLocationPicker value={location} onChange={(next) => { setLocation(next); setMessage(""); }} />
      <label htmlFor="profile-setup-city">Ciudad opcional<input id="profile-setup-city" autoComplete="address-level2" value={city} onChange={(event) => setCity(event.target.value)} placeholder="Puebla" /></label>
      <fieldset className="handednessChoice"><legend>Mano dominante</legend><label><input type="radio" name="handedness" checked={handedness === "right"} onChange={() => setHandedness("right")} />Derecha</label><label><input type="radio" name="handedness" checked={handedness === "left"} onChange={() => setHandedness("left")} />Izquierda</label></fieldset>
      {message && <div className="accessMessage" role="alert">{message}</div>}
      <button type="submit" className="primary big" disabled={busy || avatarBusy}>{busy ? "Guardando…" : avatarBusy ? "Preparando imagen…" : "Guardar y continuar"}</button>
    </form>
    <button className="textButton" disabled={busy} onClick={onBack}>← Volver al acceso</button>
  </section></main>;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<BackyardIdentity | null>(null);
  const [acceptances, setAcceptances] = useState<LegalAcceptance[]>([]);
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
  const [equipmentOnboardingRequired, setEquipmentOnboardingRequired] = useState(false);
  const [betaOnboardingRequired, setBetaOnboardingRequired] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);
  const [accountEntry, setAccountEntry] = useState<AccountEntry | null>(null);
  const [accountEntryError, setAccountEntryError] = useState("");
  const [accountEntryRetry, setAccountEntryRetry] = useState(0);
  const [existingAccountNotice, setExistingAccountNotice] = useState(false);
  const [pendingDeletionSession, setPendingDeletionSession] = useState<Session | null>(null);
  const [pendingDeletionOwner, setPendingDeletionOwner] = useState("");
  const [pendingDeletionAccountActive, setPendingDeletionAccountActive] = useState(false);
  const [deletionRecoveryBusy, setDeletionRecoveryBusy] = useState(false);
  const [deletionRecoveryError, setDeletionRecoveryError] = useState("");
  const [pendingLocalDeletionOwner, setPendingLocalDeletionOwner] = useState("");
  const activeUserId = useRef<string | null>(null);
  const sessionRecovery = useRef<{ userId: string; promise: Promise<string> } | null>(null);
  const bettingConsentRequest = useRef<{ userId: string; promise: Promise<boolean>; resolve: (accepted: boolean) => void } | null>(null);
  const [cloudIssuesByDomain, setCloudIssuesByDomain] = useState<Partial<Record<CloudIssueDomain, CloudIssue>>>({});
  const [legalRetryRevision, setLegalRetryRevision] = useState(0);
  const [accountReloadRevision, setAccountReloadRevision] = useState(0);
  const cloudProfileFallbackRef = useRef<{ userId: string; profile: CloudProfileFields } | null>(null);
  const profileWriteCoordinators = useRef(new Map<string, ProfileWriteCoordinator>());
  const profileWriterFor = useCallback((userId: string) => {
    const existing = profileWriteCoordinators.current.get(userId);
    if (existing) return existing;
    const coordinator = createProfileWriteCoordinator();
    profileWriteCoordinators.current.set(userId, coordinator);
    return coordinator;
  }, []);

  const equipmentOnboardingReadyKey = useCallback((userId: string) => `the-backyard:equipment-onboarding-ready:v1:${encodeURIComponent(userId)}`, []);
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
  const flushLegalAcceptances = useCallback(async (userId: string, current: LegalAcceptance[]) => {
    const supabase = getSupabaseBrowser();
    if (!supabase) throw new Error("Supabase unavailable");
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
    await requireCloudWrites(writes);
    const confirmation = await supabase.from("legal_acceptances").select("type,version").eq("user_id", userId);
    if (confirmation.error) throw confirmation.error;
    const confirmed = new Set((confirmation.data || []).map((item) => `${item.type}:${item.version}`));
    if (current.some((item) => !confirmed.has(`${item.type}:${item.documentVersion}`))) throw new Error("legal_acceptance_not_confirmed");
    if (activeUserId.current !== userId) throw new Error("Session changed");
  }, []);
  useEffect(() => {
    if (identity?.mode === "authenticated") {
      cloudProfileFallbackRef.current = { userId: identity.userId, profile: cloudProfileFields(identity) };
      try { localStorage.setItem(`backyard-profile-cache-v1:${identity.userId}`, JSON.stringify(profileCachePayload(identity))); }
      catch { issueWithMessage("profile", "No se pudo guardar el perfil local. Libera espacio y reintenta."); }
    }
  }, [identity, issueWithMessage]);

  const activateSession = useCallback((session: Session, options: { rehydrate?: boolean } = {}) => {
    if (!isAccountSession(session)) throw new Error("account_session_missing");
    const deletionMarker = localStorage.getItem(accountDeletionMarkerKey(session.user.id));
    if (deletionMarker === "completed") {
      // A stale cached token from an older/interrupted client must be verified
      // before we keep claiming cleanup is complete.
      localStorage.setItem(accountDeletionMarkerKey(session.user.id), "completed_cleanup_pending");
      activeUserId.current = null;
      setIdentity(null);
      setPendingDeletionSession(session);
      setPendingDeletionAccountActive(false);
      setPendingLocalDeletionOwner(session.user.id);
      setDeletionRecoveryError("");
      setReady(true);
      return;
    }
    if (deletionMarker) {
      // Preserve the verified session only in memory so the user can retry an
      // interrupted deletion. No app data or sync surface is mounted.
      activeUserId.current = null;
      setIdentity(null);
      setPendingDeletionSession(session);
      setPendingDeletionAccountActive(false);
      setDeletionRecoveryError("");
      setReady(true);
      return;
    }
    setPendingDeletionSession(null);
    setPendingDeletionAccountActive(false);
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
    if (activeUserId.current) profileWriteCoordinators.current.delete(activeUserId.current);
    switchAccountWorkspace(localStorage, session.user.id);
    activeUserId.current = session.user.id;
    setAccountEntry(null);
    setAccountEntryError("");
    setExistingAccountNotice(false);
    setLastCloudSync(localStorage.getItem(`backyard-last-sync-v1:${session.user.id}`));
    setCloudIssuesByDomain({});
    const profile = profileFromUser(session.user);
    cloudProfileFallbackRef.current = { userId: profile.userId, profile: cloudProfileFields(profile) };
    setIdentity({ ...profile, mode: "authenticated", providers: session.user.app_metadata?.providers || [session.user.app_metadata?.provider].filter((value): value is string => Boolean(value)), accessToken: session.access_token });
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.mode, "authenticated");
    setCloudConsentChecked(false);
    setProfileChecked(false);
    const equipmentRead = loadEquipmentProfile(localStorage, session.user.id);
    setEquipmentOnboardingRequired(Boolean(equipmentRead.ok && equipmentRead.profile && localStorage.getItem(equipmentOnboardingReadyKey(session.user.id)) !== "true"));
    setBetaOnboardingRequired(betaOnboardingIsActive(readBetaOnboardingProgress(localStorage, session.user.id)));
    const migrationDecision = localStorage.getItem(migrationDecisionStorageKey(session.user.id));
    const localDataExists = hasLocalGolfData(localStorage);
    if (!localDataExists && !migrationDecision) localStorage.setItem(migrationDecisionStorageKey(session.user.id), "linked");
    setCloudLinked(migrationDecision === "linked" || !localDataExists);
    setCloudStatus(migrationDecision === "linked" || !localDataExists ? "pending" : "local");
    setShowMigration(localDataExists && !migrationDecision);
  }, [equipmentOnboardingReadyKey, setCloudIssue, setCloudStatus]);

  const activateOfflineWorkspace = useCallback(() => {
    const ownerId = localStorage.getItem(WORKSPACE_OWNER_KEY) || "";
    if (ownerId && localStorage.getItem(accountDeletionMarkerKey(ownerId))) return false;
    const profile = readOfflineAuthenticatedProfile(localStorage, ownerId);
    if (!profile || !ownsLocalWorkspace(localStorage, profile.userId)) return false;
    activeUserId.current = profile.userId;
    cloudProfileFallbackRef.current = { userId: profile.userId, profile: cloudProfileFields(profile) };
    const linked = localStorage.getItem(migrationDecisionStorageKey(profile.userId)) === "linked";
    setIdentity({ ...profile, mode: "authenticated", providers: [], accessToken: null });
    setCloudLinked(linked);
    setCloudStatus("offline");
    setLastCloudSync(localStorage.getItem(`backyard-last-sync-v1:${profile.userId}`));
    setCloudConsentChecked(true);
    setProfileChecked(true);
    setProfileSetupRequired(localStorage.getItem(`backyard-profile-ready-v1:${profile.userId}`) !== "true");
    const equipmentRead = loadEquipmentProfile(localStorage, profile.userId);
    setEquipmentOnboardingRequired(Boolean(equipmentRead.ok && equipmentRead.profile && localStorage.getItem(equipmentOnboardingReadyKey(profile.userId)) !== "true"));
    setBetaOnboardingRequired(betaOnboardingIsActive(readBetaOnboardingProgress(localStorage, profile.userId)));
    setReady(true);
    return true;
  }, [equipmentOnboardingReadyKey, setCloudStatus]);

  useEffect(() => {
    const localAcceptances = parseLegalAcceptances(localStorage.getItem(ACCOUNT_STORAGE_KEYS.acceptances));
    setAcceptances(localAcceptances);
    const supabase = getSupabaseBrowser();
    let mounted = true;
    let authEventRevision = 0;
    const restoreAfterLocalDeletionCleanup = async () => {
      const markers: Array<{ userId: string; state: string }> = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(ACCOUNT_DELETION_MARKER_PREFIX)) continue;
        const userId = key.slice(ACCOUNT_DELETION_MARKER_PREFIX.length);
        const state = userId ? localStorage.getItem(key) : null;
        if (userId && userId !== "guest" && state) markers.push({ userId, state });
      }
      for (const marker of markers) {
        const action = accountDeletionRecoveryAction(marker.state);
        if (marker.state !== "completed" && action !== "purge" && readAccountDeletionIntent(localStorage, marker.userId)?.recoveryToken) {
          setPendingDeletionOwner(current => current || marker.userId);
        }
        if (action === "wait") continue;
        if (action === "normalize_pending") {
          // A request timestamp (or an older ambiguous cleanup marker) does
          // not prove server deletion. Never purge on reload before a 2xx.
          localStorage.setItem(accountDeletionMarkerKey(marker.userId), "pending_confirmation");
          continue;
        }
        const locallyComplete = await purgeDeletedAccountLocal(marker.userId, { clearAuth: false, trackPending: false });
        // A server-confirmed deletion stays pending until Auth cache cleanup
        // is verified. Local files alone are insufficient to mark it complete.
        localStorage.setItem(accountDeletionMarkerKey(marker.userId), "completed_cleanup_pending");
        if (!locallyComplete) setPendingLocalDeletionOwner(marker.userId);
      }
      setPendingLocalDeletionOwner(nextPendingLocalDeletionOwner(localStorage));
      return supabase ? restoreAuthSession(supabase.auth) : null;
    };
    void restoreAfterLocalDeletionCleanup().then((session) => {
      if (!mounted || authEventRevision !== 0) return;
      if (session) activateSession(session);
      else if (!navigator.onLine && activateOfflineWorkspace()) return;
      else if (localStorage.getItem(ACCOUNT_STORAGE_KEYS.mode) === "guest") {
        const profile = guestProfile();
        setIdentity({ ...profile, mode: "guest", providers: [], accessToken: null });
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
              setIdentity({ ...guestProfile(), mode: "guest", providers: [], accessToken: null });
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
    // Cleanup reads current storage and uses only stable setters/refs; rerunning
    // this bootstrap effect after every render would race auth restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activateSession, activateOfflineWorkspace, setCloudIssue, setCloudStatus]);

  const authenticatedUserId = identity?.mode === "authenticated" ? identity.userId : "";
  const authenticatedAccessToken = identity?.mode === "authenticated" ? identity.accessToken : null;

  useEffect(() => {
    if (!authenticatedUserId || !authenticatedAccessToken || accountEntry?.userId === authenticatedUserId) return;
    const controller = new AbortController();
    void readCurrentAccountEntry(authenticatedAccessToken, authenticatedUserId, () => activeUserId.current, controller.signal).then((mapping) => {
      if (!mapping) return;
      setAccountEntry(mapping);
      setAccountEntryError("");
      const intent = consumeAccountEntryIntent(sessionStorage);
      if (mapping.existingAccount) {
        // Durable server mapping wins over old/incomplete local setup markers.
        // New consent versions still pass through AccountConsentCheckpoint.
        setProfileSetupRequired(false);
        if (mapping.onboardingProgress) persistBetaOnboardingProgress(localStorage, mapping.onboardingProgress);
        setBetaOnboardingRequired(mapping.onboardingProgress?.status === "in_progress");
        setEquipmentOnboardingRequired(false);
        setExistingAccountNotice(intent === "create");
      }
    }).catch(error => {
      if (!controller.signal.aborted && activeUserId.current === authenticatedUserId) setAccountEntryError(error instanceof Error ? error.message : "No pudimos verificar tu cuenta.");
    });
    return () => controller.abort();
  }, [authenticatedUserId, authenticatedAccessToken, accountEntry, accountEntryRetry]);

  useEffect(() => {
    if (!authenticatedUserId) return;
    const revisionKey = cloudProfileRevisionKey(authenticatedUserId);
    const reloadProfileFromAnotherTab = (event: StorageEvent) => {
      if (event.key === revisionKey && event.newValue) setAccountReloadRevision((value) => value + 1);
    };
    window.addEventListener("storage", reloadProfileFromAnotherTab);
    return () => window.removeEventListener("storage", reloadProfileFromAnotherTab);
  }, [authenticatedUserId]);

  useEffect(() => {
    if (!authenticatedUserId || !authenticatedAccessToken) return;
    if (accountEntry?.userId !== authenticatedUserId) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const fallback = cloudProfileFallbackRef.current;
    if (!fallback || fallback.userId !== authenticatedUserId) return;
    const profileWriteCoordinator = profileWriterFor(authenticatedUserId);
    let mounted = true;
    const pendingProfile = readPendingProfileWrite(localStorage, authenticatedUserId);
    const pendingProfileAttempt = pendingProfile
      ? profileWriteCoordinator.run(async () => {
          // Auth metadata emits USER_UPDATED while a profile save is in flight.
          // A queued reload must not replay a mutation already acknowledged.
          const currentPending = readPendingProfileWrite(localStorage, authenticatedUserId);
          if (!currentPending || currentPending.revision !== pendingProfile.revision) return;
          const saved = await saveCloudProfile(supabase, authenticatedUserId, currentPending.profile, currentPending.updatedAt);
          if (activeUserId.current !== authenticatedUserId) return;
          await syncExistingSocialProfileAvatar(supabase, authenticatedUserId, currentPending.profile.avatarUrl, currentPending.profile.username, currentPending.profile.displayName);
          if (activeUserId.current === authenticatedUserId) {
            recordCloudProfileRevision(localStorage, authenticatedUserId, saved.updatedAt);
            acknowledgePendingProfileWrite(localStorage, authenticatedUserId, pendingProfile.revision);
          }
        })
          .then(() => {
            return { status: "fulfilled" as const };
          })
          .catch((reason: unknown) => ({ status: "rejected" as const, reason }))
      : Promise.resolve({ status: "none" as const });
    const profileRead = pendingProfileAttempt.then(() => ensureCloudProfile(supabase, authenticatedUserId, fallback.profile)
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason: unknown) => ({ status: "rejected" as const, reason })));
    const preferencesRead = pendingProfileAttempt.then(() => supabase.from("user_preferences").select("default_handicap,high_contrast,updated_at").eq("user_id", authenticatedUserId).maybeSingle());
    const locationRead = pendingProfileAttempt.then(() => readProfileLocationMetadata(supabase, authenticatedUserId)
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason: unknown) => ({ status: "rejected" as const, reason })));
    Promise.all([
      supabase.from("legal_acceptances").select("user_id,type,version,accepted_at,locale").eq("user_id", authenticatedUserId),
      profileRead,
      preferencesRead,
      pendingProfileAttempt,
      locationRead,
    ]).then(([legalResult, profileResult, preferencesResult, pendingResult, locationResult]) => {
      if (!mounted || activeUserId.current !== authenticatedUserId) return;
      if (!preferencesResult.error && localStorage.getItem(STORAGE_KEYS.contrast) === null && typeof preferencesResult.data?.high_contrast === 'boolean') localStorage.setItem(STORAGE_KEYS.contrast, String(preferencesResult.data.high_contrast));
      if (!legalResult.error && Array.isArray(legalResult.data)) {
        const cloud = parseLegalAcceptances(JSON.stringify(legalResult.data.map((item) => ({ userId: item.user_id, type: item.type, documentVersion: item.version, acceptedAt: item.accepted_at, locale: item.locale, persistenceStatus: "persisted", syncStatus: "synced" }))));
        setAcceptances((current) => {
          const merged = mergeLegalAcceptances(current, cloud);
          localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(merged));
          return merged;
        });
      }
      const profileWriteStillPending = Boolean(readPendingProfileWrite(localStorage, authenticatedUserId));
      // A newer edit may already have completed and cleared its marker while
      // this older read was in flight. The fallback object is also a local
      // revision token, so that older response can never repaint the UI.
      const profileChangedWhileReading = cloudProfileFallbackRef.current !== fallback;
      const profileResponseAt = profileResult.status === "fulfilled" ? Date.parse(profileResult.value.updated_at || "") : Number.NaN;
      const preferencesResponseAt = Date.parse(typeof preferencesResult.data?.updated_at === "string" ? preferencesResult.data.updated_at : "");
      const completeResponseAt = Number.isFinite(profileResponseAt) && Number.isFinite(preferencesResponseAt)
        ? new Date(Math.min(profileResponseAt, preferencesResponseAt)).toISOString()
        : null;
      const newerTabRevisionExists = cloudProfileRevisionIsNewer(localStorage, authenticatedUserId, completeResponseAt);
      const keepLocalProfile = pendingResult.status === "rejected" || profileWriteStillPending || profileChangedWhileReading || newerTabRevisionExists;
      if (profileResult.status === "fulfilled") {
        const cloudProfile = profileResult.value;
        setIdentity((current) => {
          if (!current || current.mode !== "authenticated" || current.userId !== authenticatedUserId) return current;
          if (keepLocalProfile) return current;
          const displayName = typeof cloudProfile.display_name === "string" && cloudProfile.display_name.trim() ? cloudProfile.display_name : current.displayName;
          const avatarUrl = safeProfileAvatarValue(cloudProfile.avatar_url, current.avatarUrl);
          const username = canonicalProfileUsername(cloudProfile.username, current.username);
          // Existing preference clocks belong to the full sync merge. Updating
          // just HCP here would masquerade as a local edit on the next autosave.
          const cloudHandicap = preferencesResult.data ? preferencesResult.data.default_handicap : cloudProfile.default_handicap ?? null;
          const defaultHandicap = preferencesResult.error || localStorage.getItem(CLOUD_LOCAL_META_KEY) ? current.defaultHandicap : clampBackyardHandicap(cloudHandicap);
          const savedLocation = locationResult.status === "fulfilled" ? locationResult.value : null;
          const locationPatch = savedLocation && Date.parse(savedLocation.updatedAt) >= (Date.parse(current.locationUpdatedAt || "") || 0)
            ? { ...normalizeProfileLocation(savedLocation), locationUpdatedAt: savedLocation.updatedAt }
            : {};
          if (current.displayName === displayName && current.username === username && current.avatarUrl === avatarUrl && current.defaultHandicap === defaultHandicap && Object.entries(locationPatch).every(([key, value]) => current[key as keyof BackyardProfile] === value)) return current;
          return { ...current, displayName, username, avatarUrl, defaultHandicap, ...locationPatch };
        });
        if (!keepLocalProfile) {
          if (completeResponseAt) recordCloudProfileRevision(localStorage, authenticatedUserId, completeResponseAt);
          setProfileSetupRequired(!accountEntry.existingAccount && !cloudProfile.onboarding_completed_at);
          if (cloudProfile.onboarding_completed_at) localStorage.setItem(`backyard-profile-ready-v1:${authenticatedUserId}`, "true");
        }
      } else {
        issueWithMessage("profile", navigator.onLine
          ? cloudAccountErrorMessage(profileResult.reason, "tu perfil")
          : "Trabajando sin conexión · estamos usando el perfil guardado en este dispositivo.", navigator.onLine ? "server" : "offline");
        // A failed query is not proof that the profile is missing. Keep the
        // authenticated local profile usable; only a successful cloud row
        // without onboarding_completed_at may open profile setup.
        setProfileSetupRequired(false);
      }
      if (legalResult.error) setCloudIssue("legal", cloudIssueFromError("legal", legalResult.error, navigator.onLine));
      else setCloudIssue("legal", null);
      if (pendingResult.status === "rejected") setCloudIssue("profile", cloudIssueFromError("profile", pendingResult.reason, navigator.onLine));
      else if (preferencesResult.error) setCloudIssue("profile", cloudIssueFromError("profile", preferencesResult.error, navigator.onLine));
      else if (locationResult.status === "rejected") setCloudIssue("profile", cloudIssueFromError("profile", locationResult.reason, navigator.onLine));
      else if (profileResult.status === "fulfilled" && !keepLocalProfile) setCloudIssue("profile", null);
    }).catch((error) => {
      if (mounted && activeUserId.current === authenticatedUserId) setCloudIssue("profile", cloudIssueFromError("profile", error, navigator.onLine));
    }).finally(() => {
      if (mounted && activeUserId.current === authenticatedUserId) { setCloudConsentChecked(true); setProfileChecked(true); }
    });
    return () => { mounted = false; };
  }, [authenticatedUserId, authenticatedAccessToken, accountEntry, accountReloadRevision, issueWithMessage, profileWriterFor, setCloudIssue]);

  const currentConsent = identity ? hasCurrentLegalConsent(acceptances, identity.userId) : false;
  const bettingConsentGranted = identity ? hasCurrentBettingDataConsent(acceptances, identity.userId) : false;
  const bettingConsentResolved = Boolean(identity && (identity.mode === "guest" || cloudConsentChecked));

  const closeBettingConsent = useCallback((accepted: boolean) => {
    const pending = bettingConsentRequest.current;
    const pendingUserId = pending?.userId || identity?.userId || activeUserId.current;
    if (!accepted && pendingUserId) {
      try { localStorage.setItem(bettingConsentPromptStorageKey(pendingUserId), "seen"); }
      catch { /* This marker is not consent and must never prevent dismissal. */ }
    }
    bettingConsentRequest.current = null;
    setBettingConsentOpen(false);
    pending?.resolve(accepted);
  }, [identity?.userId]);

  const requestBettingConsent = useCallback(() => {
    if (!identity) return Promise.resolve(false);
    if (hasCurrentBettingDataConsent(acceptances, identity.userId)) return Promise.resolve(true);
    if (bettingConsentRequest.current?.userId === identity.userId) return bettingConsentRequest.current.promise;
    let resolveRequest!: (accepted: boolean) => void;
    const promise = new Promise<boolean>((resolve) => { resolveRequest = resolve; });
    bettingConsentRequest.current = { userId: identity.userId, promise, resolve: resolveRequest };
    if (identity.mode === "guest" || cloudConsentChecked) setBettingConsentOpen(true);
    return promise;
  }, [acceptances, identity, cloudConsentChecked]);

  useEffect(() => {
    const pending = bettingConsentRequest.current;
    if (!pending || !identity || pending.userId !== identity.userId || (identity.mode === "authenticated" && !cloudConsentChecked)) return;
    if (hasCurrentBettingDataConsent(acceptances, identity.userId)) closeBettingConsent(true);
    else setBettingConsentOpen(true);
  }, [acceptances, identity, cloudConsentChecked, closeBettingConsent]);

  useEffect(() => {
    const pending = bettingConsentRequest.current;
    if (pending && pending.userId !== identity?.userId) closeBettingConsent(false);
  }, [identity?.userId, closeBettingConsent]);

  useEffect(() => {
    if (!identity || !currentConsent || !bettingConsentResolved || bettingConsentGranted || showMigration) return;
    if (identity.mode === "authenticated" && (!profileChecked || profileSetupRequired || equipmentOnboardingRequired || betaOnboardingRequired)) return;
    if (localStorage.getItem(bettingConsentPromptStorageKey(identity.userId)) === "seen") return;
    setBettingConsentOpen(true);
  }, [identity, currentConsent, bettingConsentResolved, bettingConsentGranted, showMigration, profileChecked, profileSetupRequired, equipmentOnboardingRequired, betaOnboardingRequired]);

  useEffect(() => {
    if (identity?.mode !== "authenticated" || !identity.accessToken || !currentConsent) return;
    const saved = acceptances.filter((item) => item.userId === identity.userId);
    const pending = readPendingLegalSync(localStorage, identity.userId);
    const current = pending?.acceptances.length ? pending.acceptances : saved;
    queueLegalSync(localStorage, identity.userId, current);
    let mounted = true;
    void flushLegalAcceptances(identity.userId, current).then(() => {
      if (!mounted) return;
      clearPendingLegalSync(localStorage, identity.userId);
      setAcceptances((saved) => {
        const synced = markLegalAcceptancesSynced(saved, current);
        if (synced !== saved) localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(synced));
        return synced;
      });
      setCloudIssue("legal", null);
    }).catch((error) => {
      markLegalSyncFailed(localStorage, identity.userId, error);
      if (mounted) setCloudIssue("legal", {
        ...cloudIssueFromError("legal", error, navigator.onLine),
        message: legalSyncErrorMessage(error, navigator.onLine),
      });
    });
    return () => { mounted = false; };
  }, [identity?.mode, identity?.userId, identity?.accessToken, currentConsent, acceptances, legalRetryRevision, flushLegalAcceptances, issueWithMessage, setCloudIssue]);

  async function acceptConsent(includeBettingConsent: boolean, requireServerPersistence = false) {
    if (!identity) return;
    const next = buildLegalAcceptances(identity.userId, new Date().toISOString());
    // Authenticated onboarding cannot finish on a local-only acknowledgement.
    // Publish the legal state only after the existing server ledger confirms it.
    if (requireServerPersistence && identity.mode === "authenticated") {
      if (includeBettingConsent) next.push(buildBettingDataAcceptance(identity.userId, new Date().toISOString(), "pending"));
      await flushLegalAcceptances(identity.userId, next);
      if (activeUserId.current !== identity.userId) throw new Error("La sesión cambió antes de guardar las autorizaciones.");
      const synced = markLegalAcceptancesSynced(mergeLegalAcceptances(acceptances, next), next);
      localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(synced));
      if (!includeBettingConsent) localStorage.setItem(bettingConsentPromptStorageKey(identity.userId), "seen");
      clearPendingLegalSync(localStorage, identity.userId);
      setCloudIssue("legal", null);
      setAcceptances(synced);
      return;
    }
    let merged = mergeLegalAcceptances(acceptances, next);
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(merged));
    if (includeBettingConsent) {
      merged = persistBettingDataConsent(localStorage, identity.userId, identity.mode === "authenticated" ? "pending" : "local_only").acceptances;
    } else {
      localStorage.setItem(bettingConsentPromptStorageKey(identity.userId), "seen");
    }
    setAcceptances(merged);
    if (identity.mode === "authenticated") {
      const accountAcceptances = merged.filter((item) => item.userId === identity.userId);
      queueLegalSync(localStorage, identity.userId, accountAcceptances);
      try {
        await flushLegalAcceptances(identity.userId, accountAcceptances);
        clearPendingLegalSync(localStorage, identity.userId);
        const synced = markLegalAcceptancesSynced(merged, accountAcceptances);
        localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(synced));
        setAcceptances(synced);
        setCloudIssue("legal", null);
      } catch (error) {
        markLegalSyncFailed(localStorage, identity.userId, error);
        setCloudIssue("legal", {
          ...cloudIssueFromError("legal", error, navigator.onLine),
          message: legalSyncErrorMessage(error, navigator.onLine),
        });
      }
    }
  }

  async function acceptBettingConsent() {
    if (!identity) throw new Error("No se pudo identificar el contexto de esta aceptación.");
    const persisted = persistBettingDataConsent(
      localStorage,
      identity.userId,
      identity.mode === "authenticated" ? "pending" : "local_only",
    );
    setAcceptances(persisted.acceptances);
    localStorage.removeItem(bettingConsentPromptStorageKey(identity.userId));
    if (identity.mode === "authenticated") {
      const pending = queueLegalSync(localStorage, identity.userId, [persisted.acceptance]);
      try {
        await flushLegalAcceptances(identity.userId, pending.acceptances);
        clearPendingLegalSync(localStorage, identity.userId);
        const synced = markLegalAcceptancesSynced(persisted.acceptances, pending.acceptances);
        localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(synced));
        setAcceptances(synced);
        setCloudIssue("legal", null);
      } catch (error) {
        markLegalSyncFailed(localStorage, identity.userId, error);
        setCloudIssue("legal", {
          ...cloudIssueFromError("legal", error, navigator.onLine),
          message: legalSyncErrorMessage(error, navigator.onLine),
        });
      }
    }
    closeBettingConsent(true);
  }

  async function updateProfile(profile: BackyardProfileUpdate): Promise<"local" | "cloud"> {
    if (!identity) return "local";
    const includesLocation = ["countryCode", "country", "stateCode", "state"].some((key) => Object.hasOwn(profile, key));
    if (includesLocation && !validateProfileLocation({ ...identity, ...profile }).valid) throw new Error("Selecciona un país y una región válidos antes de guardar.");
    const next = mergeBackyardProfile(identity, profile);
    if (Object.hasOwn(profile, "username")) next.username = normalizeProfileUsername(profile.username) || identity.username;
    const locationChanged = includesLocation && (!identity.locationUpdatedAt || ["countryCode", "country", "stateCode", "state"].some((key) => next[key as keyof BackyardProfile] !== identity[key as keyof BackyardProfile]));
    const location = locationChanged ? normalizeProfileLocation(next) : undefined;
    if (identity.mode === "guest") {
      // Persist the merged profile, not a partial editor patch: changing an
      // optional avatar must not erase the previously selected country/region.
      localStorage.setItem(ACCOUNT_STORAGE_KEYS.guestProfile, JSON.stringify(profileCachePayload(next)));
      setIdentity(next);
      return "local";
    }
    const updatedAt = new Date().toISOString();
    const locationUpdatedAt = new Date(Math.max(Date.parse(updatedAt), (Date.parse(identity.locationUpdatedAt || "") || 0) + 1)).toISOString();
    // An avatar-only edit from an older session must not rename the canonical
    // handle. The queue still preserves an explicit rename already pending.
    const pending = queuePendingProfileWrite(localStorage, identity.userId, { ...cloudProfileFields(next), username: Object.hasOwn(profile, "username") ? next.username : undefined, ...(location ? { location, locationUpdatedAt } : {}) }, updatedAt);
    if (location) next.locationUpdatedAt = pending.profile.locationUpdatedAt || locationUpdatedAt;
    cloudProfileFallbackRef.current = { userId: identity.userId, profile: pending.profile };
    setIdentity(next);
    localStorage.setItem(`backyard-profile-cache-v1:${identity.userId}`, JSON.stringify(profileCachePayload(next)));
    setProfileSetupRequired(false);
    localStorage.setItem(`backyard-profile-ready-v1:${identity.userId}`, "true");
    const supabase = getSupabaseBrowser();
    if (!supabase || !identity.accessToken) {
      issueWithMessage("profile", "Perfil guardado en este dispositivo · sincronización pendiente.", navigator.onLine ? "server" : "offline");
      return "local";
    }
    try {
      const profileWriteCoordinator = profileWriterFor(identity.userId);
      const acknowledged = await profileWriteCoordinator.run(async () => {
        const saved = await saveCloudProfile(supabase, identity.userId, pending.profile, pending.updatedAt, { rebaseOnServerClock: true });
        if (activeUserId.current !== identity.userId) return false;
        // The profile row is canonical; project its public handle/avatar onto
        // the existing Social row, never privacy or a new synthetic identity.
        retimePendingProfileWrite(localStorage, identity.userId, pending.revision, saved.updatedAt);
        await syncExistingSocialProfileAvatar(supabase, identity.userId, pending.profile.avatarUrl, pending.profile.username, pending.profile.displayName);
        if (activeUserId.current !== identity.userId) return false;
        recordCloudProfileRevision(localStorage, identity.userId, saved.updatedAt);
        return acknowledgePendingProfileWrite(localStorage, identity.userId, pending.revision);
      });
      if (activeUserId.current !== identity.userId) return "local";
      if (!acknowledged) {
        issueWithMessage("profile", "Hay una edición de perfil más reciente pendiente de sincronizar.", "pending");
        return "local";
      }
      // Public handle is acknowledged by the canonical profile + Social writes
      // above. Auth metadata is legacy display fallback, not its source of truth.
      if (["givenName","familyName","handedness","homeClub","homeClubId","preferredTee"].some(key => Object.hasOwn(profile,key))) {
        const metadataWrite = await supabase.auth.updateUser({ data: {
          given_name: next.givenName || null,
          family_name: next.familyName || null,
          backyard_golf_profile_v1: { handedness: next.handedness || "", homeClub: next.homeClub || "", homeClubId: next.homeClubId || "", preferredTee: next.preferredTee || "" },
        } });
        if (metadataWrite.error) {
          issueWithMessage("profile", "Perfil guardado; el usuario se conservará en este dispositivo hasta la próxima sincronización.", "pending");
          return "local";
        }
      }
      setCloudIssue("profile", null);
      return "cloud";
    } catch (error) {
      const rebasedAt = error && typeof error === "object" && "profileUpdatedAt" in error && typeof error.profileUpdatedAt === "string"
        ? error.profileUpdatedAt
        : null;
      if (rebasedAt) retimePendingProfileWrite(localStorage, identity.userId, pending.revision, rebasedAt);
      setCloudIssue("profile", cloudIssueFromError("profile", error, navigator.onLine));
      return "local";
    }
  }

  async function saveInitialProfile(profile: BackyardProfileUpdate): Promise<"local" | "cloud"> {
    if (identity?.mode === "authenticated") {
      // Another device may have completed registration while this form was
      // open. Never use the stale creation form to overwrite that profile.
      const mapping = await readAccountEntry(identity.accessToken || "", identity.userId);
      if (activeUserId.current !== identity.userId) throw new Error("La sesión cambió.");
      if (mapping.existingAccount) {
        setAccountEntry(mapping);
        setProfileSetupRequired(false);
        if (mapping.onboardingProgress) persistBetaOnboardingProgress(localStorage, mapping.onboardingProgress);
        setBetaOnboardingRequired(mapping.onboardingProgress?.status === 'in_progress');
        setEquipmentOnboardingRequired(false);
        setExistingAccountNotice(true);
        setAccountReloadRevision(value => value + 1);
        return "cloud";
      }
      const existingEquipment = loadEquipmentProfile(localStorage, identity.userId);
      const emptyEquipment = existingEquipment.ok && existingEquipment.profile === null
        ? createEmptyEquipmentProfile(identity.userId)
        : null;
      if (emptyEquipment) {
        try {
          saveEquipmentProfile(localStorage, emptyEquipment);
          localStorage.removeItem(equipmentOnboardingReadyKey(identity.userId));
        } catch { /* Optional equipment persistence must not block the basic profile. */ }
      }
      // Re-opening the basic setup must never erase an existing (or unreadable)
      // equipment profile. Only a genuinely new optional profile enters this
      // onboarding flow.
      const existingProgress = readBetaOnboardingProgress(localStorage, identity.userId);
      const betaProgress = existingProgress || createBetaOnboardingProgress(identity.userId);
      await saveOnboardingCheckpoint(identity.accessToken || "", betaProgress);
      persistBetaOnboardingProgress(localStorage, betaProgress);
      setBetaOnboardingRequired(true);
      setEquipmentOnboardingRequired(false);
    }
    return updateProfile(profile);
  }

  function finishEquipmentOnboarding() {
    if (identity?.mode === "authenticated") {
      try { localStorage.setItem(equipmentOnboardingReadyKey(identity.userId), "true"); }
      catch { /* An optional local marker must never block entry into the app. */ }
    }
    setEquipmentOnboardingRequired(false);
  }

  function finishBetaOnboarding() {
    if (identity?.mode === "authenticated") {
      try { localStorage.setItem(equipmentOnboardingReadyKey(identity.userId), "true"); }
      catch { /* Completion remains stored in the versioned Beta progress. */ }
    }
    setEquipmentOnboardingRequired(false);
    setBetaOnboardingRequired(false);
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
      if (activeUserId.current) profileWriteCoordinators.current.delete(activeUserId.current);
      activeUserId.current = null;
      setIdentity(null);
      setEquipmentOnboardingRequired(false);
      setBetaOnboardingRequired(false);
      setAccessRequested(false);
      setCloudLinked(false);
      setCloudStatus("local");
      setLastCloudSync(null);
      setCloudIssuesByDomain({});
    }
  }

  async function purgeDeletedAccountLocal(deletedUserId: string, options: { clearAuth?: boolean; trackPending?: boolean } = {}) {
    const deletesActiveAccount = activeUserId.current === deletedUserId || ownsLocalWorkspace(localStorage, deletedUserId);
    const failedCleanupSteps: string[] = [];
    // If this is the active account, close every app/sync surface before the
    // first asynchronous cleanup step. A concurrent auth event may activate a
    // different account later; no stale flag is allowed to clear that account.
    if (deletesActiveAccount) {
      activeUserId.current = null;
      if (options.trackPending !== false) setPendingLocalDeletionOwner(deletedUserId);
      try { localStorage.removeItem(ACCOUNT_STORAGE_KEYS.mode); }
      catch { failedCleanupSteps.push("account_mode"); }
      setIdentity(null);
      setEquipmentOnboardingRequired(false);
      setBetaOnboardingRequired(false);
      setAccessRequested(false);
      setCloudLinked(false);
      setCloudStatus("local");
      setLastCloudSync(null);
      setCloudIssuesByDomain({});
      setShowMigration(false);
      if (options.clearAuth !== false) {
        const supabase = getSupabaseBrowser();
        try { if (supabase) await clearDeletedAuthSessionForUser(supabase.auth, deletedUserId); }
        catch { failedCleanupSteps.push("auth_cache"); }
      }
    }
    profileWriteCoordinators.current.delete(deletedUserId);
    let offlineRecords: Awaited<ReturnType<typeof readAllOfflineAccountRecords>> = [];
    let ownedPhotoIds: string[] = [];
    try { offlineRecords = await readAllOfflineAccountRecords(); }
    catch { failedCleanupSteps.push("offline_photo_reference_scan"); }
    try { ownedPhotoIds = await scorecardPhotoIdsForOwner(deletedUserId); }
    catch { failedCleanupSteps.push("photo_owner_index_scan"); }
    const scorecardPhotoIds = selectAccountScorecardPhotoIds(localStorage, deletedUserId, offlineRecords, ownedPhotoIds);
    try { await deleteScorecardPhotos(scorecardPhotoIds); }
    catch { failedCleanupSteps.push("scorecard_photos"); }
    try { await deleteOfflineAccountData(deletedUserId); }
    catch { failedCleanupSteps.push("offline_store"); }
    try {
      const uploadedMarkerPrefix = `backyard-photo-uploaded-v1:${deletedUserId}:`;
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(uploadedMarkerPrefix)) localStorage.removeItem(key);
      }
    } catch { failedCleanupSteps.push("upload_markers"); }
    try { discardAccountWorkspace(localStorage, deletedUserId); }
    catch { failedCleanupSteps.push("local_workspace"); }
    try { clearAccountDeletionIntent(localStorage, deletedUserId); }
    catch { failedCleanupSteps.push("deletion_intent"); }
    const storedAcceptances = parseLegalAcceptances(localStorage.getItem(ACCOUNT_STORAGE_KEYS.acceptances));
    const remainingAcceptances = clearLegalAcceptancesForUser(storedAcceptances, deletedUserId);
    try { localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(remainingAcceptances)); }
    catch { failedCleanupSteps.push("legal_acceptances"); }
    setAcceptances(remainingAcceptances);
    // Local cleanup remains retryable whether server deletion was confirmed or
    // its response was lost. The marker controls the next recovery step.
    if (failedCleanupSteps.length) {
      console.warn("Deleted account local cleanup was incomplete", { failedSteps: failedCleanupSteps });
    }
    // The caller advances this user's durable marker only after this promise
    // resolves. Do not reselect that same pending marker after successful
    // cleanup, or the closed account remains stuck on the retry screen.
    if (options.trackPending !== false) setPendingLocalDeletionOwner(failedCleanupSteps.length ? deletedUserId : nextPendingLocalDeletionOwner(localStorage, deletedUserId));
    return failedCleanupSteps.length === 0;
  }

  async function finishAccountDeletion() {
    if (!identity || identity.mode !== "authenticated") return false;
    return purgeDeletedAccountLocal(identity.userId);
  }

  async function retryPendingAccountDeletion() {
    const session = pendingDeletionSession;
    const userId = session?.user.id || pendingDeletionOwner;
    if (!userId || deletionRecoveryBusy) return;
    if (!navigator.onLine) {
      setDeletionRecoveryError("Conéctate a internet para comprobar y terminar la eliminación.");
      return;
    }
    const markerKey = accountDeletionMarkerKey(userId);
    setDeletionRecoveryBusy(true);
    setDeletionRecoveryError("");
    setPendingDeletionAccountActive(false);
    let serverDeletionConfirmed = localStorage.getItem(markerKey) === "completed_cleanup_pending"
      || localStorage.getItem(markerKey) === "completed";
    try {
      if (!serverDeletionConfirmed) {
        const intent = readAccountDeletionIntent(localStorage, userId);
        // A legacy timestamp/pending marker may follow a partially completed
        // older saga. Today's gated endpoint cannot prove THAT older attempt
        // changed no data. Never invent a policy or release the sync barrier
        // from Auth being live alone: this needs manual account recovery.
        if (!intent || (!session && !intent.recoveryToken)) throw new Error("No encontramos el comprobante original de esta solicitud. Conservamos tus datos y la pausa de sincronización; contacta soporte para verificar la cuenta.");
        const response = await fetch("/api/account/delete", {
          method: "DELETE",
          headers: { ...(session ? { authorization: `Bearer ${session.access_token}` } : {}), "content-type": "application/json" },
          body: JSON.stringify(accountDeletionRequestBody(intent)),
          signal: AbortSignal.timeout(25_000),
          redirect: "error",
        });
        const result = await response.json().catch(() => null) as { error?: string; code?: string; noDataDeleted?: boolean } | null;
        if (!response.ok) {
          // Auth being live alone does not rule out a partially failed saga.
          // Only an explicit pre-write server refusal can release the barrier.
          if (session && accountDeletionPrewriteRejected(response.status, result)) {
            const supabase = getSupabaseBrowser();
            if (supabase) {
              const verified = await supabase.auth.getUser(session.access_token).catch(() => null);
              if (verified && !verified.error && verified.data.user?.id === session.user.id) setPendingDeletionAccountActive(true);
            }
          }
          throw new Error(result?.error || "El servidor aún no confirmó la eliminación.");
        }
        if (!accountDeletionResponseConfirmed(result, intent.dataPolicy)) throw new Error("El servidor aún no confirmó el cierre de la cuenta.");
        serverDeletionConfirmed = true;
        localStorage.setItem(markerKey, "completed_cleanup_pending");
      }
      const locallyComplete = await purgeDeletedAccountLocal(userId, { clearAuth: false, trackPending: false });
      if (!locallyComplete) throw new Error("El servidor eliminó la cuenta, pero falta limpiar datos de este dispositivo. Reintenta.");
      const supabase = getSupabaseBrowser();
      if (supabase) await clearDeletedAuthSessionForUser(supabase.auth, userId);
      localStorage.setItem(markerKey, "completed");
      setPendingLocalDeletionOwner(nextPendingLocalDeletionOwner(localStorage));
      setPendingDeletionSession(null);
      setPendingDeletionOwner("");
    } catch (error) {
      // The barrier remains in place. A retry cannot mount the account or
      // resume writes until the server confirms the destructive request.
      localStorage.setItem(markerKey, serverDeletionConfirmed ? "completed_cleanup_pending" : "pending_confirmation");
      if (serverDeletionConfirmed) setPendingLocalDeletionOwner(userId);
      setDeletionRecoveryError(error instanceof Error ? error.message : "No pudimos confirmar la eliminación. Reintenta.");
    } finally {
      setDeletionRecoveryBusy(false);
    }
  }

  async function keepAccountAfterFailedDeletion() {
    const session = pendingDeletionSession;
    if (!session || !pendingDeletionAccountActive || deletionRecoveryBusy) return;
    if (!navigator.onLine) {
      setDeletionRecoveryError("Conéctate a internet para comprobar que tu cuenta sigue activa.");
      return;
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setDeletionRecoveryError("No pudimos comprobar el estado de tu cuenta. Reintenta más tarde.");
      return;
    }
    setDeletionRecoveryBusy(true);
    setDeletionRecoveryError("");
    try {
      const verified = await supabase.auth.getUser(session.access_token);
      if (verified.error || verified.data.user?.id !== session.user.id) throw new Error("La cuenta no se pudo verificar como activa. Conservamos tus datos y la pausa de sincronización.");
      clearAccountDeletionIntent(localStorage, session.user.id);
      localStorage.removeItem(accountDeletionMarkerKey(session.user.id));
      setPendingDeletionOwner("");
      activateSession(session);
      setPendingDeletionAccountActive(false);
    } catch (error) {
      setDeletionRecoveryError(error instanceof Error ? error.message : "No pudimos comprobar el estado de tu cuenta.");
    } finally {
      setDeletionRecoveryBusy(false);
    }
  }

  async function closePendingDeletionSession() {
    const session = pendingDeletionSession;
    if (!session) { setPendingDeletionOwner(""); setDeletionRecoveryError(""); return; }
    const supabase = getSupabaseBrowser();
    try { if (supabase) await clearDeletedAuthSessionForUser(supabase.auth, session.user.id); }
    catch {
      setDeletionRecoveryError("No pudimos cerrar de forma segura la sesión eliminada. Reintenta.");
      return;
    }
    setPendingDeletionSession(null);
    setPendingDeletionOwner("");
    setDeletionRecoveryError("");
  }

  async function retryPendingLocalDeletionCleanup() {
    const userId = pendingLocalDeletionOwner;
    if (!userId || deletionRecoveryBusy) return;
    const markerKey = accountDeletionMarkerKey(userId);
    const markerState = localStorage.getItem(markerKey) || "cleanup_pending";
    const serverConfirmed = markerState === "completed_cleanup_pending" || markerState === "completed";
    setDeletionRecoveryBusy(true);
    setDeletionRecoveryError("");
    try {
      const locallyComplete = await purgeDeletedAccountLocal(userId, { clearAuth: false, trackPending: false });
      if (!locallyComplete) {
        localStorage.setItem(markerKey, serverConfirmed ? "completed_cleanup_pending" : "cleanup_pending");
        setPendingLocalDeletionOwner(userId);
        setDeletionRecoveryError("Todavía no pudimos limpiar todos los datos locales. Libera espacio o cierra otras pestañas y reintenta.");
        return;
      }
      if (serverConfirmed) {
        const supabase = getSupabaseBrowser();
        if (supabase) await clearDeletedAuthSessionForUser(supabase.auth, userId);
        if (pendingDeletionSession?.user.id === userId) setPendingDeletionSession(null);
        if (pendingDeletionOwner === userId) setPendingDeletionOwner("");
      }
      localStorage.setItem(markerKey, serverConfirmed ? "completed" : "pending_confirmation");
      setPendingLocalDeletionOwner(nextPendingLocalDeletionOwner(localStorage));
    } catch (error) {
      localStorage.setItem(markerKey, serverConfirmed ? "completed_cleanup_pending" : "cleanup_pending");
      setPendingLocalDeletionOwner(userId);
      setDeletionRecoveryError(error instanceof Error ? error.message : "Todavía no pudimos completar la limpieza local. Reintenta.");
    } finally {
      setDeletionRecoveryBusy(false);
    }
  }

  async function keepLocalDataForAccount() {
    if (!identity || identity.mode !== "authenticated" || !identity.accessToken) return;
    setMigrationBusy(true); setMigrationError(""); setCloudStatus("pending");
    // Generic onboarding consent may follow a deliberate workspace import;
    // express betting consent never changes identity or context implicitly.
    const guestConsent = acceptances.filter((item) => item.userId === "guest" && item.type !== BETTING_DATA_CONSENT_TYPE);
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
    try {
      const importedPhotoIds = activeWorkspaceScorecardPhotoIds(localStorage, identity.userId);
      await adoptScorecardPhotos(importedPhotoIds, "guest", identity.userId);
      if (activeUserId.current !== identity.userId || !ownsLocalWorkspace(localStorage, identity.userId)) return;
      adoptGuestPhotoJobs(localStorage, identity.userId);
    } catch {
      setMigrationError("No pudimos vincular las fotos locales. Tus datos siguen intactos; reintenta.");
      setMigrationBusy(false);
      setCloudStatus("error");
      return;
    }
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
  const context = identity ? ({ identity, updateProfile, logout, finishAccountDeletion, openAccess: () => setAccessRequested(true), acceptances, bettingConsentGranted, bettingConsentResolved, requestBettingConsent, cloudLinked, cloudStatus: effectiveCloudStatus, setCloudStatus, lastCloudSync, cloudIssues, applyCloudPreferences,
    reportCloudSyncError,
    clearCloudSyncError,
    retryCloudSync: retryAllCloud,
    refreshCloudSession,
    requestCloudLink: () => { setMigrationError(""); setShowMigration(true); } }) : null;
  const migrationDialog = showMigration && <div className="modalBackdrop"><section className="confirmDialog migrationDialog" role="dialog" aria-modal="true" aria-labelledby="migration-title">
    <ModalCloseButton onClose={() => setShowMigration(false)} disabled={migrationBusy} />
    <h2 id="migration-title">Encontramos datos de The Backyard en este dispositivo.</h2>
    <p>Nada se borrará de este dispositivo. La importación usa los mismos identificadores para poder reintentarse sin duplicar rondas.</p>
    {migrationError && <div className="notice bad" role="alert">{migrationError}</div>}
    <div className="migrationActions"><button className="primary" disabled={migrationBusy} onClick={keepLocalDataForAccount}>{migrationBusy ? "Vinculando…" : "Vincular a mi cuenta"}</button><button className="secondary" disabled={migrationBusy} onClick={() => { if (identity) localStorage.setItem(migrationDecisionStorageKey(identity.userId), "skip"); setCloudLinked(false); setCloudStatus("local"); setShowMigration(false); }}>Ahora no</button></div>
  </section></div>;
  const bettingConsentDialog = bettingConsentOpen
    ? <BettingConsentDialog onDismiss={() => closeBettingConsent(false)} onAccept={acceptBettingConsent} />
    : null;

  if (!ready) return <main className="accessScreen"><div className="accessLoading">Cargando The Backyard…</div></main>;
  if (pendingLocalDeletionOwner) return <main className="accessScreen"><section className="accessCard" aria-labelledby="local-deletion-recovery-title">
    <BrandLockup />
    <div className="eyebrow">LIMPIEZA LOCAL PENDIENTE</div>
    <h1 id="local-deletion-recovery-title">Termina de borrar los datos de este dispositivo</h1>
    <p>The Backyard no abrirá rondas ni sincronización de esa cuenta hasta verificar la limpieza local.</p>
    {deletionRecoveryError && <div className="accessMessage" role="alert">{deletionRecoveryError}</div>}
    <button type="button" className="primary big" disabled={deletionRecoveryBusy} onClick={() => void retryPendingLocalDeletionCleanup()}>{deletionRecoveryBusy ? "Limpiando…" : "Reintentar limpieza"}</button>
  </section></main>;
  if (pendingDeletionSession || pendingDeletionOwner) return <main className="accessScreen"><section className="accessCard" aria-labelledby="deletion-recovery-title">
    <BrandLockup />
    <div className="eyebrow">CIERRE DE CUENTA PENDIENTE</div>
    <h1 id="deletion-recovery-title">Termina el cierre de tu cuenta</h1>
    <p>No abriremos tus rondas ni reanudaremos la sincronización hasta que el servidor confirme la solicitud anterior.</p>
    {deletionRecoveryError && <div className="accessMessage" role="alert">{deletionRecoveryError}</div>}
    <div className="accessActions">
      <button type="button" className="primary big" disabled={deletionRecoveryBusy} onClick={() => void retryPendingAccountDeletion()}>{deletionRecoveryBusy ? "Comprobando…" : "Continuar cierre de cuenta"}</button>
      {pendingDeletionAccountActive && <button type="button" className="secondary" disabled={deletionRecoveryBusy} onClick={() => void keepAccountAfterFailedDeletion()}>Conservar mi cuenta</button>}
      <button type="button" className="secondary" disabled={deletionRecoveryBusy} onClick={() => void closePendingDeletionSession()}>Cerrar sesión</button>
    </div>
    <p><a href={`mailto:${legalConfig.supportEmail}?subject=Recuperaci%C3%B3n%20de%20cuenta%20pendiente`}>Contactar soporte</a></p>
  </section></main>;
  if (!identity || accessRequested) return <AccessScreen onGuest={async () => {
    if (activeUserId.current) {
      const supabase = getSupabaseBrowser();
      if (!supabase) throw new Error("Session unavailable");
      await closeAuthSession(supabase.auth);
    }
    switchAccountWorkspace(localStorage, "guest");
    activeUserId.current = null;
    const withoutPreviousGuestConsent = clearLegalAcceptancesForUser(acceptances, "guest");
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(withoutPreviousGuestConsent));
    setAcceptances(withoutPreviousGuestConsent);
    const profile = guestProfile();
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.mode, "guest");
    setIdentity({ ...profile, mode: "guest", providers: [], accessToken: null });
    setEquipmentOnboardingRequired(false);
    setBetaOnboardingRequired(false);
    setCloudConsentChecked(true);
    setAccessRequested(false);
    setCloudIssuesByDomain({}); setCloudStatus("local"); setCloudLinked(false); setLastCloudSync(null); setShowMigration(false);
  }} sessionError={accountCloudError} onAuthenticated={(session) => { activateSession(session); setAccessRequested(false); }} />;
  if (identity.mode === "authenticated" && identity.accessToken && accountEntry?.userId !== identity.userId) return <main className="accessScreen"><section className="accessCard">
    <BrandLockup compact /><h1>Verificando tu cuenta…</h1>
    {accountEntryError && <><p role="alert">{accountEntryError}</p><button className="primary big" onClick={() => { setAccountEntryError(""); setAccountEntryRetry(value => value + 1); }}>Reintentar</button><button className="textButton" onClick={logout}>Volver al acceso</button></>}
  </section></main>;
  if (identity.mode === "authenticated" && !currentConsent && !cloudConsentChecked) return <main className="accessScreen"><div className="accessLoading">Verificando tus consentimientos…</div></main>;
  if (identity.mode === "guest" && !currentConsent) {
    if (migrationDialog && hasCurrentLegalConsent(acceptances, "guest")) return <main className="accessScreen">{migrationDialog}</main>;
    return <>{accountCloudError && <div role="alert" className="notice bad">{accountCloudError}</div>}<ConsentScreen onAccept={acceptConsent} onBack={logout} /></>;
  }
  if (identity.mode === "authenticated" && !profileChecked) return <main className="accessScreen"><div className="accessLoading">Preparando tu perfil…</div></main>;
  if (identity.mode === "authenticated" && profileSetupRequired) return <>{accountCloudError && <div role="alert" className="notice bad">{accountCloudError}</div>}<ProfileSetupScreen identity={identity} onSave={saveInitialProfile} onBack={logout} /></>;
  if (identity.mode === "authenticated" && betaOnboardingRequired) return <AccountContext.Provider value={context!}>
    <BetaOnboardingFlow profile={identity} accessToken={identity.accessToken} onUpdateProfile={updateProfile} bettingConsentGranted={bettingConsentGranted} requestBettingConsent={requestBettingConsent} onComplete={finishBetaOnboarding} />
    {bettingConsentDialog}
  </AccountContext.Provider>;
  if (identity.mode === "authenticated" && equipmentOnboardingRequired) return <EquipmentOnboarding userId={identity.userId} accessToken={identity.accessToken} defaultHandicap={null} ballFitDefaults={ballFitDefaultsFromProfile(identity)} onComplete={finishEquipmentOnboarding} onBack={finishEquipmentOnboarding} onSaveAndExit={finishEquipmentOnboarding} />;

  const app = <AccountContext.Provider value={context!}>
    {existingAccountNotice && <div className="notice" role="status">Ya tienes una cuenta. Vamos a iniciar sesión.<button type="button" className="textButton" aria-label="Cerrar aviso de cuenta existente" onClick={() => setExistingAccountNotice(false)}>Entendido</button></div>}
    {blockingCloudIssues.map((issue) => <div className="notice bad" role="alert" key={issue.domain}>{issue.message}<button onClick={() => setAccessRequested(true)}>Volver a iniciar sesión</button></div>)}
    <Fragment key={identity.userId}>{children}</Fragment>
    {migrationDialog}
    {bettingConsentDialog}
  </AccountContext.Provider>;
  // Account creation ends here, after profile/personalization and before entry
  // into the app. Existing accounts resolve only missing server-side choices.
  // Technical AI-preference failures may defer the prompt, not authorize AI.
  // No localStorage marker is treated as consent on this or a new device.
  return identity.mode === "authenticated" ? <AccountConsentCheckpoint
    key={identity.userId}
    userId={identity.userId}
    accessToken={identity.accessToken}
    legalRequired={!currentConsent}
    onAcceptLegal={(betting) => acceptConsent(betting, true)}
    onBack={logout}
  >{app}</AccountConsentCheckpoint> : app;
}
