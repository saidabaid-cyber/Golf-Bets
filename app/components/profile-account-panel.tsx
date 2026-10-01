"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useViewScrollReset } from "./use-view-scroll-reset";

import { LEGAL_DOCUMENT_VERSIONS, legalConfig } from "../../lib/legal-config";
import { accountDeletionMarkerKey, profileHandicapLabel, validateProfileAvatarUrl, validateProfileDraft, type BackyardProfileDetails } from "../../lib/account-state";
import { accountDeletionPrewriteRejected, accountDeletionRequestBody, accountDeletionResponseConfirmed, clearAccountDeletionIntent, prepareAccountDeletionIntent, settleAccountDeletionClient, type AccountDeletionIntent } from "../../lib/account-deletion-client";
import { ballFitDefaultsFromProfile } from "../../lib/ball-fitting";
import type { GolfInsights } from "../../lib/golf-insights";
import { isStatisticsDeleteConfirmation, requestStatisticsReset, type StatisticsResetRecord } from "../../lib/statistics-reset";
import { EquipmentProfilePanel, EquipmentProfileSummary } from "./equipment-profile-panel";
import { HandicapSourceChoices } from "./handicap-source-selector";
import { selectedHandicapIndex } from "../../lib/handicap-source";
import { LegalConsentManager } from "./legal-consent-manager";
import { AiProcessingConsentSettings } from "./backyard-ai/ai-processing-consent";
import { AccountDataDialog, StatisticsResetDialog, type AccountDataPolicy } from "./profile-data-dialogs";
import { BackyardIndexCard } from "./backyard-index-card";
import type { BackyardIndexPreferenceController } from "./use-backyard-index-preference";
import type { GhinReadOnlyProfileController } from "./use-ghin-read-only-profile";
import type { RoundSnapshot } from "../../lib/types";
import { CatalogCoursePicker } from "./catalog-course-picker";
import { ProfileImagePicker } from "./profile-image-picker";
import { ProfileLocationPicker } from "./profile-location-picker";
import { normalizeProfileLocation, validateProfileLocation } from "../../lib/profile-geography";
import { useBackyardAccount } from "./account-provider";
import { ProfileVisibilitySettings } from "./profile-visibility-settings";
import { ProfileCompletionRing } from "./profile-completion-ring";
import { ACCOUNT_SETTINGS, type AccountSettingsSection } from "../../lib/account-settings";
import { DEFAULT_ACCOUNT_UI_PREFERENCES, displayDistanceFromStoredYards, readAccountUiPreferences, writeAccountUiPreferences, type AccountUiPreferences } from "../../lib/account-ui-preferences";
import { bootstrapAccountNotificationPreferences, requestAccountNotificationPreferences, type NotificationDeliveryCapability } from "../../lib/account-notification-preferences";
import { SocialSharingPreferences } from './cloud-social-activity';
import { checkProfileUsernameAvailability, normalizeProfileUsername } from "../../lib/profile-username";
import { DevicePermissionSettings } from "./device-permission-settings";
import type { CompletionSection } from "../../lib/profile-completion";
import { requestFeedback } from "./feedback-dialog";
import { BottomBackAction } from "./bottom-back-action";

type ProfileAccountPanelProps = {
  initialLaunchMonitor?: boolean;
  view: "profile" | "account";
  rootNavigationKey?: number;
  openAiPrivacySettings?: boolean;
  onAiPrivacyOpened?: () => void;
  history?: RoundSnapshot[];
  indexControl: BackyardIndexPreferenceController;
  ghinControl?: GhinReadOnlyProfileController;
  focusSection?: "profile" | "equipment";
  completionTarget?: CompletionSection | null;
  onCompletionTargetHandled?: () => void;
  highContrast: boolean;
  onHighContrastChange: (value: boolean) => void;
  notificationsEnabled: boolean;
  onNotificationsEnabledChange: (value: boolean) => void | Promise<boolean>;
  internalNotificationsSaving?: boolean;
  internalNotificationsMessage?: string;
  golfInsights?: GolfInsights;
  statisticsResetAt?: string | null;
  onStatisticsReset?: (reset: StatisticsResetRecord) => void;
  onOpenStats?: () => void;
  onOpenAccount?: () => void;
  initialAccountSection?: AccountSettingsSection;
  onOpenAccountSection?: (section: AccountSettingsSection) => void;
  onOpenPrivacy?: () => void;
  onOpenEquipment: () => void;
  onBackToProfile: () => void;
  onPageBack?: () => void;
};

type EditDraft = Pick<BackyardProfileDetails, "givenName" | "familyName" | "username" | "homeClub" | "homeClubId" | "homeCourse" | "homeCourseId" | "preferredTee" | "handedness" | "countryCode" | "country" | "stateCode" | "state">;

function draftFromIdentity(identity: ReturnType<typeof useBackyardAccount>["identity"]): EditDraft {
  return {
    givenName: identity.givenName || "",
    familyName: identity.familyName || "",
    username: identity.username || "",
    handedness: identity.handedness || "",
    ...normalizeProfileLocation(identity),
    homeClub: identity.homeClub || "",
    homeClubId: identity.homeClubId || "",
    homeCourse: identity.homeCourse || "",
    homeCourseId: identity.homeCourseId || "",
    preferredTee: identity.preferredTee || "",
  };
}

function decimal(value: number | undefined) {
  return value === undefined ? "—" : value.toFixed(1);
}

