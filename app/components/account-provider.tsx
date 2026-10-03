"use client";
import { saveOnboardingCheckpoint } from '../../lib/onboarding-checkpoint';
import { readStoredJson, STORAGE_KEYS } from '../../lib/round-utils';
import { cloudAccountErrorMessage, ensureCloudProfile, saveCloudProfile } from "../../lib/cloud-account";
import { canonicalProfileUsername, normalizeProfileUsername } from "../../lib/profile-username";
import { waitForProfilePrimarySave, type ProfileSaveResult } from "../../lib/profile-save-flow";

import Link from "next/link";
import Image from "next/image";
import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent } from "react";
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
import { AuthSessionRecoveryError, EmailOtpRequestError, authCallbackUrl, authIdentityChanged, clearDeletedAuthSessionForUser, closeAuthSession, isAccountSession, recoverAuthSession, requestEmailOtp, requireCloudWrites, restoreAuthSession, startSocialOAuth, verifyEmailOtp, OtpSendGate, otpRetrySeconds, OTP_COOLDOWN_KEY } from "../../lib/auth-flow";
import { activeWorkspaceScorecardPhotoIds, discardAccountSessionState, discardAccountWorkspace, ownsLocalWorkspace, selectAccountScorecardPhotoIds, switchAccountWorkspace, WORKSPACE_OWNER_KEY } from "../../lib/account-workspace";
import { CLOUD_LOCAL_META_KEY, type CloudPreferences } from "../../lib/cloud-sync";
import { deleteOfflineAccountData, readAllOfflineAccountRecords } from "../../lib/offline-store";
import { adoptScorecardPhotos, deleteScorecardPhotos, scorecardPhotoIdsForOwner } from "../../lib/scorecard-photo";
import { adoptGuestPhotoJobs } from "../../lib/photo-sync-queue";
import { clearPendingLegalSync, legalSyncErrorMessage, markLegalSyncFailed, prepareLegalSyncBatch, queueLegalSync } from "../../lib/legal-sync-queue";
import type { AuthProviderStatus } from "../../lib/auth-provider-status";
import { cloudIssueFromError, cloudIssuePriority, type CloudIssue, type CloudIssueDomain } from "../../lib/cloud-issues";
import { BrandLockup } from "./brand-lockup";
import { ProfileImagePicker } from "./profile-image-picker";
import { ProfileLocationPicker } from "./profile-location-picker";
import { normalizeProfileLocation, validateProfileLocation } from "../../lib/profile-geography";
import { parseStoredProfileLocation, readProfileLocationMetadata, PROFILE_LOCATION_METADATA_KEY } from "../../lib/profile-location-sync";
import { syncExistingSocialProfileAvatar } from "../../lib/profile-avatar-sync";
import { consumeAccountEntryIntent, readCurrentAccountEntry, rememberAccountEntryIntent, type AccountEntry } from "../../lib/account-entry";
import { BettingConsentDialog } from "./betting-consent-dialog";
import { FeedbackDialog } from "./feedback-dialog";
import { persistBettingDataConsent } from "../../lib/betting-consent";
import { acknowledgePendingProfileWrite, cloudProfileFields, cloudProfileRevisionIsNewer, cloudProfileRevisionKey, createProfileWriteCoordinator, queuePendingProfileWrite, readPendingProfileWrite, recordCloudProfileRevision, restorePendingProfileWrite, retimePendingProfileWrite, type CloudProfileFields, type ProfileWriteCoordinator } from "../../lib/profile-sync";
import { createEmptyEquipmentProfile, loadEquipmentProfile, saveEquipmentProfile } from "../../lib/golf-equipment";
import { ballFitDefaultsFromProfile } from "../../lib/ball-fitting";
import { EquipmentOnboarding } from "./equipment-onboarding";
import { useBackyardIndexPreference } from "./use-backyard-index-preference";
import { useGhinReadOnlyProfile } from "./use-ghin-read-only-profile";
import { selectedHandicapIndex } from "../../lib/handicap-source";
import type { RoundSnapshot } from "../../lib/types";
import { BetaOnboardingFlow } from "./beta-onboarding-flow";
import { betaOnboardingIsActive, createBetaOnboardingProgress, persistBetaOnboardingProgress, readBetaOnboardingProgress } from "../../lib/beta-onboarding";
import { missingInitialProfileFields, oauthIdentityFromMetadata, ownerProfileClaimsFromAuth } from "../../lib/oauth-profile";
import { NO_ADMIN_ACCESS, readAdminAccess, type AdminAccess } from "../../lib/admin-access";
import { resolveBrowserAppOrigin } from "../../lib/app-origin";
import { type LegalEvidenceAction, type LegalEvidenceSubject } from "../../lib/legal-evidence";
import {
  legalActorForIdentity,
  legalClientEnvironment,
  legalEvidenceStateKey,
  legalEvidenceSyncMessage,
  hasResolvedFinancialChoice,
  hasResolvedFinancialConsent,
  readLegalEvidence,
  recordLocalLegalEvidenceBatch,
  synchronizeLegalEvidence,
  type LegalEvidenceEvent,
  type LegalEvidenceOrigin,
  type LegalEnvironment,
} from "../../lib/legal-evidence-client";
import {
  OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT,
  requestOptionalAuthorizationState,
} from "../../lib/account-optional-authorizations";
import { ACCOUNT_LEARNING_CONSENT_HYDRATED_EVENT, cacheAccountLearningConsent, failClosedAccountLearningConsent } from "../../lib/account-learning-consent-cache";
import { failClosedAccountDevicePermissionPreferences, hydrateOptionalDevicePermissionPreferences } from "../../lib/account-device-permission-preferences";
import { InitialOnboardingConsents } from "./account-consent-checkpoint";
import { OnboardingPrivacyChoices } from "./onboarding-privacy-choices";
import { requestAccountActivation, type AccountActivation } from "../../lib/account-activation";

export type BackyardIdentity = BackyardProfile & {
  mode: Exclude<AccountMode, "undecided">;
  providers: string[];
  accessToken: string | null;
};
type AccountActivationSnapshot = { userId: string; state: AccountActivation };