export function ProfileAccountPanel({ initialLaunchMonitor = false, view, rootNavigationKey = 0, openAiPrivacySettings = false, onAiPrivacyOpened, history = [], indexControl, ghinControl, focusSection = "profile", completionTarget, onCompletionTargetHandled, highContrast, onHighContrastChange, notificationsEnabled, onNotificationsEnabledChange, internalNotificationsSaving = false, internalNotificationsMessage = "", golfInsights, statisticsResetAt, onStatisticsReset, onOpenStats, onOpenAccount, initialAccountSection = "account", onOpenAccountSection, onOpenPrivacy, onOpenEquipment, onBackToProfile, onPageBack }: ProfileAccountPanelProps) {
  const { identity, adminAccess = { hasAccess: false, roles: [], scopes: [] }, updateProfile, logout, finishAccountDeletion, openAccess, acceptances, legalEvidenceEvents, marketingConsentResolved, bettingConsentGranted, requestBettingConsent, recordLegalChoice, cloudLinked, cloudStatus, requestCloudLink, cloudIssues, retryCloudSync } = useBackyardAccount();
  const [editing, setEditing] = useState(false);
  const [accountSection, setAccountSection] = useState<AccountSettingsSection>(initialAccountSection);
  const [uiPreferences, setUiPreferences] = useState<AccountUiPreferences>(DEFAULT_ACCOUNT_UI_PREFERENCES);
  const [preferenceMessage, setPreferenceMessage] = useState("");
  const [notificationPreferenceSaving, setNotificationPreferenceSaving] = useState(false);
  const [notificationPreferencesReady, setNotificationPreferencesReady] = useState(false);
  const [notificationDelivery, setNotificationDelivery] = useState<{ push: NotificationDeliveryCapability; email: NotificationDeliveryCapability }>({
    push: { configured: false, state: "not_configured" },
    email: { configured: false, state: "not_configured" },
  });
  const notificationPreferenceRevision = useRef(0);
  useViewScrollReset(`${view}:${accountSection}`);
  const [completionEquipment, setCompletionEquipment] = useState<"equipment" | "ball" | "fitting">("equipment");
  const [completionEditTarget, setCompletionEditTarget] = useState<string | null>(null);
  const [equipmentFlowNested, setEquipmentFlowNested] = useState(false);
  useEffect(() => {
    if (editing && completionEditTarget) document.getElementById(`profile-edit-${completionEditTarget}`)?.scrollIntoView({ block: "start" });
  }, [editing, completionEditTarget]);
  const [name, setName] = useState(identity.displayName);
  const [avatarUrl, setAvatarUrl] = useState(identity.avatarUrl);
  const [draft, setDraft] = useState<EditDraft>(() => draftFromIdentity(identity));
  const [homeClubSelectionReady, setHomeClubSelectionReady] = useState(Boolean(identity.homeClubId && identity.homeCourseId));
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [managingConsents, setManagingConsents] = useState(false);
  const [managingAiConsents, setManagingAiConsents] = useState(view === "account" && openAiPrivacySettings);
  useViewScrollReset(`${view}:${focusSection}:${rootNavigationKey}:${editing}:${managingConsents}:${managingAiConsents}`, undefined, !completionEditTarget);
  const [deleteStatsOpen, setDeleteStatsOpen] = useState(false);
  const [deleteStatsText, setDeleteStatsText] = useState("");
  const [deletingStatistics, setDeletingStatistics] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountText, setDeleteAccountText] = useState("");
  const [deleteAccountPolicy, setDeleteAccountPolicy] = useState<AccountDataPolicy | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const statsInFlight = useRef(false);
  const profileSaveInFlight = useRef(false);
  const statsRequestId = useRef<string | undefined>(undefined);
  const accountInFlight = useRef(false);
  const accountRequestId = useRef<string | undefined>(undefined);
  const [destructiveError, setDestructiveError] = useState("");
  const seenRootNavigation = useRef(rootNavigationKey);
  const liveOwner = useRef(identity.userId);
  const mounted = useRef(true);
  useLayoutEffect(() => { liveOwner.current = identity.userId; }, [identity.userId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const local = readAccountUiPreferences(localStorage, identity.userId);
    setUiPreferences(local);
    setPreferenceMessage("");
    if (view !== "account" || identity.mode !== "authenticated" || !identity.accessToken) {
      setNotificationPreferencesReady(true);
      return;
    }
    setNotificationPreferencesReady(false);
    const revision = ++notificationPreferenceRevision.current;
    const controller = new AbortController();
    void bootstrapAccountNotificationPreferences(identity.accessToken, {
      push: local.push,
      email: local.email,
      rounds: local.rounds,
      reminders: local.reminders,
    }, controller.signal)
      .then((remote) => {
        if (controller.signal.aborted || revision !== notificationPreferenceRevision.current) return;
        const confirmed = writeAccountUiPreferences(localStorage, identity.userId, {
          ...local,
          push: remote.preferences.push,
          email: remote.preferences.email,
          rounds: remote.preferences.rounds,
          reminders: remote.preferences.reminders,
        });
        setUiPreferences(confirmed);
        setNotificationDelivery(remote.delivery);
        setNotificationPreferencesReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted && revision === notificationPreferenceRevision.current) {
          setPreferenceMessage("No pudimos consultar las preferencias de cuenta. Mostramos la última copia guardada en este dispositivo.");
          setNotificationPreferencesReady(true);
        }
      });
    return () => { controller.abort(); notificationPreferenceRevision.current = revision + 1; };
  }, [identity.accessToken, identity.mode, identity.userId, view]);
  useEffect(() => {
    if (seenRootNavigation.current === rootNavigationKey || saving || deletingStatistics || deletingAccount) return;
    seenRootNavigation.current = rootNavigationKey;
    setEditing(false); setManagingConsents(false); setManagingAiConsents(false); setDeleteStatsOpen(false); setDeleteAccountOpen(false); setDestructiveError("");
  }, [rootNavigationKey, saving, deletingStatistics, deletingAccount]);

  useEffect(() => {
    if (view !== "account" || !openAiPrivacySettings) return;
    setManagingAiConsents(true);
    onAiPrivacyOpened?.();
  }, [openAiPrivacySettings, onAiPrivacyOpened, view]);

  useEffect(() => {
    if (editing) return;
    setName(identity.displayName);
    setAvatarUrl(identity.avatarUrl);
    setDraft(draftFromIdentity(identity));
    setHomeClubSelectionReady(Boolean(identity.homeClubId && identity.homeCourseId));
  }, [editing, identity]);

  function openProfileEditor(target: string | null = null) {
    setName(identity.displayName);
    setAvatarUrl(identity.avatarUrl);
    setDraft(draftFromIdentity(identity));
    setHomeClubSelectionReady(Boolean(identity.homeClubId && identity.homeCourseId));
    setCompletionEditTarget(target);
    setEditing(true);
  }

  function openEquipmentRoot() {
    setCompletionEquipment("equipment");
    setEquipmentFlowNested(false);
    onOpenEquipment();
  }

  function focusProfileIndexControl() {
    setCompletionEditTarget(null);
    setEditing(false);
    window.requestAnimationFrame(() => document.getElementById("profile-index-source")?.scrollIntoView({ block: "start" }));
  }

  useEffect(() => {
    if (view !== "profile" || !completionTarget) return;
    if (completionTarget === "equipment" || completionTarget === "ball" || completionTarget === "fitting") {
      setCompletionEquipment(completionTarget);
      onCompletionTargetHandled?.();
      return;
    }
    if (focusSection !== "profile") return;
    if (completionTarget === "handicap") {
      focusProfileIndexControl();
      onCompletionTargetHandled?.();
      return;
    }
    setName(identity.displayName);
    setAvatarUrl(identity.avatarUrl);
    setDraft(draftFromIdentity(identity));
    setHomeClubSelectionReady(Boolean(identity.homeClubId && identity.homeCourseId));
    setCompletionEditTarget(completionTarget);
    setEditing(true);
    onCompletionTargetHandled?.();
  }, [completionTarget, focusSection, identity, onCompletionTargetHandled, view]);

  const notice = message ? <div className={messageKind === "error" ? "notice bad" : "notice"} role={messageKind === "error" ? "alert" : "status"}>{message}</div> : null;
  const selectedIndex = selectedHandicapIndex(indexControl.preference, history, identity.userId, ghinControl?.profile ?? null);
  const ghinLinked = ghinControl?.profile?.associationStatus === "VERIFIED";
  const indexLabel = selectedIndex.source === "BACKYARD" ? "BACKYARD INDEX" : selectedIndex.source === "GHIN" ? "GHIN INDEX" : "HANDICAP / ÍNDICE";
  const homeClubSelectionIncomplete = Boolean((draft.homeClubId || draft.homeCourseId) && (!draft.homeClubId || !draft.homeCourseId || !homeClubSelectionReady));
  const profileEditorDirty = editing && (
    name !== identity.displayName
    || avatarUrl !== identity.avatarUrl
    || JSON.stringify(draft) !== JSON.stringify(draftFromIdentity(identity))
  );

  function closeProfileEditor() {
    if (saving || avatarBusy) return;
    if (profileEditorDirty && !window.confirm("Tienes cambios sin guardar. ¿Salir sin guardarlos?")) return;
    setEditing(false);
    setCompletionEditTarget(null);
  }

  function closeAiConsentSettings() {
    setManagingAiConsents(false);
  }

  function closeLegalConsentSettings() {
    setManagingConsents(false);
  }

  function changeUiPreferences(patch: Partial<AccountUiPreferences>) {
    if (notificationPreferenceSaving) return;
    const previous = uiPreferences;
    const next = { ...uiPreferences, ...patch, version: 1 as const };
    try {
      writeAccountUiPreferences(localStorage, identity.userId, next);
      setUiPreferences(next);
      const accountPreferenceChanged = ["push", "email", "rounds", "reminders"].some((key) => Object.hasOwn(patch, key));
      if (!accountPreferenceChanged) {
        setPreferenceMessage("Preferencia guardada en este dispositivo.");
        return;
      }
      if (identity.mode !== "authenticated" || !identity.accessToken) {
        setPreferenceMessage("Preferencia guardada en este dispositivo. Inicia sesión para sincronizarla con tu cuenta.");
        return;
      }
      const revision = ++notificationPreferenceRevision.current;
      setNotificationPreferenceSaving(true);
      setPreferenceMessage("Guardando preferencia de cuenta…");
      void requestAccountNotificationPreferences(identity.accessToken, {
        push: next.push,
        email: next.email,
        rounds: next.rounds,
        reminders: next.reminders,
      }).then((remote) => {
        if (revision !== notificationPreferenceRevision.current) return;
        const confirmed = writeAccountUiPreferences(localStorage, identity.userId, { ...next, ...remote.preferences, version: 1 });
        setUiPreferences(confirmed);
        setNotificationDelivery(remote.delivery);
        setPreferenceMessage("Preferencias guardadas en tu cuenta.");
      }).catch(() => {
        if (revision !== notificationPreferenceRevision.current) return;
        writeAccountUiPreferences(localStorage, identity.userId, previous);
        setUiPreferences(previous);
        setPreferenceMessage("No pudimos confirmar el cambio. Conservamos tu selección anterior.");
      }).finally(() => {
        if (revision === notificationPreferenceRevision.current) setNotificationPreferenceSaving(false);
      });
    } catch {
      setPreferenceMessage("No pudimos guardar esta preferencia en el dispositivo.");
    }
  }

  async function saveProfile() {
    if (avatarBusy || saving || profileSaveInFlight.current) return;
    if (homeClubSelectionIncomplete) {
      setMessageKind("error"); setMessage("Selecciona el recorrido de tu Home Club antes de guardar."); return;
    }
    const validated = validateProfileDraft(name, "");
    if (!validated.ok) { setMessageKind("error"); setMessage(validated.message); return; }
    const avatar = validateProfileAvatarUrl(avatarUrl);
    if (!avatar.ok) { setMessageKind("error"); setMessage(avatar.message); return; }
    const locationValidation = validateProfileLocation(draft);
    if (!locationValidation.valid) { setMessageKind("error"); setMessage(locationValidation.errors.country || locationValidation.errors.state || "Revisa tu país y región."); return; }
    profileSaveInFlight.current = true; setSaving(true); setMessage("");
    try {
      const nextUsername = normalizeProfileUsername(draft.username);
      const currentUsername = normalizeProfileUsername(identity.username);
      if (nextUsername && nextUsername !== currentUsername && !(await checkProfileUsernameAvailability(identity.accessToken, nextUsername))) {
        setMessageKind("error"); setMessage("Ese nombre de usuario ya está en uso."); return;
      }
      const result = await updateProfile({ displayName: validated.displayName, defaultHandicap: validated.defaultHandicap, avatarUrl: avatar.avatarUrl, ...draft });
      setMessageKind("success");
      setMessage(result === "cloud" ? "Perfil guardado y sincronizado." : result === "cloud_pending" ? "Perfil guardado · sincronizando avatar…" : "Perfil guardado en este dispositivo. Sincronización pendiente.");
      setEditing(false);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error && error.message === "Ese nombre de usuario ya está en uso."
        ? error.message
        : "No se confirmó el guardado. Conservamos lo que escribiste; reintenta.");
    }
    finally { profileSaveInFlight.current = false; setSaving(false); }
  }

  async function deleteStatistics() {
    if (statsInFlight.current || identity.mode !== "authenticated" || !isStatisticsDeleteConfirmation(deleteStatsText)) return;
    statsInFlight.current = true;
    statsRequestId.current ??= crypto.randomUUID();
    setDeletingStatistics(true); setMessage(""); setDestructiveError("");
    try {
      const reset = await requestStatisticsReset(identity.accessToken, deleteStatsText, fetch, statsRequestId.current);
      if (!mounted.current || liveOwner.current !== identity.userId) return;
      onStatisticsReset?.(reset);
      setDeleteStatsOpen(false); setDeleteStatsText("");
      statsRequestId.current = undefined;
      setMessageKind("success"); setMessage("Tus estadísticas se reiniciaron. Tu cuenta, grupos y rondas históricas siguen disponibles.");
    } catch (error) {
      if (mounted.current && liveOwner.current === identity.userId) setDestructiveError(error instanceof Error ? error.message : "No se eliminaron las estadísticas. Reintenta.");
    } finally { statsInFlight.current = false; if (mounted.current && liveOwner.current === identity.userId) setDeletingStatistics(false); }
  }

  async function deleteAccount() {
    if (accountInFlight.current || identity.mode !== "authenticated" || deleteAccountText !== "ELIMINAR" || !deleteAccountPolicy) return;
    if (!identity.accessToken) {
      setMessageKind("error");
      setMessage("Tu sesión terminó. Vuelve a iniciar sesión antes de eliminar la cuenta.");
      setDestructiveError("No se inició ninguna eliminación porque falta una sesión autenticada.");
      return;
    }
    if (cloudStatus === "syncing" || cloudStatus === "saving") { setMessageKind("error"); setMessage("Espera a que termine el guardado actual."); return; }
    accountInFlight.current = true;
    accountRequestId.current ??= crypto.randomUUID();
    setDeletingAccount(true); setMessage(""); setDestructiveError("");
    const marker = accountDeletionMarkerKey(identity.userId);
    let intent: AccountDeletionIntent;
    try {
      intent = prepareAccountDeletionIntent(localStorage, identity.userId, deleteAccountPolicy, accountRequestId.current);
      const requestedAt = new Date().toISOString();
      localStorage.setItem(marker, requestedAt);
      if (localStorage.getItem(marker) !== requestedAt) throw new Error("deletion_marker_not_persisted");
    } catch {
      setMessageKind("error");
      setMessage("No pudimos preparar la eliminación de forma segura en este dispositivo. Revisa el almacenamiento del navegador y reintenta.");
      setDeletingAccount(false);
      accountInFlight.current = false;
      setDestructiveError("No pudimos preparar la acción de forma segura. Revisa el almacenamiento del navegador y reintenta.");
      return;
    }
    let responseStatus: number | null = null;
    let serverDeletionConfirmed = false;
    let serverRejectionConfirmed = false;
    try {
      const response = await fetch("/api/account/delete", { method: "DELETE", headers: { authorization: `Bearer ${identity.accessToken}`, "content-type": "application/json" }, body: JSON.stringify(accountDeletionRequestBody(intent)), signal: AbortSignal.timeout(25_000), redirect: "error" });
      responseStatus = response.status;
      const result = await response.json().catch(() => null) as { error?: string; code?: string; noDataDeleted?: boolean } | null;
      serverDeletionConfirmed = response.ok && accountDeletionResponseConfirmed(result, intent.dataPolicy);
      if (!mounted.current || liveOwner.current !== identity.userId) {
        // Keep recovery proof for the original owner; never purge the workspace
        // of a different account through a stale provider callback.
        localStorage.setItem(marker, serverDeletionConfirmed ? "completed_cleanup_pending" : "pending_confirmation");
        return;
      }
      if (!response.ok) {
        serverRejectionConfirmed = accountDeletionPrewriteRejected(response.status, result);
        throw new Error(result?.error || "No se completó la eliminación en el servidor.");
      }
      if (!serverDeletionConfirmed) { responseStatus = null; throw new Error("El servidor no confirmó el cierre. Reintenta la misma solicitud."); }
      await settleAccountDeletionClient(localStorage, marker, responseStatus, serverDeletionConfirmed, finishAccountDeletion);
    } catch (error) {
      if (!mounted.current || liveOwner.current !== identity.userId) {
        if (!serverDeletionConfirmed) localStorage.setItem(marker, "pending_confirmation");
        return;
      }
      if (serverDeletionConfirmed) {
        // The confirmed cleanup already ran (or failed) once. Its durable
        // marker lets reload resume; retrying here could purge twice.
        setMessageKind("error");
        setMessage("El servidor confirmó la eliminación, pero falta limpiar este dispositivo. Recarga para reintentar la limpieza.");
        setDeleteAccountOpen(false);
        return;
      }
      try {
        const outcome = await settleAccountDeletionClient(localStorage, marker, serverRejectionConfirmed ? 400 : responseStatus, serverDeletionConfirmed, finishAccountDeletion);
        if (outcome === "rejected") { clearAccountDeletionIntent(localStorage, identity.userId); accountRequestId.current = undefined; }
        setMessageKind("error");
        setMessage(outcome === "pending_confirmation"
          ? `${responseStatus !== null && error instanceof Error ? `${error.message} ` : "No pudimos confirmar la eliminación. "}Conservamos tus datos en este dispositivo y pausamos la sincronización. Al recargar podrás reintentar o comprobar que tu cuenta sigue activa.`
          : error instanceof Error ? error.message : "No se completó la eliminación en el servidor. Reintenta.");
        if (outcome === "pending_confirmation") setDeleteAccountOpen(false);
      } catch {
        setMessageKind("error");
        setMessage("No pudimos confirmar la eliminación ni guardar el estado de recuperación. Conservamos tus datos; no cierres esta pestaña y contacta soporte.");
        setDeleteAccountOpen(false);
      }
      setDestructiveError(error instanceof Error ? error.message : "No pudimos confirmar la acción. Tus datos no se borraron localmente.");
    } finally { accountInFlight.current = false; if (mounted.current && liveOwner.current === identity.userId) setDeletingAccount(false); }
  }

  if (view === "account" && managingAiConsents) return <>
    <button type="button" className="secondary pageBack" onClick={closeAiConsentSettings}>← Cuenta y privacidad</button>
    <AiProcessingConsentSettings userId={identity.userId} accessToken={identity.accessToken} requiresRemoteConsent={identity.mode === "authenticated"} />
    <BottomBackAction label="← Cuenta y privacidad" onBack={closeAiConsentSettings} />
  </>;
  if (managingConsents) return <LegalConsentManager userId={identity.userId} accessToken={identity.accessToken} authenticated={identity.mode === "authenticated"} acceptances={acceptances} legalEvidenceEvents={legalEvidenceEvents} marketingConsentResolved={marketingConsentResolved} bettingConsentGranted={bettingConsentGranted} requestBettingConsent={requestBettingConsent} recordLegalChoice={recordLegalChoice} onBack={closeLegalConsentSettings} />;

  if (view === "profile" && identity.mode === "authenticated" && focusSection === "equipment") return <><header className="profileMobileHeader profileEditHeader">{!equipmentFlowNested && <button type="button" className="textButton" onClick={onBackToProfile}>← Mi Perfil</button>}<div><span>MI PERFIL</span><h1>Mi Bolsa</h1></div></header><div id="equipment-bag"><EquipmentProfilePanel initialLaunchMonitor={initialLaunchMonitor} userId={identity.userId} accessToken={identity.accessToken} defaultHandicap={selectedIndex.value} defaultHandicapSource={selectedIndex.source} defaultHandedness={identity.handedness} ballFitDefaults={ballFitDefaultsFromProfile(identity)} onBackToProfile={onBackToProfile} onOpenPrivacy={onOpenPrivacy} onFlowDepthChange={setEquipmentFlowNested} initialSection={completionTarget === "equipment" || completionTarget === "ball" || completionTarget === "fitting" ? completionTarget : completionEquipment} /></div>{!equipmentFlowNested && <BottomBackAction label="← Mi Perfil" onBack={onBackToProfile} />}</>;

  if (identity.mode === "authenticated" && editing) return <>
    <header className="profileMobileHeader profileEditHeader"><button type="button" className="textButton" disabled={saving || avatarBusy} onClick={closeProfileEditor}>{view === 'account' ? '← Cuenta' : '← Mi Perfil'}</button><div><span>MI PERFIL</span><h1>Editar perfil</h1></div></header>
    <section id="profile-edit-personal" className="card profileEditCard"><h2>Datos personales</h2><div className="profileEditGrid">
      <label>Nombre visible<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" /></label>
      <label>Nombre(s)<input value={draft.givenName} onChange={(event) => setDraft((current) => ({ ...current, givenName: event.target.value }))} autoComplete="given-name" /></label>
      <label>Apellidos<input value={draft.familyName} onChange={(event) => setDraft((current) => ({ ...current, familyName: event.target.value }))} autoComplete="family-name" /></label>
      <label id="profile-edit-username">Username<input value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value.replace(/^@+/, "") }))} placeholder="sin @" autoComplete="username" autoCorrect="off" autoCapitalize="none" spellCheck={false} inputMode="text" /></label>
    </div></section>
    <section className="card profileEditCard"><h2>Foto / Avatar</h2><ProfileImagePicker value={avatarUrl} onChange={setAvatarUrl} onBusyChange={setAvatarBusy} accessToken={identity.accessToken} userId={identity.userId} /><p className="hint">Quitarla en The Backyard no modifica tu foto de Google.</p></section>
    <section className="card profileEditCard"><h2>País y región</h2><ProfileLocationPicker value={draft} onChange={(location) => { setDraft((current) => ({ ...current, ...location })); setMessage(""); }} /><p className="hint">Estos datos de perfil no se publican automáticamente. No usamos GPS.</p></section>
    <section id="profile-edit-golf" className="card profileEditCard"><div className="sectionTitle"><div><h2>Información de golf</h2><p>Opcional</p></div></div><div className="profileEditGrid"><CatalogCoursePicker key={`profile-home-${identity.userId}`} purpose="home-club" token={identity.accessToken} permissionOwnerId={identity.userId} selectedName={[draft.homeClub,draft.homeCourse].filter(Boolean).join(" · ")} selectedClubId={draft.homeClubId} selectedCourseId={draft.homeCourseId} onSelectionReadyChange={setHomeClubSelectionReady} onSelectClub={({clubId,clubName}) => setDraft((current) => ({ ...current, homeClub:clubName, homeClubId:clubId, homeCourse:"", homeCourseId:"" }))} onSelectHomeCourse={selection => setDraft((current) => ({ ...current, homeClub:selection.clubName, homeClubId:selection.clubId, homeCourse:selection.courseName, homeCourseId:selection.courseId }))} onRequest={name => requestFeedback("COURSE", name ? { name } : undefined)} /><label>Tee habitual<input value={draft.preferredTee} onChange={(event) => setDraft((current) => ({ ...current, preferredTee: event.target.value }))} /></label><label>Mano dominante<select value={draft.handedness} onChange={(event) => setDraft((current) => ({ ...current, handedness: event.target.value as BackyardProfileDetails["handedness"] }))}><option value="">Selecciona una</option><option value="right">Derecha</option><option value="left">Izquierda</option><option value="ambidextrous">Ambas</option></select></label></div></section>
    {notice}<div className="profileEditActions"><button type="button" className="secondary" disabled={saving || avatarBusy} onClick={closeProfileEditor}>Cancelar</button><button type="button" className="primary" disabled={saving || avatarBusy || homeClubSelectionIncomplete} onClick={() => void saveProfile()}>{saving ? "Guardando…" : avatarBusy ? "Preparando imagen…" : "Guardar perfil"}</button></div>
    <BottomBackAction label={view === "account" ? "← Cuenta" : "← Mi Perfil"} onBack={closeProfileEditor} disabled={saving || avatarBusy} />
  </>;

  const userAcceptances = acceptances.filter((item) => item.userId === identity.userId);
  const accepted = (type: keyof typeof LEGAL_DOCUMENT_VERSIONS) => userAcceptances.some((item) => item.type === type) ? "Aceptado" : "Pendiente";

  return <>
    {view === "account" && onPageBack && <button type="button" className="secondary pageBack" onClick={onPageBack}>← Regresar</button>}
    <header className="profileMobileHeader"><div><span>{view === "profile" ? "MI PERFIL" : "MI CUENTA"}</span><h1>{view === "profile" ? "Mi Perfil" : "Cuenta y privacidad"}</h1></div></header>
    {view === "profile" && identity.mode === "guest" && <section className="card guestAccountCard"><h2>Tu golf permanece en este dispositivo</h2><p>Crea una cuenta o inicia sesión para tener un perfil persistente.</p><div className="accountInlineActions"><button className="primary" onClick={openAccess}>Crear cuenta</button><button className="secondary" onClick={openAccess}>Iniciar sesión</button></div></section>}
    {view === "profile" && identity.mode === "authenticated" && <main className="profileMobileStack">
      <section className="card profileOverviewCard"><div className="profileOverviewIdentity"><ProfileCompletionRing token={identity.accessToken} userId={identity.userId} avatar={identity.avatarUrl} name={identity.displayName} revision={JSON.stringify([identity, indexControl.preference])} onOpen={section => { if (section === "equipment" || section === "ball" || section === "fitting") { setCompletionEquipment(section); onOpenEquipment(); } else if (section === "handicap") focusProfileIndexControl(); else { openProfileEditor(section); } }} /><div><h2>{identity.displayName}</h2>{adminAccess.hasAccess && <span className="adminRoleBadge">{adminAccess.roles.includes("SUPER_ADMIN") ? "SUPER ADMIN" : "ADMINISTRADOR"}</span>}<p>{identity.username ? `@${identity.username}` : "Sin username"}</p><span>{indexLabel} <b>{profileHandicapLabel(selectedIndex.value)}</b></span></div></div><button type="button" className="primary profileEditButton" onClick={() => openProfileEditor()}>Editar perfil</button></section>
      <section className="card profileCompactCard"><div className="profileCompactHeading"><div><span>INFORMACIÓN DE GOLF</span><h2>Tu juego</h2></div></div><div className="profileCompactRows"><div><span>{indexLabel}</span><b>{profileHandicapLabel(selectedIndex.value)}</b></div><div><span>Home Club</span><b>{identity.homeClub || "Sin indicar"}</b></div><div><span>Recorrido</span><b>{identity.homeCourse || "Sin indicar"}</b></div><div><span>Tee habitual</span><b>{identity.preferredTee || "Sin indicar"}</b></div><div><span>Mano dominante</span><b>{identity.handedness === "right" ? "Derecha" : identity.handedness === "left" ? "Izquierda" : identity.handedness === "ambidextrous" ? "Ambas" : "Sin indicar"}</b></div></div><div id="profile-index-source"><HandicapSourceChoices control={indexControl} authenticated={identity.mode === "authenticated"} ghinControl={ghinControl} /></div></section>
      {!ghinLinked && <BackyardIndexCard history={history} userId={identity.userId} enabled={indexControl.preference?.enabled === true} onEnabledChange={indexControl.change} saving={indexControl.saving || !indexControl.ready} error={indexControl.error} localPccZeroDeclared={Boolean(indexControl.preference?.localPccZeroDeclaredAt)} onDeclareLocalPccZero={indexControl.declareLocalZero} />}
      {indexControl.error && <button type="button" className="textButton" onClick={() => void indexControl.retry()}>Reintentar sincronización del Índice</button>}
      <EquipmentProfileSummary userId={identity.userId} accessToken={identity.accessToken} onOpen={openEquipmentRoot} />
      {golfInsights && <section className="card profileCompactCard"><div className="profileCompactHeading"><div><span>ACTIVIDAD</span><h2>Resumen personal</h2></div>{onOpenStats && <button type="button" className="textButton" onClick={onOpenStats}>Ver Stats</button>}</div><div className="profileActivityGrid"><div><span>Rondas</span><b>{golfInsights.rounds}</b></div><div><span>Promedio</span><b>{decimal(golfInsights.averageScore)}</b></div><div><span>Putts</span><b>{decimal(golfInsights.averagePutts)}</b></div></div></section>}
      <nav className="card profileNavigationList" aria-label="Secciones de Mi Perfil">
        <button type="button" className="profileNavigationCard" onClick={() => { if (onOpenAccountSection) onOpenAccountSection("preferences"); else onOpenAccount?.(); }}><span><b>Configuración</b><small>Preferencias, cuenta, notificaciones, privacidad y permisos</small></span><strong aria-hidden="true">›</strong></button>
      </nav>{notice}
    </main>}

    {view === "account" && identity.mode === "guest" && <section className="card guestAccountCard"><h2>Modo invitado</h2><p>Inicia sesión para administrar datos de una cuenta.</p><div className="accountInlineActions"><button className="primary" onClick={openAccess}>Crear cuenta</button><button className="secondary" onClick={openAccess}>Iniciar sesión</button></div></section>}
    {view === "account" && identity.mode === "authenticated" && <section className="card cloudAccountStatus accountCloudCompact" aria-label="Estado de la cuenta"><div><h2>{cloudIssues.some((issue) => issue.kind === "session_expired") ? "Sesión por renovar" : "Cuenta conectada"}</h2><p role="status">{cloudStatus === "synced" ? "Guardado en la nube ✓" : cloudStatus === "syncing" ? "Sincronizando…" : cloudStatus === "saving" ? "Guardando…" : cloudStatus === "offline" ? "Sin conexión" : cloudStatus === "error" ? "Error de sincronización" : cloudLinked ? "Pendiente de sincronizar" : "Nube sin vincular"}</p></div>{cloudLinked ? <button className="textButton" onClick={() => void retryCloudSync()}>Reintentar</button> : <button className="textButton" onClick={requestCloudLink}>Vincular</button>}</section>}
    {view === "account" && <>
      {adminAccess.hasAccess && <a className="secondary" href="/admin" aria-label="Abrir Administración">Administración</a>}<nav className="accountSettingsNav" aria-label="Secciones de configuración">{ACCOUNT_SETTINGS.map(section => <button type="button" className="secondary" key={section.id} aria-current={accountSection === section.id ? "page" : undefined} onClick={() => setAccountSection(section.id)}>{section.label}</button>)}</nav>
      {accountSection === "account" && <div data-settings-section="account">
      <section className="card accountCompactCard"><h2>Cuenta</h2><div className="accountCompactRows"><div><span>Email</span><b>{identity.email || "Sin email"}</b></div><div><span>Métodos de acceso</span><b>{identity.mode === "authenticated" ? identity.providers.map((provider) => provider === "google" ? "Google" : provider === "email" ? "Correo" : provider).join(" · ") || "Correo" : "Modo invitado"}</b></div></div><button type="button" className="textButton" onClick={() => openProfileEditor("personal")}>Editar nombre y usuario</button></section>
      </div>}
      {accountSection === "preferences" && <div data-settings-section="preferences">
      <section className="card accountCompactCard"><h2>Preferencias</h2>
        <h3>Apariencia</h3><label className="accountSettingRow"><span><b>Alto contraste</b><small>Está activo por defecto; si lo cambias, respetaremos tu elección.</small></span><input type="checkbox" checked={highContrast} onChange={event => onHighContrastChange(event.target.checked)} /></label>
        <label className="accountSettingRow"><span><b>Unidades</b><small>La conversión cambia sólo la presentación; nunca modifica rondas históricas. Ejemplo: {displayDistanceFromStoredYards(100, uiPreferences.distanceUnit)}.</small></span><select aria-label="Unidades de distancia" value={uiPreferences.distanceUnit} onChange={event => changeUiPreferences({ distanceUnit: event.target.value === "meters" ? "meters" : "yards" })}><option value="yards">Yardas</option><option value="meters">Metros</option></select></label>
        <label className="accountSettingRow"><span><b>Idioma</b><small>La interfaz completa está disponible en español.</small></span><select aria-label="Idioma" value="es-MX" onChange={() => undefined}><option value="es-MX">Español</option><option value="en" disabled>Inglés — Próximamente</option></select></label>
        {preferenceMessage && <p role="status">{preferenceMessage}</p>}
      </section>
      </div>}
      {accountSection === "notifications" && <div data-settings-section="notifications">
      <section className="card accountCompactCard"><h2>Notificaciones</h2>
        <p>Estas preferencias son independientes del permiso del dispositivo y del proveedor que realiza el envío.</p>
        <label className="accountSettingRow"><span><b>Social</b><small>Avisos de actividad nueva dentro de The Backyard. Esta preferencia se confirma en tu cuenta; no cambia el permiso del dispositivo ni registra un proveedor push.</small></span><input type="checkbox" checked={notificationsEnabled} disabled={internalNotificationsSaving || identity.mode !== "authenticated"} onChange={event => { void onNotificationsEnabledChange(event.target.checked); }} aria-label="Activar avisos sociales dentro de la app" /></label>
        {internalNotificationsMessage && <p role="status">{internalNotificationsMessage}</p>}
        {!notificationPreferencesReady && <p role="status">Consultando preferencias de cuenta…</p>}
        {notificationPreferencesReady && <>
        <label className="accountSettingRow"><span><b>Push</b><small>Preferencia de cuenta. El permiso del dispositivo se revisa por separado en Privacidad y permisos. Entrega: {notificationDelivery.push.configured ? "proveedor configurado" : "no configurada"}.</small></span><input type="checkbox" checked={uiPreferences.push} disabled={notificationPreferenceSaving} onChange={event => changeUiPreferences({ push: event.target.checked })} aria-label="Preferir notificaciones push" /></label>
        <label className="accountSettingRow"><span><b>Email</b><small>Preferencia de cuenta. Entrega: {notificationDelivery.email.configured ? "proveedor configurado" : "no configurada"}.</small></span><input type="checkbox" checked={uiPreferences.email} disabled={notificationPreferenceSaving} onChange={event => changeUiPreferences({ email: event.target.checked })} aria-label="Preferir notificaciones por email" /></label>
        <label className="accountSettingRow"><span><b>Rondas</b><small>Avisos relacionados con invitaciones y actividad de rondas.</small></span><input type="checkbox" checked={uiPreferences.rounds} disabled={notificationPreferenceSaving} onChange={event => changeUiPreferences({ rounds: event.target.checked })} aria-label="Activar avisos de rondas" /></label>
        <label className="accountSettingRow"><span><b>Recordatorios</b><small>Recordatorios opcionales de actividad pendiente.</small></span><input type="checkbox" checked={uiPreferences.reminders} disabled={notificationPreferenceSaving} onChange={event => changeUiPreferences({ reminders: event.target.checked })} aria-label="Activar recordatorios" /></label>
        </>}
        {preferenceMessage && <p role="status">{preferenceMessage}</p>}
      </section>
      {identity.accessToken && <section className="card accountCompactCard"><SocialSharingPreferences key={identity.userId} accessToken={identity.accessToken} section="notifications" /></section>}
      </div>}
      {accountSection === "privacy" && <div data-settings-section="privacy">
      <section className="card accountCompactCard"><h2>Privacidad y permisos</h2><ProfileVisibilitySettings userId={identity.userId} accessToken={identity.mode === 'authenticated' ? identity.accessToken : undefined} authenticated={identity.mode === 'authenticated'} /><button type="button" className="accountChevronRow" onClick={() => setManagingAiConsents(true)}><span><b>Autorizaciones de IA</b><small>Texto o dictado, imágenes/scorecards y fotos de launch monitor</small></span><strong>›</strong></button></section>
      {identity.mode === "authenticated" && <DevicePermissionSettings key={`device-permissions-${identity.userId}`} userId={identity.userId} accessToken={identity.accessToken} />}
      {identity.accessToken && <section className="card accountCompactCard"><SocialSharingPreferences key={identity.userId} accessToken={identity.accessToken} section="sharing" /></section>}
      <section className="card accountCompactCard"><h2>Legal</h2><div className="documentConsentList compactConsentList"><Link href="/legal/terms?returnTo=account"><span>Términos de Uso</span><b>{accepted("terms")}</b></Link><Link href="/legal/privacy-simplified?returnTo=account"><span>Aviso simplificado</span><b>Ver</b></Link><Link href="/legal/privacy?returnTo=account"><span>Aviso de Privacidad</span><b>{accepted("privacy")}</b></Link></div><button type="button" className="textButton accountConsentButton" onClick={() => setManagingConsents(true)}>Gestionar consentimientos</button></section>
      </div>}
      {accountSection === "account" && <>
      {identity.mode === "authenticated" && <section className="card accountDangerZone"><div><span>TUS DATOS</span><h2>Controles de privacidad</h2></div><button type="button" className="dangerOutlineButton" onClick={() => { setDestructiveError(""); setDeleteStatsText(""); statsRequestId.current = undefined; setDeleteStatsOpen(true); }}>Eliminar estadísticas</button><p>Reinicia promedios y rendimiento desde hoy. Tu cuenta, grupos y rondas históricas se conservan.</p>{statisticsResetAt && <small>Último reset: {new Date(statisticsResetAt).toLocaleString("es-MX")}</small>}<button type="button" className="dangerButton" onClick={() => { setDestructiveError(""); setDeleteAccountPolicy(null); setDeleteAccountText(""); setDeleteAccountOpen(true); }}>Eliminar cuenta</button><p>Elimina la cuenta y solicita borrar o anonimizar su información permitida.</p></section>}
      <section className="card accountContactCard"><h2>Ayuda y privacidad</h2><button type="button" className="secondary" onClick={() => requestFeedback()}>Reportar un problema o sugerencia</button><div className="accountContacts"><a href={`mailto:${legalConfig.supportEmail}`}><span>Soporte</span><b>{legalConfig.supportEmail}</b></a><a href={`mailto:${legalConfig.privacyEmail}`}><span>Privacidad y ARCO</span><b>{legalConfig.privacyEmail}</b></a></div></section>
      <section className="card accountSessionCard single"><button className="secondary big" onClick={logout}>{identity.mode === "guest" ? "Salir del modo invitado" : "Cerrar sesión"}</button></section>{notice}
      </>}
      {deleteStatsOpen && <StatisticsResetDialog confirmation={deleteStatsText} onConfirmation={setDeleteStatsText} busy={deletingStatistics} error={destructiveError} onClose={() => { setDeleteStatsOpen(false); statsRequestId.current = undefined; setDeleteStatsText(""); setDestructiveError(""); }} onConfirm={() => void deleteStatistics()} />}
      {deleteAccountOpen && <AccountDataDialog confirmation={deleteAccountText} onConfirmation={setDeleteAccountText} policy={deleteAccountPolicy} onPolicy={(policy) => { setDeleteAccountPolicy(policy); setDeleteAccountText(""); setDestructiveError(""); accountRequestId.current = undefined; }} busy={deletingAccount} syncBusy={cloudStatus === "syncing" || cloudStatus === "saving"} error={destructiveError} onClose={() => { setDeleteAccountOpen(false); setDeleteAccountText(""); setDeleteAccountPolicy(null); setDestructiveError(""); }} onConfirm={() => void deleteAccount()} />}
    </>}
    {view === "account" && onPageBack && <BottomBackAction label="← Regresar" onBack={onPageBack} />}
  </>;
}