type AccountContextValue = {
  identity: BackyardIdentity;
  adminAccess: AdminAccess;
  updateProfile: (profile: BackyardProfileUpdate) => Promise<ProfileSaveResult>;
  logout: () => Promise<void>;
  finishAccountDeletion: () => Promise<boolean>;
  deactivateAccount: () => Promise<void>;
  deactivationAvailable: boolean;
  openAccess: () => void;
  acceptances: LegalAcceptance[];
  legalEvidenceEvents: LegalEvidenceEvent[];
  legalEvidenceResolved: boolean;
  marketingConsentResolved: boolean;
  bettingConsentGranted: boolean;
  bettingConsentResolved: boolean;
  requestBettingConsent: () => Promise<boolean>;
  recordLegalChoice: (subject: LegalEvidenceSubject, action: LegalEvidenceAction, origin?: LegalEvidenceOrigin) => Promise<void>;
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

type LocalLegalEvidenceState = {
  actorKey: string;
  environment: LegalEnvironment;
  events: LegalEvidenceEvent[];
  resolved: boolean;
  resolvedSubjects: LegalEvidenceSubject[];
};

function profileCachePayload(profile: BackyardProfile) {
  const {
    userId, displayName, email, avatarUrl, defaultHandicap, givenName, familyName,
    username, city, state, stateCode, country, countryCode, locationUpdatedAt, homeClub, homeClubId, homeCourse, homeCourseId, preferredTee, handedness,
    typicalScore, driverDistanceYards, driverSwingSpeedBand, usualTrajectory,
    shotTendency, greenSpeed, gamePriority, priceImportance, golfProfileUpdatedAt,
    improvementGoals, primaryGoals, primaryGoal, targetHandicap, planId, ghinLinkStatus,
    bio, profileVisibility,
  } = profile;
  return {
    userId, displayName, email, avatarUrl, defaultHandicap, givenName, familyName,
    username, city, state, stateCode, country, countryCode, locationUpdatedAt, homeClub, homeClubId, homeCourse, homeCourseId, preferredTee, handedness,
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
  const oauthIdentity = oauthIdentityFromMetadata(user.user_metadata, user.email);
  const ownerClaims = ownerProfileClaimsFromAuth(user.user_metadata);
  const email = oauthIdentity.email;
  const location = parseStoredProfileLocation(user.user_metadata?.[PROFILE_LOCATION_METADATA_KEY]);
  const base = {
    userId: user.id,
    displayName: oauthIdentity.displayName,
    email,
    avatarUrl: oauthIdentity.avatarUrl,
    defaultHandicap: typeof user.user_metadata?.default_handicap === "number" ? clampBackyardHandicap(user.user_metadata.default_handicap) : null,
    ...emptyBackyardProfileDetails(),
    givenName: oauthIdentity.givenName,
    familyName: oauthIdentity.familyName,
    ...ownerClaims,
    ...(location ? { ...normalizeProfileLocation(location), locationUpdatedAt: location.updatedAt } : {}),
    username: String(user.user_metadata?.username || usernameFromEmail(email)),
  };
  try {
    const cached = JSON.parse(localStorage.getItem(`backyard-profile-cache-v1:${user.id}`) || "null");
    const restored = normalizeBackyardProfileCache(cached, base);
    const canonical = { ...restored, ...ownerClaims };
    if (location && !readPendingProfileWrite(localStorage, user.id)?.profile.location && Date.parse(location.updatedAt) > (Date.parse(restored.locationUpdatedAt || "") || 0)) {
      return { ...canonical, ...normalizeProfileLocation(location), locationUpdatedAt: location.updatedAt };
    }
    return canonical;
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

function AccessScreen({ onAuthenticated, sessionError }: { onAuthenticated: (session: Session) => void; sessionError: string }) {
  const [stage, setStage] = useState<"splash" | "methods">("splash");
  const [intent, setIntent] = useState<"create" | "login">("create");
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [loginRecovery, setLoginRecovery] = useState<"missing" | "existing" | null>(null);
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

  async function social(provider: "google", selectGoogleAccount = false) {
    if (oauthStarting.current) return;
    if (!providers || providers.status === "unavailable") {
      setMessage("No pudimos comprobar el proveedor de acceso. Revisa tu conexión y vuelve a intentar.");
      return;
    }
    if (!socialEnabled || !providers[provider]) {
      setMessage("Acceso con Google pendiente de configuración.");
      return;
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setMessage("Acceso con Google pendiente de configuración.");
      return;
    }
    oauthStarting.current = true;
    setAuthSessionPersistence(rememberSession);
    rememberAccountEntryIntent(sessionStorage, intent);
    setBusy(true); setMessage("");
    try {
      const appOrigin = resolveBrowserAppOrigin(window.location.origin, process.env.NEXT_PUBLIC_APP_ORIGIN);
      await startSocialOAuth(supabase.auth, provider, authCallbackUrl(appOrigin), { selectGoogleAccount });
    } catch (error) {
      oauthStarting.current = false;
      setMessage(authErrorMessage(error, provider));
      setBusy(false);
    }
  }

  async function sendCode(requestedIntent: "create" | "login" = intent) {
    if (!isValidEmail(email)) { setMessage("Escribe un correo electrónico válido."); return; }
    if (providers?.status !== "ready" || providers.email !== true) { setMessage("Acceso con correo pendiente de configuración."); return; }
    setAuthSessionPersistence(rememberSession);
    if (!sendGate.current.begin()) return;
    setBusy(true); setMessage("");
    try {
      rememberAccountEntryIntent(sessionStorage, requestedIntent);
      await requestEmailOtp(email, requestedIntent);
      sendGate.current.commit();
      try { sessionStorage.setItem(OTP_COOLDOWN_KEY, String(sendGate.current.nextSendAt)); }
      catch { /* Never prevent OTP capture because optional cooldown persistence failed. */ }
      setRetrySeconds(otpRetrySeconds(sendGate.current.nextSendAt));
      setCodeSent(true);
      setMessage("Código enviado. Revisa tu correo.");
    } catch (error) {
      sendGate.current.release();
      if (error instanceof EmailOtpRequestError && error.status === 429) {
        sendGate.current.nextSendAt = Date.now() + error.retryAfterSeconds * 1_000;
        try { sessionStorage.setItem(OTP_COOLDOWN_KEY, String(sendGate.current.nextSendAt)); }
        catch { /* Cooldown remains enforced in memory if storage is unavailable. */ }
        setRetrySeconds(otpRetrySeconds(sendGate.current.nextSendAt));
      }
      if (error instanceof EmailOtpRequestError && error.code === "ACCOUNT_NOT_FOUND" && requestedIntent === "login") {
        setMessage("No encontramos una cuenta con este correo.");
        setLoginRecovery("missing");
      } else if (error instanceof EmailOtpRequestError && error.code === "ACCOUNT_ALREADY_EXISTS" && requestedIntent === "create") {
        setMessage("Ya existe una cuenta con este correo. Inicia sesión para continuar.");
        setLoginRecovery("existing");
      } else {
        setMessage(error instanceof EmailOtpRequestError ? error.message : authErrorMessage(error, "email"));
      }
    } finally { setBusy(false); }
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
  return <main className="accessScreen">
    <section className={`accessCard ${stage === "splash" ? "splashCard" : ""}`}>
      {stage === "splash" && <div className="accessEditorial"><Image src="/brand/home-swing.jpg" alt="" fill sizes="(max-width: 600px) 100vw, 460px" priority /><span>GOOD GOLF.<br /><em>BETTER FRIENDS.</em></span></div>}
      <BrandLockup />
      <p className="accessTagline">Golf · Friends · More</p>
      <p className="accessPromise">Tu juego, tu grupo habitual y todo lo que pasa después del último putt.</p>
      {stage === "splash" ? <div className="accessActions splashActions">
        <button className="primary big" onClick={() => { setIntent("create"); setStage("methods"); }}>Crear cuenta</button>
        <button className="secondary big" onClick={() => { setIntent("login"); setStage("methods"); }}>Iniciar sesión</button>
      </div> : <>
      <div className="accessIntent"><button className="textButton" onClick={() => { setStage("splash"); setEmailMode(false); setMessage(""); }}>← Inicio</button><span>{intent === "create" ? "CREAR CUENTA" : "INICIAR SESIÓN"}</span></div>
      <label className="consentCheck"><input type="checkbox" checked={rememberSession} onChange={(event) => { setRememberSession(event.target.checked); setAuthSessionPersistence(event.target.checked); }} /><span>Mantener sesión iniciada en este dispositivo.</span></label>
      {!emailMode ? <div className="accessActions">
        {googleAvailable && <button className="oauthButton google" disabled={busy} onClick={() => social("google")}>Continuar con Google</button>}
        {googleAvailable && <button className="textButton" disabled={busy} onClick={() => social("google", true)}>Usar otra cuenta de Google</button>}
        <button className="secondary big" disabled={busy} onClick={() => { setEmailMode(true); setMessage(""); }}>{intent === "create" ? "Registro con email" : "Continuar con correo"}</button>
      </div> : <div className="emailAccess">
        {!codeSent ? <>
          <label htmlFor="access-email">Correo electrónico</label>
          <input id="access-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" />
          {intent === "create" && <p className="hint">Verifica tu correo para crear tu cuenta. Si ya estás registrado, elige Iniciar sesión.</p>}
          <button className="primary big" disabled={busy || retrySeconds > 0} onClick={() => void sendCode()}>{busy ? "Enviando…" : retrySeconds ? `Enviar en ${retrySeconds}s` : "Enviar código"}</button>
          <button className="textButton" disabled={busy} onClick={() => setEmailMode(false)}>← Volver</button>
        </> : <>
          <h2>Código de verificación</h2>
          <p>Enviado a {email.trim()}</p>
          <label htmlFor="access-otp">Introduce los 8 dígitos del correo</label>
          <input id="access-otp" className="otpInput" aria-label="Código de ocho dígitos" inputMode="numeric" autoComplete="one-time-code" maxLength={8} disabled={busy} value={otp} onChange={(event) => setOtp(normalizeOtp(event.target.value))} placeholder="8 dígitos" />
          <p className="hint">Todavía no has iniciado sesión. Tu cuenta se abrirá solo al verificar el código.</p>
          <button className="primary big" disabled={busy || otp.length !== 8} onClick={verifyCode}>{busy ? "Verificando…" : "Verificar"}</button>
          <div className="otpLinks"><button className="textButton" disabled={busy || retrySeconds > 0} onClick={() => void sendCode()}>{retrySeconds ? `Reenviar en ${retrySeconds}s` : "Reenviar código"}</button><button className="textButton" disabled={busy} onClick={() => { setCodeSent(false); setOtp(""); setMessage(""); }}>Cambiar correo</button></div>
          <button className="textButton" disabled={busy} onClick={() => { setEmailMode(false); setMessage(""); }}>← Regresar al acceso</button>
        </>}
      </div>}</>}
      {(message || sessionError) && <div className="accessMessage" role="status">{message || sessionError}</div>}
      {loginRecovery && <div className="modalBackdrop" onKeyDown={(event) => { if (event.key === "Escape") setLoginRecovery(null); }}><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="email-login-recovery-title">
        <ModalCloseButton onClose={() => setLoginRecovery(null)} disabled={busy} />
        <h2 id="email-login-recovery-title">{loginRecovery === "existing" ? "Ya existe una cuenta con este correo." : "No encontramos una cuenta con este correo."}</h2>
        <p>{loginRecovery === "existing" ? "Inicia sesión para acceder a tu cuenta." : "Elige crear una cuenta para recibir el código de alta, o usa otro correo."}</p>
        <div className="dialogActions"><button autoFocus type="button" className="primary" disabled={busy} onClick={() => { const nextIntent = loginRecovery === "existing" ? "login" : "create"; setLoginRecovery(null); setIntent(nextIntent); setCodeSent(false); setOtp(""); void sendCode(nextIntent); }}>{loginRecovery === "existing" ? "INICIAR SESIÓN" : "CREAR CUENTA"}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => { setLoginRecovery(null); setCodeSent(false); setOtp(""); setMessage(""); requestAnimationFrame(() => document.getElementById("access-email")?.focus()); }}>USAR OTRO CORREO</button></div>
      </section></div>}
      <p className="legalLead">Consulta el <Link href="/legal/privacy-simplified?returnTo=access">Aviso de Privacidad Simplificado</Link>, el <Link href="/legal/privacy?returnTo=access">Aviso de Privacidad Integral</Link> y los <Link href="/legal/terms?returnTo=access">Términos y Condiciones</Link>. La aceptación explícita ocurre antes de crear el perfil.</p>
    </section>
  </main>;
}

function ConsentScreen({ onAccept, onBack }: { onAccept: () => Promise<void>; onBack: () => Promise<void> }) {
  const [requiredAccepted, setRequiredAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <main className="consentScreen"><section className="consentCard">
    <BrandLockup compact />
    <div className="eyebrow">PRIMER ACCESO</div>
    <h1>Consentimientos de cuenta</h1>
    <section className="consentDecision"><h2>CONSENTIMIENTOS REQUERIDOS</h2><p>Acepta los términos, confirma la mayoría de edad y reconoce el alcance del Árbitro de Reglas. En una competencia oficial, el Comité o árbitro oficial tiene siempre la decisión final.</p>
      <p><Link href="/legal/terms?returnTo=onboarding">Términos y Condiciones</Link> · <Link href="/legal/privacy?returnTo=onboarding">Aviso de Privacidad</Link></p>
      {requiredAccepted ? <div className="officialPriority" role="status">✓ Consentimientos requeridos aceptados.</div> : <div className="consentDecisionActions"><button type="button" className="primary" disabled={busy} onClick={() => { setRequiredAccepted(true); setError(""); }}>ACEPTAR TODO Y CONTINUAR</button><button type="button" className="secondary" disabled={busy} onClick={() => setError("Para crear una cuenta de The Backyard debes aceptar los consentimientos requeridos.")}>NO ACEPTO</button></div>}
    </section>
    <p className="hint">Las funciones opcionales pedirán autorización sólo cuando decidas usarlas.</p>
    {error && <p role="alert">{error}</p>}
    <button className="primary big" disabled={!requiredAccepted || busy} onClick={async () => { setBusy(true); setError(""); try { await onAccept(); } catch { setError("No pudimos guardar tu aceptación en este dispositivo. Libera espacio y vuelve a intentar."); } finally { setBusy(false); } }}>{busy ? "Guardando…" : "CONTINUAR"}</button>
    <button className="textButton consentBack" disabled={busy} onClick={onBack}>← Volver al acceso</button>
  </section></main>;
}

function ProfileSetupScreen({ identity, onSave, onBack }: {
  identity: BackyardIdentity;
  onSave: (profile: BackyardProfileUpdate) => Promise<ProfileSaveResult>;
  onBack: () => Promise<void>;
}) {
  const [givenName, setGivenName] = useState(identity.givenName || "");
  const [familyName, setFamilyName] = useState(identity.familyName || "");
  const [location, setLocation] = useState(() => normalizeProfileLocation(identity.country || identity.countryCode ? identity : { countryCode: "MX" }));
  const [city, setCity] = useState(identity.city || "");
  const [handedness, setHandedness] = useState<"" | "right" | "left" | "ambidextrous">(identity.handedness || "");
  const [initialHighContrast, setInitialHighContrast] = useState(true);
  useEffect(() => { setInitialHighContrast(localStorage.getItem(STORAGE_KEYS.contrast) !== 'false'); }, []);
  const [avatarUrl, setAvatarUrl] = useState(identity.avatarUrl || "");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const saveInFlight = useRef(false);
  const [message, setMessage] = useState("");
  const missing = missingInitialProfileFields(identity);
  const saveProfileValues = useCallback(async () => {
    if (avatarBusy || saveInFlight.current) return;
    if (!givenName.trim() || !familyName.trim()) {
      setMessage("Captura tu nombre y apellido(s) para continuar.");
      return;
    }
    const displayName = [givenName.trim(), familyName.trim()].filter(Boolean).join(" ");
    const validation = validateProfileDraft(displayName, "");
    if (!validation.ok) { setMessage(validation.message); return; }
    const avatarValidation = validateProfileAvatarUrl(avatarUrl);
    if (!avatarValidation.ok) { setMessage(avatarValidation.message); return; }
    const locationValidation = validateProfileLocation(location, { countryRequired: true, stateRequired: true });
    if (!locationValidation.valid) { setMessage(locationValidation.errors.country || locationValidation.errors.state || "Revisa tu país y región."); return; }
    if (!handedness) { setMessage("Selecciona tu mano dominante."); return; }
    saveInFlight.current = true; setBusy(true); setMessage("");
    try { const result = await onSave({
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
    });
      if (result === "cloud_pending") setMessage("Perfil guardado · sincronizando avatar…");
      else if (result === "local") setMessage("Perfil guardado en este dispositivo · sincronización pendiente.");
    }
    catch { setMessage("No pudimos completar el perfil. Revisa tu conexión e intenta nuevamente."); }
    finally { saveInFlight.current = false; setBusy(false); }
  }, [avatarBusy, identity.defaultHandicap, givenName, familyName, avatarUrl, location, city, handedness, onSave]);
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveProfileValues();
  }

  return <main className={`consentScreen profileSetupScreen ${initialHighContrast ? 'highContrast' : ''}`}><section className="consentCard profileSetupCard">
    <BrandLockup compact />
    <div className="eyebrow">GOLF PROFILE</div>
    <h1>Revisa tus datos personales</h1>
    <p>Confirma o edita tu nombre, apellidos y foto antes de continuar.</p>
    <form className="profileSetupForm" onSubmit={saveProfile} noValidate>
      <div className="grid2"><label htmlFor="profile-setup-given">Nombre<input id="profile-setup-given" required autoComplete="given-name" enterKeyHint="next" value={givenName} onChange={(event) => setGivenName(event.target.value)} placeholder="Tu nombre" /></label><label htmlFor="profile-setup-family">Apellidos<input id="profile-setup-family" required autoComplete="family-name" enterKeyHint="next" value={familyName} onChange={(event) => setFamilyName(event.target.value)} placeholder="Tus apellidos" /></label></div>
      <label>Foto / avatar opcional</label><ProfileImagePicker value={avatarUrl} providerPhotoUrl={identity.avatarUrl || undefined} onChange={setAvatarUrl} onBusyChange={setAvatarBusy} accessToken={identity.accessToken} userId={identity.userId} />
      {missing.includes("location") && <><ProfileLocationPicker value={location} onChange={(next) => { setLocation(next); setMessage(""); }} /><label htmlFor="profile-setup-city">Ciudad opcional<input id="profile-setup-city" autoComplete="address-level2" value={city} onChange={(event) => setCity(event.target.value)} placeholder="Puebla" /></label></>}
      {missing.includes("handedness") && <fieldset className="handednessChoice"><legend>Mano dominante</legend><label><input type="radio" name="handedness" checked={handedness === "right"} onChange={() => setHandedness("right")} />Derecha</label><label><input type="radio" name="handedness" checked={handedness === "left"} onChange={() => setHandedness("left")} />Izquierda</label></fieldset>}
      {message && <div className="accessMessage" role="alert">{message}</div>}
      <button type="submit" className="primary big" disabled={busy || avatarBusy}>{busy ? "Guardando…" : avatarBusy ? "Preparando imagen…" : "Guardar y continuar"}</button>
    </form>
    <button className="textButton" disabled={busy} onClick={onBack}>← Volver al acceso</button>
  </section></main>;
}

function CanonicalEquipmentOnboarding({ identity, onComplete }: { identity: BackyardIdentity; onComplete: () => void }) {
  const ghinControl = useGhinReadOnlyProfile(identity.accessToken);
  const indexControl = useBackyardIndexPreference(identity.userId, Boolean(identity.accessToken));
  const [history] = useState<RoundSnapshot[]>(() => typeof window === "undefined"
    ? []
    : readStoredJson<RoundSnapshot[]>(localStorage, STORAGE_KEYS.history, []));
  const accountIndex = selectedHandicapIndex(indexControl.preference, history, identity.userId, ghinControl.profile);
  return <EquipmentOnboarding
    userId={identity.userId}
    accessToken={identity.accessToken}
    defaultHandicap={accountIndex.value}
    defaultHandicapSource={accountIndex.source}
    defaultHandedness={identity.handedness}
    ballFitDefaults={ballFitDefaultsFromProfile(identity)}
    onComplete={onComplete}
    onBack={onComplete}
    onSaveAndExit={onComplete}
  />;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<BackyardIdentity | null>(null);
  const [adminAccessState, setAdminAccessState] = useState(() => ({ userId: "", access: NO_ADMIN_ACCESS } as { userId: string; access: AdminAccess }));
  const [acceptances, setAcceptances] = useState<LegalAcceptance[]>([]);
  const [legalEvidenceState, setLegalEvidenceState] = useState<LocalLegalEvidenceState | null>(null);
  const legalEnvironment = legalClientEnvironment();
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
  const [optionalAuthorizationCheck, setOptionalAuthorizationCheck] = useState<"pending" | "ready" | "error">("pending");
  const [optionalAuthorizationRequired, setOptionalAuthorizationRequired] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false);
  const [accountEntry, setAccountEntry] = useState<AccountEntry | null>(null);
  const [accountEntryError, setAccountEntryError] = useState("");
  const [accountEntryRetry, setAccountEntryRetry] = useState(0);
  const [activationState, setActivationState] = useState<AccountActivationSnapshot | null>(null);
  const [activationError, setActivationError] = useState("");
  const [activationRetry, setActivationRetry] = useState(0);
  const [activationBusy, setActivationBusy] = useState(false);
  const activationInFlight = useRef(false);
  const activationKeys = useRef(new Map<string, string>());
  const [existingAccountNotice, setExistingAccountNotice] = useState(false);
  const [pendingDeletionSession, setPendingDeletionSession] = useState<Session | null>(null);
  const [pendingDeletionOwner, setPendingDeletionOwner] = useState("");
  const [pendingDeletionAccountActive, setPendingDeletionAccountActive] = useState(false);
  const [deletionRecoveryBusy, setDeletionRecoveryBusy] = useState(false);
  const [deletionRecoveryError, setDeletionRecoveryError] = useState("");
  const [pendingLocalDeletionOwner, setPendingLocalDeletionOwner] = useState("");
  const deletionRecoveryInFlight = useRef(false);
  const activeUserId = useRef<string | null>(null);
  const sessionRecovery = useRef<{ userId: string; promise: Promise<string> } | null>(null);
  const bettingConsentRequest = useRef<{ userId: string; promise: Promise<boolean>; resolve: (accepted: boolean) => void } | null>(null);
  const [cloudIssuesByDomain, setCloudIssuesByDomain] = useState<Partial<Record<CloudIssueDomain, CloudIssue>>>({});
  const [legalRetryRevision, setLegalRetryRevision] = useState(0);
  const [accountReloadRevision, setAccountReloadRevision] = useState(0);
  const accountHydrationRevision = useRef(0);
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
  const accountMutationStillActive = useCallback((userId: string) => activeUserId.current === userId
    && !localStorage.getItem(accountDeletionMarkerKey(userId)), []);
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
    if (!accountMutationStillActive(userId)) throw new Error("Session changed");
  }, [accountMutationStillActive]);
  useEffect(() => {
    if (identity?.mode === "authenticated" && accountMutationStillActive(identity.userId)) {
      cloudProfileFallbackRef.current = { userId: identity.userId, profile: cloudProfileFields(identity) };
      try { localStorage.setItem(`backyard-profile-cache-v1:${identity.userId}`, JSON.stringify(profileCachePayload(identity))); }
      catch { issueWithMessage("profile", "No se pudo guardar el perfil local. Libera espacio y reintenta."); }
    }
  }, [identity, issueWithMessage, accountMutationStillActive]);

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
    setOptionalAuthorizationCheck("pending");
    setOptionalAuthorizationRequired(false);
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

  const activateOfflineWorkspace = useCallback((recoveryError?: unknown) => {
    // A deleted/revoked account is not a network outage. Its cached profile
    // must not reactivate an offline identity or leave the consent gate waiting.
    if (recoveryError instanceof AuthSessionRecoveryError && recoveryError.failure === "invalid") return false;
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
      if (activateOfflineWorkspace(error)) setCloudIssue("auth", issue);
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
          if (activateOfflineWorkspace(error)) setCloudIssue("auth", issue);
          else setCloudIssue("auth", issue);
          setReady(true);
        });
      }, 0);
    });
    const restoreWhenOnline = () => {
      if (!supabase) return;
      void restoreAuthSession(supabase.auth).then(session => {
        if (mounted && session) {
          activateSession(session);
          // Retry durable queues even when the refreshed session keeps the
          // same user and access token value.
          setLegalRetryRevision((value) => value + 1);
          accountHydrationRevision.current += 1;
          setAccountReloadRevision((value) => value + 1);
          window.setTimeout(() => window.dispatchEvent(new Event("backyard-sync-retry")), 0);
        }
      }).catch(error => {
        if (!mounted) return;
        const issue = cloudIssueFromError("auth", error instanceof AuthSessionRecoveryError ? error.cause : error, navigator.onLine);
        if (activateOfflineWorkspace(error)) setCloudIssue("auth", issue);
        else setCloudIssue("auth", issue);
      });
    };
    window.addEventListener("online", restoreWhenOnline);
    return () => { mounted = false; listener?.data.subscription.unsubscribe(); window.removeEventListener("online", restoreWhenOnline); };
    // Cleanup reads current storage and uses only stable setters/refs; rerunning
    // this bootstrap effect after every render would race auth restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activateSession, activateOfflineWorkspace, setCloudIssue, setCloudStatus]);

  const activationUserId = identity?.mode === "authenticated" ? identity.userId : "";
  const activationToken = identity?.mode === "authenticated" ? identity.accessToken : null;
  const activeAccountConfirmed = activationState?.userId === activationUserId && activationState.state.status === "active";
  const authenticatedUserId = activeAccountConfirmed ? activationUserId : "";
  const authenticatedAccessToken = activeAccountConfirmed ? activationToken : null;
  useEffect(() => {
    if (!activationUserId || !activationToken) return;
    const controller = new AbortController();
    void requestAccountActivation(activationToken, undefined, undefined, controller.signal).then(state => {
      if (!controller.signal.aborted && activeUserId.current === activationUserId) { setActivationState({ userId: activationUserId, state }); setActivationError(""); }
    }).catch(error => { if (!controller.signal.aborted && activeUserId.current === activationUserId) { setActivationState(null); setActivationError(error instanceof Error ? error.message : "No pudimos verificar tu cuenta."); } });
    return () => controller.abort();
  }, [activationUserId, activationToken, activationRetry]);

  useEffect(() => {
    setAdminAccessState({ userId: "", access: NO_ADMIN_ACCESS });
    if (!authenticatedUserId || !authenticatedAccessToken) return;
    const controller = new AbortController();
    void readAdminAccess(authenticatedAccessToken, controller.signal)
      .then((access) => {
        if (!controller.signal.aborted && activeUserId.current === authenticatedUserId) setAdminAccessState({ userId: authenticatedUserId, access });
      })
      .catch(() => {
        if (!controller.signal.aborted && activeUserId.current === authenticatedUserId) setAdminAccessState({ userId: authenticatedUserId, access: NO_ADMIN_ACCESS });
      });
    return () => controller.abort();
  }, [authenticatedUserId, authenticatedAccessToken]);

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
        // Established accounts with current legal consent enter the app directly.
        // Optional AI consent remains available in settings and at feature use.
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
    let refreshQueued = false;
    const requestAccountRefresh = () => {
      if (!navigator.onLine || activeUserId.current !== authenticatedUserId || refreshQueued) return;
      // Invalidate an in-flight response synchronously. React may commit the
      // state-driven effect cleanup after a consent mutation has already
      // updated its local cache, so AbortController alone is not a race guard.
      accountHydrationRevision.current += 1;
      refreshQueued = true;
      queueMicrotask(() => {
        refreshQueued = false;
        if (navigator.onLine && activeUserId.current === authenticatedUserId) {
          setAccountReloadRevision((value) => value + 1);
        }
      });
    };
    const reloadProfileFromAnotherTab = (event: StorageEvent) => {
      if (event.key === revisionKey && event.newValue) {
        accountHydrationRevision.current += 1;
        setAccountReloadRevision((value) => value + 1);
      }
    };
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") requestAccountRefresh(); };
    window.addEventListener("storage", reloadProfileFromAnotherTab);
    window.addEventListener("focus", requestAccountRefresh);
    window.addEventListener("online", requestAccountRefresh);
    window.addEventListener(OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT, requestAccountRefresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("storage", reloadProfileFromAnotherTab);
      window.removeEventListener("focus", requestAccountRefresh);
      window.removeEventListener("online", requestAccountRefresh);
      window.removeEventListener(OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT, requestAccountRefresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [authenticatedUserId]);

  useEffect(() => {
    if (!authenticatedUserId || !authenticatedAccessToken) return;
    if (accountEntry?.userId !== authenticatedUserId) return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const fallback = cloudProfileFallbackRef.current;
    if (!fallback || fallback.userId !== authenticatedUserId) return;
    const profileWriteCoordinator = profileWriterFor(authenticatedUserId);
    const hydrationRevision = ++accountHydrationRevision.current;
    const controller = new AbortController();
    let mounted = true;
    setOptionalAuthorizationCheck((current) => current === "ready" ? current : "pending");
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
    const preferencesRead = pendingProfileAttempt.then(() => supabase.from("user_preferences").select("default_handicap,high_contrast,notifications_enabled,updated_at").eq("user_id", authenticatedUserId).maybeSingle());
    const locationRead = pendingProfileAttempt.then(() => readProfileLocationMetadata(supabase, authenticatedUserId)
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason: unknown) => ({ status: "rejected" as const, reason })));
    const optionalAuthorizationRead = pendingProfileAttempt.then(() => requestOptionalAuthorizationState(authenticatedAccessToken, controller.signal)
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason: unknown) => ({ status: "rejected" as const, reason })));
    Promise.all([
      supabase.from("legal_acceptances").select("user_id,type,version,accepted_at,locale").eq("user_id", authenticatedUserId),
      profileRead,
      preferencesRead,
      pendingProfileAttempt,
      locationRead,
      optionalAuthorizationRead,
    ]).then(([legalResult, profileResult, preferencesResult, pendingResult, locationResult, optionalAuthorizationResult]) => {
      if (!mounted || controller.signal.aborted || hydrationRevision !== accountHydrationRevision.current
        || activeUserId.current !== authenticatedUserId) return;
      // Existing accounts may have a durable contrast choice from before the
      // explicit optional-authorization ledger. Absence remains undecided.
      if (accountEntry.existingAccount && !preferencesResult.error && localStorage.getItem(STORAGE_KEYS.contrast) === null && typeof preferencesResult.data?.high_contrast === 'boolean') localStorage.setItem(STORAGE_KEYS.contrast, String(preferencesResult.data.high_contrast));
      if (optionalAuthorizationResult.status === "fulfilled") {
        const saved = optionalAuthorizationResult.value;
        // The server ledger is canonical across devices. These projections are
        // runtime caches only; they never mint another consent decision.
        cacheAccountLearningConsent(localStorage, authenticatedUserId, saved);
        const devicePreferences = hydrateOptionalDevicePermissionPreferences(localStorage, authenticatedUserId, saved);
        setOptionalAuthorizationRequired(saved.eligible && !saved.resolved);
        setOptionalAuthorizationCheck("ready");
        window.dispatchEvent(new CustomEvent(ACCOUNT_LEARNING_CONSENT_HYDRATED_EVENT, {
          detail: { userId: authenticatedUserId },
        }));
        try { localStorage.setItem(STORAGE_KEYS.notifications, String(devicePreferences.notificationPreference === "enabled")); }
        catch { /* Runtime uses the volatile canonical decision when storage is unavailable. */ }
        window.dispatchEvent(new CustomEvent("backyard:account-notifications-hydrated", {
          detail: { userId: authenticatedUserId, enabled: devicePreferences.notificationPreference === "enabled" },
        }));
      } else {
        // Until the canonical ledger can be read, only values carrying a
        // prior server-decision clock may remain active. Old local ON values
        // are cache, not evidence of consent.
        failClosedAccountLearningConsent(localStorage, authenticatedUserId);
        const devicePreferences = failClosedAccountDevicePermissionPreferences(localStorage, authenticatedUserId);
        setOptionalAuthorizationCheck((current) => current === "ready" ? current : "error");
        window.dispatchEvent(new CustomEvent(ACCOUNT_LEARNING_CONSENT_HYDRATED_EVENT, {
          detail: { userId: authenticatedUserId },
        }));
        const notificationsEnabled = devicePreferences.notificationPreference === "enabled";
        try { localStorage.setItem(STORAGE_KEYS.notifications, String(notificationsEnabled)); }
        catch { /* Runtime uses the volatile fail-closed decision when storage is unavailable. */ }
        window.dispatchEvent(new CustomEvent("backyard:account-notifications-hydrated", {
          detail: { userId: authenticatedUserId, enabled: notificationsEnabled },
        }));
      }
      if (!legalResult.error && Array.isArray(legalResult.data)) {
        const cloud = parseLegalAcceptances(JSON.stringify(legalResult.data.map((item) => ({ userId: item.user_id, type: item.type, documentVersion: item.version, acceptedAt: item.accepted_at, locale: item.locale, persistenceStatus: "persisted", syncStatus: "synced" }))));
        setAcceptances((current) => {
          const merged = mergeLegalAcceptances(current, cloud);
          localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(merged));
          return merged;
        });
        setCloudConsentChecked(true);
      } else if (legalResult.error) {
        // An unreadable canonical ledger is unknown, not evidence that the
        // account never accepted. Keep the consent screen closed until a
        // successful retry resolves the account record.
        setCloudConsentChecked(false);
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
          const profileVisibility = cloudProfile.profile_visibility === "public" || cloudProfile.profile_visibility === "friends" || cloudProfile.profile_visibility === "private"
            ? cloudProfile.profile_visibility
            : current.profileVisibility;
          // Existing preference clocks belong to the full sync merge. Updating
          // just HCP here would masquerade as a local edit on the next autosave.
          const cloudHandicap = preferencesResult.data ? preferencesResult.data.default_handicap : cloudProfile.default_handicap ?? null;
          const defaultHandicap = preferencesResult.error || localStorage.getItem(CLOUD_LOCAL_META_KEY) ? current.defaultHandicap : clampBackyardHandicap(cloudHandicap);
          const savedLocation = locationResult.status === "fulfilled" ? locationResult.value : null;
          const locationPatch = savedLocation && Date.parse(savedLocation.updatedAt) >= (Date.parse(current.locationUpdatedAt || "") || 0)
            ? { ...normalizeProfileLocation(savedLocation), locationUpdatedAt: savedLocation.updatedAt }
            : {};
          if (current.displayName === displayName && current.username === username && current.avatarUrl === avatarUrl && current.defaultHandicap === defaultHandicap && current.profileVisibility === profileVisibility && Object.entries(locationPatch).every(([key, value]) => current[key as keyof BackyardProfile] === value)) return current;
          return { ...current, displayName, username, avatarUrl, defaultHandicap, profileVisibility, ...locationPatch };
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
      if (mounted && hydrationRevision === accountHydrationRevision.current
        && activeUserId.current === authenticatedUserId) setCloudIssue("profile", cloudIssueFromError("profile", error, navigator.onLine));
    }).finally(() => {
      if (mounted && hydrationRevision === accountHydrationRevision.current
        && activeUserId.current === authenticatedUserId) setProfileChecked(true);
    });
    return () => { mounted = false; controller.abort(); };
  }, [authenticatedUserId, authenticatedAccessToken, accountEntry, accountReloadRevision, issueWithMessage, profileWriterFor, setCloudIssue]);

  const legalEvidenceEvents = identity && legalEvidenceState?.environment === legalEnvironment
    && (identity.mode === "authenticated"
      ? legalEvidenceState.actorKey === `account:${identity.userId}`
      : legalEvidenceState.actorKey.startsWith("guest-local:"))
    ? legalEvidenceState.events
    : [];
  const legalEvidenceResolved = Boolean(identity && legalEvidenceState?.resolved && legalEvidenceState.environment === legalEnvironment
    && (identity.mode === "authenticated"
      ? legalEvidenceState.actorKey === `account:${identity.userId}`
      : legalEvidenceState.actorKey.startsWith("guest-local:")));
  const locallyResolvedLegalSubjects = identity && legalEvidenceState?.environment === legalEnvironment
    && (identity.mode === "authenticated"
      ? legalEvidenceState.actorKey === `account:${identity.userId}`
      : legalEvidenceState.actorKey.startsWith("guest-local:"))
    ? legalEvidenceState.resolvedSubjects
    : [];
  const currentConsent = identity ? hasCurrentLegalConsent(acceptances, identity.userId) : false;
  const legacyBettingConsent = identity ? hasCurrentBettingDataConsent(acceptances, identity.userId) : false;
  const financialConsentResolved = hasResolvedFinancialChoice(legalEvidenceEvents, legacyBettingConsent, legalEvidenceResolved)
    || locallyResolvedLegalSubjects.includes("financial_data");
  const marketingConsentResolved = legalEvidenceResolved || locallyResolvedLegalSubjects.includes("marketing");
  const bettingConsentGranted = hasResolvedFinancialConsent(legalEvidenceEvents, legacyBettingConsent, financialConsentResolved);
  const bettingConsentResolved = Boolean(identity && financialConsentResolved && (identity.mode === "guest" || cloudConsentChecked));

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
    if (bettingConsentGranted) return Promise.resolve(true);
    if (bettingConsentRequest.current?.userId === identity.userId) return bettingConsentRequest.current.promise;
    let resolveRequest!: (accepted: boolean) => void;
    const promise = new Promise<boolean>((resolve) => { resolveRequest = resolve; });
    bettingConsentRequest.current = { userId: identity.userId, promise, resolve: resolveRequest };
    if (identity.mode === "guest" || cloudConsentChecked) setBettingConsentOpen(true);
    return promise;
  }, [bettingConsentGranted, identity, cloudConsentChecked]);

  useEffect(() => {
    const pending = bettingConsentRequest.current;
    if (!pending || !identity || pending.userId !== identity.userId || (identity.mode === "authenticated" && !cloudConsentChecked)) return;
    if (bettingConsentGranted) closeBettingConsent(true);
    else setBettingConsentOpen(true);
  }, [bettingConsentGranted, identity, cloudConsentChecked, closeBettingConsent]);

  useEffect(() => {
    const pending = bettingConsentRequest.current;
    if (pending && pending.userId !== identity?.userId) closeBettingConsent(false);
  }, [identity?.userId, closeBettingConsent]);

  useEffect(() => {
    if (identity?.mode !== "authenticated" || !identity.accessToken || !currentConsent
      || !activeAccountConfirmed
      || localStorage.getItem(accountDeletionMarkerKey(identity.userId))) return;
    const syncingUserId = identity.userId;
    const saved = acceptances.filter((item) => item.userId === syncingUserId);
    const pending = prepareLegalSyncBatch(localStorage, syncingUserId, saved);
    if (!pending) return;
    const current = pending.acceptances;
    let mounted = true;
    void flushLegalAcceptances(syncingUserId, current).then(() => {
      if (!mounted || activeUserId.current !== syncingUserId
        || localStorage.getItem(accountDeletionMarkerKey(syncingUserId))) return;
      clearPendingLegalSync(localStorage, syncingUserId);
      setAcceptances((saved) => {
        const synced = markLegalAcceptancesSynced(saved, current);
        if (synced !== saved) localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(synced));
        return synced;
      });
      setCloudIssue("legal", null);
    }).catch((error) => {
      if (!mounted || activeUserId.current !== syncingUserId
        || localStorage.getItem(accountDeletionMarkerKey(syncingUserId))) return;
      markLegalSyncFailed(localStorage, syncingUserId, error);
      setCloudIssue("legal", {
        ...cloudIssueFromError("legal", error, navigator.onLine),
        message: legalSyncErrorMessage(error, navigator.onLine),
      });
    });
    return () => { mounted = false; };
  }, [identity?.mode, identity?.userId, identity?.accessToken, activeAccountConfirmed, currentConsent, acceptances, legalRetryRevision, flushLegalAcceptances, issueWithMessage, setCloudIssue]);

  useEffect(() => {
    if (!identity) {
      setLegalEvidenceState(null);
      return;
    }
    // A legitimate OTP can authenticate a deactivated account. Protected
    // evidence hydration must wait for activation, just like profile data.
    if (identity.mode === "authenticated" && !activeAccountConfirmed) return;
    const owner = { mode: identity.mode, userId: identity.userId } as const;
    let actorKey = "";
    try {
      actorKey = legalActorForIdentity(localStorage, owner).actorKey;
      const events = readLegalEvidence(localStorage, actorKey, legalEnvironment);
      setLegalEvidenceState((current) => ({
        actorKey,
        environment: legalEnvironment,
        events,
        resolved: current?.actorKey === actorKey && current.environment === legalEnvironment ? current.resolved : identity.mode === "guest",
        resolvedSubjects: current?.actorKey === actorKey && current.environment === legalEnvironment ? current.resolvedSubjects : [],
      }));
    } catch (error) {
      setLegalEvidenceState(null);
      setCloudIssue("legal", {
        domain: "legal",
        kind: "pending",
        message: error instanceof Error ? error.message : "No pudimos leer la evidencia legal de este dispositivo.",
        retryable: true,
      });
      return;
    }
    if (identity.mode !== "authenticated" || !identity.accessToken) return;
    if (!accountMutationStillActive(identity.userId)) return;
    if (!navigator.onLine) {
      setCloudIssue("legal", {
        domain: "legal",
        kind: "offline",
        message: legalEvidenceSyncMessage(new Error("offline"), false),
        retryable: true,
      });
      return;
    }
    const userId = identity.userId;
    const accessToken = identity.accessToken;
    let mounted = true;
    void synchronizeLegalEvidence({
      storage: localStorage,
      userId,
      accessToken,
      environment: legalEnvironment,
      isCurrentIdentity: () => accountMutationStillActive(userId),
    }).then((events) => {
      if (!mounted || !accountMutationStillActive(userId)) return;
      setLegalEvidenceState({ actorKey: `account:${userId}`, environment: legalEnvironment, events, resolved: true, resolvedSubjects: [] });
      setCloudIssue("legal", null);
    }).catch((error) => {
      if (!mounted || !accountMutationStillActive(userId)) return;
      const actorKey = `account:${userId}`;
      setLegalEvidenceState((current) => ({
        actorKey,
        environment: legalEnvironment,
        events: readLegalEvidence(localStorage, actorKey, legalEnvironment),
        // Initial hydration remains unresolved. Once an authoritative state
        // has been established, a timeout/unavailable response is unknown and
        // cannot erase it; a real remote revocation arrives through the
        // successful merge path above.
        resolved: current?.actorKey === actorKey && current.environment === legalEnvironment
          ? current.resolved
          : false,
        resolvedSubjects: current?.actorKey === actorKey && current.environment === legalEnvironment ? current.resolvedSubjects : [],
      }));
      const issue = cloudIssueFromError("legal", error, navigator.onLine);
      const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status || 0) : 0;
      setCloudIssue("legal", {
        ...issue,
        kind: status === 503 ? "pending" : issue.kind,
        message: legalEvidenceSyncMessage(error, navigator.onLine),
      });
    });
    return () => { mounted = false; };
  }, [identity, activeAccountConfirmed, legalEnvironment, legalRetryRevision, setCloudIssue, accountMutationStillActive]);

  useEffect(() => {
    if (!identity) return;
    if (identity.mode === "authenticated" && !activeAccountConfirmed) return;
    const mode = identity.mode;
    const userId = identity.userId;
    const accessToken = identity.accessToken;
    let actorKey = "";
    try { actorKey = legalActorForIdentity(localStorage, { mode, userId }).actorKey; }
    catch { return; }
    const evidenceKey = legalEvidenceStateKey(actorKey, legalEnvironment);
    let refreshQueued = false;
    const requestRemoteResolution = () => {
      if (mode !== "authenticated" || !accessToken || !navigator.onLine || refreshQueued
        || !accountMutationStillActive(userId)) return;
      refreshQueued = true;
      queueMicrotask(() => {
        refreshQueued = false;
        if (!accountMutationStillActive(userId)) return;
        // A foreground/network transition is only a request to refresh. It is
        // not evidence of revocation, so retain the last resolved decision
        // until an authoritative response actually changes it.
        setLegalRetryRevision((value) => value + 1);
      });
    };
    const rehydrateFromAnotherTab = (event: StorageEvent) => {
      if (event.key !== evidenceKey || (event.storageArea && event.storageArea !== localStorage)) return;
      if (mode === "authenticated" && !accountMutationStillActive(userId)) return;
      const events = readLegalEvidence(localStorage, actorKey, legalEnvironment);
      // Cross-tab acceptance never opens the gate from an event alone. A
      // revocation closes it immediately; authenticated acceptance waits for
      // the owner-scoped server reconciliation below.
      setLegalEvidenceState({ actorKey, environment: legalEnvironment, events, resolved: mode === "guest", resolvedSubjects: [] });
      requestRemoteResolution();
    };
    const refreshOnFocus = () => requestRemoteResolution();
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") requestRemoteResolution(); };
    window.addEventListener("storage", rehydrateFromAnotherTab);
    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener("online", refreshOnFocus);
    window.addEventListener(OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT, refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("storage", rehydrateFromAnotherTab);
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener("online", refreshOnFocus);
      window.removeEventListener(OPTIONAL_AUTHORIZATIONS_CHANGED_EVENT, refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [identity, activeAccountConfirmed, legalEnvironment, accountMutationStillActive]);

  function recordLegalChoices(
    choices: Array<{ subject: LegalEvidenceSubject; action: LegalEvidenceAction }>,
    origin: LegalEvidenceOrigin,
  ) {
    if (!identity) throw new Error("No se pudo identificar el contexto de esta elección.");
    if (identity.mode === "authenticated" && !accountMutationStillActive(identity.userId)) throw new Error("La cuenta está cerrándose; no se guardaron cambios nuevos.");
    const recorded = recordLocalLegalEvidenceBatch(localStorage, { mode: identity.mode, userId: identity.userId }, {
      environment: legalEnvironment,
      choices,
      origin,
    });
    setLegalEvidenceState((current) => ({
      actorKey: recorded.actorKey,
      environment: legalEnvironment,
      events: recorded.events,
      resolved: identity.mode === "guest" || Boolean(current?.actorKey === recorded.actorKey && current.environment === legalEnvironment && current.resolved),
      resolvedSubjects: [...new Set([
        ...(current?.actorKey === recorded.actorKey && current.environment === legalEnvironment ? current.resolvedSubjects : []),
        ...choices.map((choice) => choice.subject),
      ])],
    }));
    if (identity.mode === "authenticated" && recorded.recorded.length) setLegalRetryRevision((value) => value + 1);
    return recorded.events;
  }

  async function recordLegalChoice(subject: LegalEvidenceSubject, action: LegalEvidenceAction, origin: LegalEvidenceOrigin = "account_privacy") {
    recordLegalChoices([{ subject, action }], origin);
    if (identity?.mode === "authenticated") {
      const owner = identity.userId;
      if (!identity.accessToken) throw new Error("Inicia sesión para guardar tu decisión.");
      const events = await synchronizeLegalEvidence({ storage: localStorage, userId: owner, accessToken: identity.accessToken,
        environment: legalEnvironment, isCurrentIdentity: () => accountMutationStillActive(owner) });
      if (!accountMutationStillActive(owner)) throw new Error("La sesión cambió antes de confirmar la decisión.");
      const current = events.filter(event => event.subject === subject).at(-1);
      if (current?.action !== action || current.syncStatus !== "synced") throw new Error("El servidor no confirmó tu decisión.");
      setLegalEvidenceState({ actorKey: `account:${owner}`, environment: legalEnvironment, events, resolved: true, resolvedSubjects: [] });
      setCloudIssue("legal", null);
    }
  }

  async function persistAcceptanceBatch(next: LegalAcceptance[], requireServerPersistence: boolean) {
    if (!identity) return;
    if (requireServerPersistence && identity.mode === "authenticated") {
      await flushLegalAcceptances(identity.userId, next);
      if (!accountMutationStillActive(identity.userId)) throw new Error("La sesión cambió antes de guardar las autorizaciones.");
      const synced = markLegalAcceptancesSynced(mergeLegalAcceptances(acceptances, next), next);
      localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(synced));
      clearPendingLegalSync(localStorage, identity.userId);
      setCloudIssue("legal", null);
      setAcceptances(synced);
      return;
    }
    const merged = mergeLegalAcceptances(acceptances, next);
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(merged));
    setAcceptances(merged);
    if (identity.mode === "authenticated") {
      const accountAcceptances = merged.filter((item) => item.userId === identity.userId);
      queueLegalSync(localStorage, identity.userId, accountAcceptances);
      try {
        await flushLegalAcceptances(identity.userId, accountAcceptances);
        if (!accountMutationStillActive(identity.userId)) return;
        clearPendingLegalSync(localStorage, identity.userId);
        const synced = markLegalAcceptancesSynced(merged, accountAcceptances);
        localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(synced));
        setAcceptances(synced);
        setCloudIssue("legal", null);
      } catch (error) {
        if (!accountMutationStillActive(identity.userId)) return;
        markLegalSyncFailed(localStorage, identity.userId, error);
        setCloudIssue("legal", {
          ...cloudIssueFromError("legal", error, navigator.onLine),
          message: legalSyncErrorMessage(error, navigator.onLine),
        });
      }
    }
  }

  async function acceptRequiredConsents(requireServerPersistence = false) {
    if (!identity) return;
    const origin: LegalEvidenceOrigin = acceptances.some((item) => item.userId === identity.userId) ? "existing_user_update" : "onboarding";
    recordLegalChoices([
      { subject: "privacy_notice", action: "presented" },
      { subject: "terms", action: "accepted" },
      { subject: "age_declaration", action: "accepted" },
    ], origin);
    await persistAcceptanceBatch(buildLegalAcceptances(identity.userId, new Date().toISOString()), requireServerPersistence);
  }

  async function acceptConsent(requireServerPersistence = false) {
    if (!identity) return;
    const origin: LegalEvidenceOrigin = acceptances.some((item) => item.userId === identity.userId) ? "existing_user_update" : "onboarding";
    recordLegalChoices([
      { subject: "privacy_notice", action: "presented" },
      { subject: "terms", action: "accepted" },
      { subject: "age_declaration", action: "accepted" },
    ], origin);
    const next = buildLegalAcceptances(identity.userId, new Date().toISOString());
    await persistAcceptanceBatch(next, requireServerPersistence);
  }

  async function acceptBettingConsent() {
    if (!identity) throw new Error("No se pudo identificar el contexto de esta aceptación.");
    recordLegalChoices([{ subject: "financial_data", action: "accepted" }], "financial_gate");
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
        if (!accountMutationStillActive(identity.userId)) return;
        clearPendingLegalSync(localStorage, identity.userId);
        const synced = markLegalAcceptancesSynced(persisted.acceptances, pending.acceptances);
        localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(synced));
        setAcceptances(synced);
        setCloudIssue("legal", null);
      } catch (error) {
        if (!accountMutationStillActive(identity.userId)) return;
        markLegalSyncFailed(localStorage, identity.userId, error);
        setCloudIssue("legal", {
          ...cloudIssueFromError("legal", error, navigator.onLine),
          message: legalSyncErrorMessage(error, navigator.onLine),
        });
      }
    }
    closeBettingConsent(true);
  }

  async function rejectBettingConsent() {
    if (!identity) throw new Error("No se pudo identificar el contexto de esta elección.");
    recordLegalChoices([{ subject: "financial_data", action: "rejected" }], "financial_gate");
    closeBettingConsent(false);
  }

  async function updateProfile(profile: BackyardProfileUpdate): Promise<ProfileSaveResult> {
    if (!identity) return "local";
    if (identity.mode === "authenticated" && !accountMutationStillActive(identity.userId)) return "local";
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
    const previousPending = readPendingProfileWrite(localStorage, identity.userId);
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
    const profileWriteCoordinator = profileWriterFor(identity.userId);
    let primarySaved!: () => void;
    let primaryFailed!: (error: unknown) => void;
    let primarySettled = false;
    const primarySave = new Promise<void>((resolve, reject) => { primarySaved = resolve; primaryFailed = reject; });
    const syncWork = profileWriteCoordinator.run(async (): Promise<{ acknowledged: boolean; metadataPending: boolean }> => {
      try {
        const saved = await saveCloudProfile(supabase, identity.userId, pending.profile, pending.updatedAt, { rebaseOnServerClock: true });
        primarySettled = true;
        primarySaved();
        if (!accountMutationStillActive(identity.userId)) return { acknowledged: false, metadataPending: false };
        // The profile row is canonical; project its public handle/avatar onto
        // the existing Social row, never privacy or a new synthetic identity.
        retimePendingProfileWrite(localStorage, identity.userId, pending.revision, saved.updatedAt);
        await syncExistingSocialProfileAvatar(supabase, identity.userId, pending.profile.avatarUrl, pending.profile.username, pending.profile.displayName);
        if (!accountMutationStillActive(identity.userId)) return { acknowledged: false, metadataPending: false };
        recordCloudProfileRevision(localStorage, identity.userId, saved.updatedAt);
        const acknowledged = acknowledgePendingProfileWrite(localStorage, identity.userId, pending.revision);
        let metadataPending = false;
        // Auth metadata is a legacy display fallback. It is secondary to the
        // canonical profile and must not keep the CTA in “Guardando…”.
        if (["givenName","familyName","handedness","homeClub","homeClubId","homeCourse","homeCourseId","preferredTee"].some(key => Object.hasOwn(profile,key))) {
          const metadataWrite = await supabase.auth.updateUser({ data: {
            given_name: next.givenName || null,
            family_name: next.familyName || null,
            backyard_golf_profile_v1: { handedness: next.handedness || "", homeClub: next.homeClub || "", homeClubId: next.homeClubId || "", homeCourse: next.homeCourse || "", homeCourseId: next.homeCourseId || "", preferredTee: next.preferredTee || "" },
          } });
          if (!accountMutationStillActive(identity.userId)) return { acknowledged: false, metadataPending: false };
          metadataPending = Boolean(metadataWrite.error);
        }
        return { acknowledged, metadataPending };
      } catch (error) {
        if (!primarySettled) { primarySettled = true; primaryFailed(error); }
        throw error;
      }
    });
    // Attach a rejection observer immediately; a timed-out caller leaves this
    // work running so the outbox can still finish without an unhandled promise.
    void syncWork.then(({ acknowledged, metadataPending }) => {
      if (!accountMutationStillActive(identity.userId)) return;
      if (!acknowledged) issueWithMessage("profile", "Hay una edición de perfil más reciente pendiente de sincronizar.", "pending");
      else if (metadataPending) issueWithMessage("profile", "Perfil guardado · sincronización secundaria pendiente.", "pending");
      else setCloudIssue("profile", null);
    }).catch((error) => {
      if (accountMutationStillActive(identity.userId)) setCloudIssue("profile", cloudIssueFromError("profile", error, navigator.onLine));
    });
    const primaryOutcome = await waitForProfilePrimarySave(primarySave);
    if (primaryOutcome.status === "saved") return "cloud_pending";
    if (primaryOutcome.status === "timeout") {
      issueWithMessage("profile", "Perfil guardado en este dispositivo · sincronización pendiente.", "pending");
      return "local";
    }
    const error = primaryOutcome.error;
    {
      // Account deletion may have purged the queued write while this request
      // was in flight. A late rejection must not restore that identity's
      // profile cache, queue or cloud issue after the purge barrier exists.
      if (!accountMutationStillActive(identity.userId)) return "local";
      const cloudError = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
      if (Object.hasOwn(profile, "username") && (cloudError.code === "23505" || /duplicate key|username.*unique/i.test(String(cloudError.message || "")))) {
        restorePendingProfileWrite(localStorage, identity.userId, previousPending);
        cloudProfileFallbackRef.current = previousPending ? { userId: identity.userId, profile: previousPending.profile } : null;
        setIdentity(identity);
        localStorage.setItem(`backyard-profile-cache-v1:${identity.userId}`, JSON.stringify(profileCachePayload(identity)));
        throw Object.assign(new Error("Ese nombre de usuario ya está en uso."), { code: "PROFILE_USERNAME_TAKEN" });
      }
      const rebasedAt = error && typeof error === "object" && "profileUpdatedAt" in error && typeof error.profileUpdatedAt === "string"
        ? error.profileUpdatedAt
        : null;
      if (rebasedAt) retimePendingProfileWrite(localStorage, identity.userId, pending.revision, rebasedAt);
      setCloudIssue("profile", cloudIssueFromError("profile", error, navigator.onLine));
      return "local";
    }
  }

  async function saveInitialProfile(profile: BackyardProfileUpdate): Promise<ProfileSaveResult> {
    if (identity?.mode === "authenticated") {
      // Another device may have completed registration while this form was
      // open. The setup screen is only rendered after this mapping is loaded;
      // do not repeat that network request in the profile CTA.
      const mapping = accountEntry?.userId === identity.userId ? accountEntry : null;
      if (!mapping) throw new Error("No pudimos verificar el estado de esta cuenta.");
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
      persistBetaOnboardingProgress(localStorage, betaProgress);
      void saveOnboardingCheckpoint(identity.accessToken || "", betaProgress).catch(() => {
        if (accountMutationStillActive(identity.userId)) issueWithMessage("profile", "Perfil guardado · el avance de configuración se sincronizará después.", "pending");
      });
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
      setActivationState(null); setActivationError(""); activationKeys.current.clear();
      setEquipmentOnboardingRequired(false);
      setBetaOnboardingRequired(false);
      setOptionalAuthorizationCheck("pending");
      setOptionalAuthorizationRequired(false);
      setAccessRequested(false);
      setCloudLinked(false);
      setCloudStatus("local");
      setLastCloudSync(null);
      setCloudIssuesByDomain({});
    }
  }

  async function changeActivation(action: "deactivate" | "reactivate") {
    if (activationInFlight.current || !identity?.accessToken || identity.mode !== "authenticated") return;
    const owner = identity.userId; const token = identity.accessToken;
    if (activationState?.userId !== owner || !activationState.state.available) throw new Error("La desactivación necesita habilitarse en este entorno. Tu cuenta sigue sin cambios.");
    const key = `${owner}:${action}`;
    if (!activationKeys.current.has(key)) activationKeys.current.set(key, crypto.randomUUID());
    activationInFlight.current = true; setActivationBusy(true); setActivationError("");
    try {
      const state = await requestAccountActivation(token, action, activationKeys.current.get(key));
      if (activeUserId.current !== owner) return;
      setActivationState({ userId: owner, state }); activationKeys.current.delete(key);
      if (action === "deactivate") await logout();
      else { setAccountEntry(null); setProfileChecked(false); setAccountReloadRevision(value => value + 1); }
    } catch (error) {
      if (activeUserId.current === owner) { setActivationState(null); setActivationRetry(value => value + 1); setActivationError(error instanceof Error ? error.message : "No se confirmó el cambio."); }
      throw error;
    } finally { activationInFlight.current = false; setActivationBusy(false); }
  }

  async function purgeDeletedAccountLocal(deletedUserId: string, options: { clearAuth?: boolean; trackPending?: boolean } = {}) {
    const deletesActiveAccount = activeUserId.current === deletedUserId || ownsLocalWorkspace(localStorage, deletedUserId);
    const failedCleanupSteps: string[] = [];
    if (cloudProfileFallbackRef.current?.userId === deletedUserId) cloudProfileFallbackRef.current = null;
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
    try {
      const workspaceCleanup = discardAccountWorkspace(localStorage, deletedUserId);
      if (!workspaceCleanup.complete) failedCleanupSteps.push(...workspaceCleanup.failedSteps.map((step) => `local_${step}`));
    }
    catch { failedCleanupSteps.push("local_workspace"); }
    try { discardAccountSessionState(sessionStorage, deletedUserId); }
    catch { failedCleanupSteps.push("round_wizard_session"); }
    try { clearAccountDeletionIntent(localStorage, deletedUserId); }
    catch { failedCleanupSteps.push("deletion_intent"); }
    const storedAcceptances = parseLegalAcceptances(localStorage.getItem(ACCOUNT_STORAGE_KEYS.acceptances));
    const remainingAcceptances = clearLegalAcceptancesForUser(storedAcceptances, deletedUserId);
    try { localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(remainingAcceptances)); }
    catch { failedCleanupSteps.push("legal_acceptances"); }
    setAcceptances(remainingAcceptances);
    try {
      for (const environment of ["production", "preview", "development", "test"] as const) {
        localStorage.removeItem(legalEvidenceStateKey(`account:${deletedUserId}`, environment));
      }
      if (legalEvidenceState?.actorKey === `account:${deletedUserId}`) setLegalEvidenceState(null);
    } catch { failedCleanupSteps.push("legal_evidence"); }
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
    if (!userId || deletionRecoveryBusy || deletionRecoveryInFlight.current) return;
    if (!navigator.onLine) {
      setDeletionRecoveryError("Conéctate a internet para comprobar y terminar la eliminación.");
      return;
    }
    const markerKey = accountDeletionMarkerKey(userId);
    deletionRecoveryInFlight.current = true;
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
      deletionRecoveryInFlight.current = false;
      setDeletionRecoveryBusy(false);
    }
  }

  async function keepAccountAfterFailedDeletion() {
    const session = pendingDeletionSession;
    if (!session || !pendingDeletionAccountActive || deletionRecoveryBusy || deletionRecoveryInFlight.current) return;
    if (!navigator.onLine) {
      setDeletionRecoveryError("Conéctate a internet para comprobar que tu cuenta sigue activa.");
      return;
    }
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setDeletionRecoveryError("No pudimos comprobar el estado de tu cuenta. Reintenta más tarde.");
      return;
    }
    deletionRecoveryInFlight.current = true;
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
      deletionRecoveryInFlight.current = false;
      setDeletionRecoveryBusy(false);
    }
  }

  async function closePendingDeletionSession() {
    const session = pendingDeletionSession;
    if (!session || deletionRecoveryInFlight.current) {
      if (!session) { setPendingDeletionOwner(""); setDeletionRecoveryError(""); }
      return;
    }
    deletionRecoveryInFlight.current = true;
    setDeletionRecoveryBusy(true);
    setDeletionRecoveryError("");
    const supabase = getSupabaseBrowser();
    try { if (supabase) await clearDeletedAuthSessionForUser(supabase.auth, session.user.id); }
    catch {
      setDeletionRecoveryError("No pudimos cerrar de forma segura la sesión eliminada. Reintenta.");
      return;
    } finally {
      deletionRecoveryInFlight.current = false;
      setDeletionRecoveryBusy(false);
    }
    setPendingDeletionSession(null);
    setPendingDeletionOwner("");
    setDeletionRecoveryError("");
  }

  async function retryPendingLocalDeletionCleanup() {
    const userId = pendingLocalDeletionOwner;
    if (!userId || deletionRecoveryBusy || deletionRecoveryInFlight.current) return;
    const markerKey = accountDeletionMarkerKey(userId);
    const markerState = localStorage.getItem(markerKey) || "cleanup_pending";
    const serverConfirmed = markerState === "completed_cleanup_pending" || markerState === "completed";
    deletionRecoveryInFlight.current = true;
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
      deletionRecoveryInFlight.current = false;
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
        // A manual retry is a queue trigger in its own right; it must not
        // depend on Supabase rotating the token or emitting an auth event.
        setLegalRetryRevision(value => value + 1);
        setAccountReloadRevision(value => value + 1);
        window.setTimeout(() => window.dispatchEvent(new Event("backyard-sync-retry")), 0);
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
  const adminAccess = identity?.mode === "authenticated" && adminAccessState.userId === identity.userId ? adminAccessState.access : NO_ADMIN_ACCESS;
  const context = identity ? ({ identity, adminAccess, updateProfile, logout, finishAccountDeletion, deactivateAccount: () => changeActivation("deactivate"), deactivationAvailable: activeAccountConfirmed && activationState?.state.available === true, openAccess: () => setAccessRequested(true), acceptances, legalEvidenceEvents, legalEvidenceResolved, marketingConsentResolved, bettingConsentGranted, bettingConsentResolved, requestBettingConsent, recordLegalChoice, cloudLinked, cloudStatus: effectiveCloudStatus, setCloudStatus, lastCloudSync, cloudIssues, applyCloudPreferences,
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
    ? <BettingConsentDialog onDismiss={() => closeBettingConsent(false)} onReject={rejectBettingConsent} onAccept={acceptBettingConsent} />
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
  // Older local guest workspaces remain available for an explicit import after
  // sign-in, but never bypass the approved authenticated entry screen.
  if (!identity || Boolean(identity.mode === "guest") || accessRequested) return <AccessScreen sessionError={accountCloudError} onAuthenticated={(session) => { activateSession(session); setAccessRequested(false); }} />;
  if (identity.mode === "authenticated" && identity.accessToken && (!activationState || activationState.userId !== identity.userId)) return <main className="accessScreen"><section className="accessCard"><BrandLockup compact /><h1>Verificando tu cuenta…</h1>{activationError && <><p role="alert">{activationError}</p><button className="primary" onClick={() => { setActivationError(""); setActivationRetry(value => value + 1); }}>Reintentar</button><button className="secondary" onClick={logout}>Cerrar sesión</button></>}</section></main>;
  if (identity.mode === "authenticated" && activationState?.userId === identity.userId && activationState.state.status === "deactivated") return <main className="accessScreen"><section className="accessCard"><BrandLockup compact /><h1>Tu cuenta está desactivada</h1><p>Puedes reactivarla mientras los datos conservados sigan disponibles conforme a la política de retención.</p>{activationError && <p role="alert">{activationError}</p>}<button className="primary big" disabled={activationBusy} onClick={() => void changeActivation("reactivate").catch(() => {})}>{activationBusy ? "Reactivando…" : "Reactivar mi cuenta"}</button><button className="secondary" disabled={activationBusy} onClick={logout}>Cancelar / salir</button></section></main>;
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
  if (identity.mode === "authenticated" && !betaOnboardingRequired && optionalAuthorizationCheck !== "ready") return <main className="accessScreen"><section className="accessCard" aria-labelledby="optional-authorization-check-title">
    <BrandLockup compact />
    <h1 id="optional-authorization-check-title">Verificando tus autorizaciones opcionales…</h1>
    {optionalAuthorizationCheck === "error" && <><p role="alert">No pudimos consultar el registro canónico. Reintenta antes de continuar.</p><button type="button" className="primary big" onClick={() => { setOptionalAuthorizationCheck("pending"); setAccountReloadRevision((value) => value + 1); }}>Reintentar</button><button type="button" className="textButton" onClick={logout}>Cerrar sesión</button></>}
  </section></main>;
  if (identity.mode === "authenticated" && !betaOnboardingRequired && optionalAuthorizationRequired && currentConsent) return <main className="accessScreen"><section className="accessCard"><h1>Permisos y privacidad</h1><OnboardingPrivacyChoices key={identity.userId} userId={identity.userId} accessToken={identity.accessToken} onContinue={() => { setOptionalAuthorizationRequired(false); setAccountReloadRevision(value => value + 1); }} /></section></main>;
  if (identity.mode === "authenticated" && !betaOnboardingRequired && optionalAuthorizationRequired) return <main className="accessScreen"><InitialOnboardingConsents requiredOnly
    userId={identity.userId}
    accessToken={identity.accessToken}
    legalRequired={!currentConsent}
    canContinue
    onAcceptRequired={() => acceptRequiredConsents(true)}
    onContinue={() => { setOptionalAuthorizationRequired(false); setAccountReloadRevision((value) => value + 1); }}
  /></main>;
  if (identity.mode === "authenticated" && betaOnboardingRequired) return <AccountContext.Provider value={context!}>
    <BetaOnboardingFlow profile={identity} accessToken={identity.accessToken} onUpdateProfile={async (profile) => (await updateProfile(profile)) === "local" ? "local" : "cloud"} legalConsentRequired={!currentConsent} onAcceptRequiredConsents={() => acceptRequiredConsents(true)} onComplete={finishBetaOnboarding} />
    {bettingConsentDialog}
    <FeedbackDialog key={`feedback:onboarding:${identity.userId}`} token={identity.accessToken} email={identity.email} screen="onboarding" />
  </AccountContext.Provider>;
  if (identity.mode === "authenticated" && equipmentOnboardingRequired) return <><CanonicalEquipmentOnboarding identity={identity} onComplete={finishEquipmentOnboarding} /><FeedbackDialog key={`feedback:equipment-onboarding:${identity.userId}`} token={identity.accessToken} email={identity.email} screen="equipment-onboarding" /></>;

  const app = <AccountContext.Provider value={context!}>
    {existingAccountNotice && <div className="notice" role="status">Ya tienes una cuenta. Vamos a iniciar sesión.<button type="button" className="textButton" aria-label="Cerrar aviso de cuenta existente" onClick={() => setExistingAccountNotice(false)}>Entendido</button></div>}
    {blockingCloudIssues.map((issue) => <div className="notice bad" role="alert" key={issue.domain}>{issue.message}<button onClick={() => setAccessRequested(true)}>Volver a iniciar sesión</button></div>)}
    <Fragment key={identity.userId}>{children}</Fragment>
    {migrationDialog}
    {bettingConsentDialog}
  </AccountContext.Provider>;
  return app;
}
