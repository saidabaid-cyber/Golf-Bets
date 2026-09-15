"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { LEGAL_DOCUMENT_VERSIONS, legalConfig } from "../../lib/legal-config";
import { accountDeletionMarkerKey, profileHandicapInput, profileHandicapLabel, validateProfileAvatarUrl, validateProfileDraft, type BackyardProfileDetails } from "../../lib/account-state";
import { accountDeletionPrewriteRejected, accountDeletionRequestBody, accountDeletionResponseConfirmed, clearAccountDeletionIntent, prepareAccountDeletionIntent, settleAccountDeletionClient, type AccountDeletionIntent } from "../../lib/account-deletion-client";
import { ballFitDefaultsFromProfile } from "../../lib/ball-fitting";
import type { GolfInsights } from "../../lib/golf-insights";
import { isStatisticsDeleteConfirmation, requestStatisticsReset, type StatisticsResetRecord } from "../../lib/statistics-reset";
import { EquipmentProfilePanel } from "./equipment-profile-panel";
import { GhinPlaceholder } from "./ghin-placeholder";
import { LegalConsentManager } from "./legal-consent-manager";
import { AccountDataDialog, StatisticsResetDialog, type AccountDataPolicy } from "./profile-data-dialogs";
import { BackyardIndexCard } from "./backyard-index-card";
import type { BackyardIndexPreferenceController } from "./use-backyard-index-preference";
import type { RoundSnapshot } from "../../lib/types";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import { ProfileClubPicker } from "./profile-club-picker";
import { ProfileImagePicker } from "./profile-image-picker";
import { ProfileLocationPicker } from "./profile-location-picker";
import { normalizeProfileLocation, validateProfileLocation } from "../../lib/profile-geography";
import { useBackyardAccount } from "./account-provider";

type ProfileAccountPanelProps = {
  view: "profile" | "account";
  rootNavigationKey?: number;
  history?: RoundSnapshot[];
  indexControl: BackyardIndexPreferenceController;
  focusSection?: "profile" | "equipment";
  highContrast: boolean;
  onHighContrastChange: (value: boolean) => void;
  notificationsEnabled: boolean;
  onNotificationsEnabledChange: (value: boolean) => void;
  golfInsights?: GolfInsights;
  statisticsResetAt?: string | null;
  onStatisticsReset?: (reset: StatisticsResetRecord) => void;
  onOpenStats?: () => void;
  onOpenAccount?: () => void;
  onOpenEquipment: () => void;
  onBackToProfile: () => void;
};

type EditDraft = Pick<BackyardProfileDetails, "givenName" | "familyName" | "username" | "homeClub" | "homeClubId" | "preferredTee" | "profileVisibility" | "countryCode" | "country" | "stateCode" | "state">;

function draftFromIdentity(identity: ReturnType<typeof useBackyardAccount>["identity"]): EditDraft {
  return {
    givenName: identity.givenName || "",
    familyName: identity.familyName || "",
    username: identity.username || "",
    ...normalizeProfileLocation(identity),
    homeClub: identity.homeClub || "",
    homeClubId: identity.homeClubId || "",
    preferredTee: identity.preferredTee || "",
    profileVisibility: identity.profileVisibility === "friends" ? "friends" : "private",
  };
}

function decimal(value: number | undefined) {
  return value === undefined ? "—" : value.toFixed(1);
}

export function ProfileAccountPanel({ view, rootNavigationKey = 0, history = [], indexControl, focusSection = "profile", highContrast, onHighContrastChange, notificationsEnabled, onNotificationsEnabledChange, golfInsights, statisticsResetAt, onStatisticsReset, onOpenStats, onOpenAccount, onOpenEquipment, onBackToProfile }: ProfileAccountPanelProps) {
  const { identity, updateProfile, logout, finishAccountDeletion, openAccess, acceptances, bettingConsentGranted, requestBettingConsent, cloudLinked, cloudStatus, requestCloudLink, cloudIssues, retryCloudSync } = useBackyardAccount();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(identity.displayName);
  const [handicap, setHandicap] = useState(profileHandicapInput(identity.defaultHandicap));
  const [avatarUrl, setAvatarUrl] = useState(identity.avatarUrl);
  const [draft, setDraft] = useState<EditDraft>(() => draftFromIdentity(identity));
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [managingConsents, setManagingConsents] = useState(false);
  const [deleteStatsOpen, setDeleteStatsOpen] = useState(false);
  const [deleteStatsText, setDeleteStatsText] = useState("");
  const [deletingStatistics, setDeletingStatistics] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountText, setDeleteAccountText] = useState("");
  const [deleteAccountPolicy, setDeleteAccountPolicy] = useState<AccountDataPolicy | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const statsInFlight = useRef(false);
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
    if (seenRootNavigation.current === rootNavigationKey || saving || deletingStatistics || deletingAccount) return;
    seenRootNavigation.current = rootNavigationKey;
    setEditing(false); setManagingConsents(false); setDeleteStatsOpen(false); setDeleteAccountOpen(false); setDestructiveError("");
  }, [rootNavigationKey, saving, deletingStatistics, deletingAccount]);

  useEffect(() => {
    if (editing) return;
    setName(identity.displayName);
    setHandicap(profileHandicapInput(identity.defaultHandicap));
    setAvatarUrl(identity.avatarUrl);
    setDraft(draftFromIdentity(identity));
  }, [editing, identity]);

  const notice = message ? <div className={messageKind === "error" ? "notice bad" : "notice"} role={messageKind === "error" ? "alert" : "status"}>{message}</div> : null;

  async function saveProfile() {
    if (avatarBusy || saving) return;
    const validated = validateProfileDraft(name, handicap);
    if (!validated.ok) { setMessageKind("error"); setMessage(validated.message); return; }
    const avatar = validateProfileAvatarUrl(avatarUrl);
    if (!avatar.ok) { setMessageKind("error"); setMessage(avatar.message); return; }
    const locationValidation = validateProfileLocation(draft);
    if (!locationValidation.valid) { setMessageKind("error"); setMessage(locationValidation.errors.country || locationValidation.errors.state || "Revisa tu país y región."); return; }
    setSaving(true); setMessage("");
    try {
      const result = await updateProfile({ displayName: validated.displayName, defaultHandicap: validated.defaultHandicap, avatarUrl: avatar.avatarUrl, ...draft });
      setMessageKind("success"); setMessage(result === "cloud" ? "Perfil guardado y sincronizado." : "Perfil guardado en este dispositivo. Sincronización pendiente."); setEditing(false);
    } catch { setMessageKind("error"); setMessage("No se confirmó el guardado. Conservamos lo que escribiste; reintenta."); }
    finally { setSaving(false); }
  }

  async function updateVisibility(next: EditDraft["profileVisibility"]) {
    const previous = draft.profileVisibility;
    setDraft((current) => ({ ...current, profileVisibility: next }));
    setMessage("");
    try {
      await updateProfile({ displayName: identity.displayName, defaultHandicap: identity.defaultHandicap, avatarUrl: identity.avatarUrl, profileVisibility: next });
      setMessageKind("success"); setMessage("Privacidad actualizada.");
    } catch {
      setDraft((current) => ({ ...current, profileVisibility: previous }));
      setMessageKind("error"); setMessage("No se confirmó el cambio de privacidad. Reintenta.");
    }
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

  if (managingConsents) return <LegalConsentManager userId={identity.userId} accessToken={identity.accessToken} authenticated={identity.mode === "authenticated"} acceptances={acceptances} bettingConsentGranted={bettingConsentGranted} requestBettingConsent={requestBettingConsent} onBack={() => setManagingConsents(false)} />;

  if (view === "profile" && identity.mode === "authenticated" && focusSection === "equipment") return <><header className="profileMobileHeader profileEditHeader"><button type="button" className="textButton" onClick={onBackToProfile}>← Mi Perfil</button><div><span>MI PERFIL</span><h1>Mi Bolsa</h1></div></header><div id="equipment-bag"><EquipmentProfilePanel userId={identity.userId} accessToken={identity.accessToken} defaultHandicap={identity.defaultHandicap} ballFitDefaults={ballFitDefaultsFromProfile(identity)} onBackToProfile={onBackToProfile} /></div></>;

  if (view === "profile" && identity.mode === "authenticated" && editing) return <>
    <header className="profileMobileHeader profileEditHeader"><button type="button" className="textButton" onClick={() => setEditing(false)}>← Mi Perfil</button><div><span>MI PERFIL</span><h1>Editar perfil</h1></div></header>
    <section className="card profileEditCard"><h2>Datos personales</h2><div className="profileEditGrid">
      <label>Nombre visible<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" /></label>
      <label>Nombre(s)<input value={draft.givenName} onChange={(event) => setDraft((current) => ({ ...current, givenName: event.target.value }))} autoComplete="given-name" /></label>
      <label>Apellidos<input value={draft.familyName} onChange={(event) => setDraft((current) => ({ ...current, familyName: event.target.value }))} autoComplete="family-name" /></label>
      <label>Username<input value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value.replace(/^@+/, "") }))} placeholder="sin @" autoComplete="username" /></label>
      <label>HCP / Index<input type="text" inputMode="text" value={handicap} onChange={(event) => setHandicap(event.target.value)} placeholder="Ej. 8.4 o +1.2" /></label>
    </div></section>
    <section className="card profileEditCard"><h2>Foto / Avatar</h2><ProfileImagePicker value={avatarUrl} onChange={setAvatarUrl} onSaveAvatar={async (value) => {
      const result = await updateProfile({ displayName: identity.displayName, defaultHandicap: identity.defaultHandicap, avatarUrl: value });
      setMessageKind("success"); setMessage(result === "cloud" ? "Avatar guardado y sincronizado." : "Avatar guardado en este dispositivo. Sincronización pendiente.");
    }} onBusyChange={setAvatarBusy} accessToken={identity.accessToken} userId={identity.userId} /><p className="hint">Quitarla en The Backyard no modifica tu foto de Google.</p></section>
    <section className="card profileEditCard"><h2>País y región</h2><ProfileLocationPicker value={draft} onChange={(location) => setDraft((current) => ({ ...current, ...location }))} /><p className="hint">Estos datos de perfil no se publican automáticamente. No usamos GPS.</p></section>
    <section className="card profileEditCard"><div className="sectionTitle"><div><h2>Información de golf</h2><p>Opcional</p></div></div><div className="profileEditGrid"><ProfileClubPicker value={draft.homeClub} clubId={draft.homeClubId} onChange={({ name: homeClub, id: homeClubId }) => setDraft((current) => ({ ...current, homeClub, homeClubId }))} /><label>Tee habitual<input value={draft.preferredTee} onChange={(event) => setDraft((current) => ({ ...current, preferredTee: event.target.value }))} /></label></div></section>
    {notice}<div className="profileEditActions"><button type="button" className="secondary" disabled={saving} onClick={() => setEditing(false)}>Cancelar</button><button type="button" className="primary" disabled={saving || avatarBusy} onClick={() => void saveProfile()}>{saving ? "Guardando…" : avatarBusy ? "Preparando imagen…" : "Guardar perfil"}</button></div>
  </>;

  const userAcceptances = acceptances.filter((item) => item.userId === identity.userId);
  const accepted = (type: keyof typeof LEGAL_DOCUMENT_VERSIONS) => userAcceptances.some((item) => item.type === type) ? "Aceptado" : "Pendiente";

  return <>
    <header className="profileMobileHeader"><div><span>{view === "profile" ? "MI PERFIL" : "MI CUENTA"}</span><h1>{view === "profile" ? "Mi Perfil" : "Cuenta y privacidad"}</h1></div></header>
    {view === "profile" && identity.mode === "guest" && <section className="card guestAccountCard"><h2>Tu golf permanece en este dispositivo</h2><p>Crea una cuenta o inicia sesión para tener un perfil persistente.</p><div className="accountInlineActions"><button className="primary" onClick={openAccess}>Crear cuenta</button><button className="secondary" onClick={openAccess}>Iniciar sesión</button></div></section>}
    {view === "profile" && identity.mode === "authenticated" && <main className="profileMobileStack">
      <section className="card profileOverviewCard"><div className="profileOverviewIdentity"><div className="profileOverviewAvatar"><ProfileAvatarMedia value={identity.avatarUrl} fallback={(identity.displayName.trim()[0] || "J").toUpperCase()} alt={`Avatar de ${identity.displayName}`} /></div><div><h2>{identity.displayName}</h2><p>{identity.username ? `@${identity.username}` : "Sin username"}</p><span>HCP / Index <b>{profileHandicapLabel(identity.defaultHandicap)}</b></span></div></div><button type="button" className="primary profileEditButton" onClick={() => setEditing(true)}>Editar perfil</button></section>
      <section className="card profileCompactCard"><div className="profileCompactHeading"><div><span>INFORMACIÓN DE GOLF</span><h2>Tu juego</h2></div><button type="button" className="textButton" onClick={() => setEditing(true)}>Editar</button></div><div className="profileCompactRows"><div><span>HCP / Index</span><b>{profileHandicapLabel(identity.defaultHandicap)}</b></div><div><span>Home Club</span><b>{identity.homeClub || "Sin indicar"}</b></div><div><span>Tee habitual</span><b>{identity.preferredTee || "Sin indicar"}</b></div></div><GhinPlaceholder /></section>
      <BackyardIndexCard history={history} userId={identity.userId} enabled={indexControl.preference?.enabled === true} onEnabledChange={indexControl.change} saving={indexControl.saving || !indexControl.ready} error={indexControl.error} localPccZeroDeclared={Boolean(indexControl.preference?.localPccZeroDeclaredAt)} onDeclareLocalPccZero={indexControl.declareLocalZero} />
      {indexControl.error && <button type="button" className="textButton" onClick={() => void indexControl.retry()}>Reintentar sincronización del Índice</button>}
      <section className="card profileCompactCard"><div className="profileCompactHeading"><div><span>FOTO / AVATAR</span><h2>{identity.avatarUrl ? "Avatar configurado" : "Sin imagen"}</h2></div><button type="button" className="textButton" onClick={() => setEditing(true)}>Cambiar</button></div><div className="profileAvatarSummary"><div className="profileAvatarMini"><ProfileAvatarMedia value={identity.avatarUrl} fallback={(identity.displayName.trim()[0] || "J").toUpperCase()} alt={`Avatar actual de ${identity.displayName}`} /></div><p>Foto, emoji, avatar manual o sin imagen.</p></div></section>
      {golfInsights && <section className="card profileCompactCard"><div className="profileCompactHeading"><div><span>ACTIVIDAD</span><h2>Resumen personal</h2></div>{onOpenStats && <button type="button" className="textButton" onClick={onOpenStats}>Ver Stats</button>}</div><div className="profileActivityGrid"><div><span>Rondas</span><b>{golfInsights.rounds}</b></div><div><span>Promedio</span><b>{decimal(golfInsights.averageScore)}</b></div><div><span>Putts</span><b>{decimal(golfInsights.averagePutts)}</b></div></div></section>}
      <nav className="card profileNavigationList" aria-label="Secciones de Mi Perfil">
        <button type="button" className="profileNavigationCard" onClick={onOpenEquipment}><span><b>Mi equipo</b><small>Mi Bolsa, bastones y bola</small></span><strong aria-hidden="true">›</strong></button>
        <button type="button" className="profileNavigationCard" onClick={onOpenAccount}><span><b>Preferencias</b><small>Privacidad y alto contraste</small></span><strong aria-hidden="true">›</strong></button>
        <button type="button" className="profileNavigationCard" onClick={onOpenAccount}><span><b>Cuenta y privacidad</b><small>Email, acceso, consentimientos y datos</small></span><strong aria-hidden="true">›</strong></button>
        <button type="button" className="profileNavigationCard" onClick={onOpenAccount}><span><b>Notificaciones</b><small>Avisos sociales dentro de la app</small></span><strong aria-hidden="true">›</strong></button>
      </nav>{notice}
    </main>}

    {view === "account" && identity.mode === "guest" && <section className="card guestAccountCard"><h2>Modo invitado</h2><p>Inicia sesión para administrar datos de una cuenta.</p><div className="accountInlineActions"><button className="primary" onClick={openAccess}>Crear cuenta</button><button className="secondary" onClick={openAccess}>Iniciar sesión</button></div></section>}
    {view === "account" && identity.mode === "authenticated" && <section className="card cloudAccountStatus accountCloudCompact" aria-label="Estado de la cuenta"><div><h2>{cloudIssues.some((issue) => issue.kind === "session_expired") ? "Sesión por renovar" : "Cuenta conectada"}</h2><p role="status">{cloudStatus === "synced" ? "Guardado en la nube ✓" : cloudStatus === "syncing" ? "Sincronizando…" : cloudStatus === "saving" ? "Guardando…" : cloudStatus === "offline" ? "Sin conexión" : cloudStatus === "error" ? "Error de sincronización" : cloudLinked ? "Pendiente de sincronizar" : "Nube sin vincular"}</p></div>{cloudLinked ? <button className="textButton" onClick={() => void retryCloudSync()}>Reintentar</button> : <button className="textButton" onClick={requestCloudLink}>Vincular</button>}</section>}
    {view === "account" && <>
      <section className="card accountCompactCard"><h2>Cuenta</h2><div className="accountCompactRows"><div><span>Email</span><b>{identity.email || "Sin email"}</b></div><div><span>Métodos de acceso</span><b>{identity.mode === "authenticated" ? identity.providers.map((provider) => provider === "google" ? "Google" : provider === "email" ? "Correo" : provider).join(" · ") || "Correo" : "Modo invitado"}</b></div></div></section>
      <section className="card accountCompactCard"><h2>Privacidad y preferencias</h2><label className="accountSettingRow"><span><b>Privacidad</b><small>Quién puede ver tu perfil</small></span><select value={draft.profileVisibility} disabled={identity.mode !== "authenticated"} onChange={(event) => void updateVisibility(event.target.value as EditDraft["profileVisibility"])}><option value="private">Privado</option><option value="friends">Amigos</option></select></label><button type="button" className="accountChevronRow" onClick={() => setManagingConsents(true)}><span><b>Consentimiento IA</b><small>Revisar permisos de procesamiento</small></span><strong>›</strong></button><label className="accountSettingRow"><span><b>Notificaciones</b><small>Avisos sociales dentro de la app</small></span><input type="checkbox" checked={notificationsEnabled} onChange={(event) => onNotificationsEnabledChange(event.target.checked)} aria-label="Activar avisos dentro de la app" /></label><label className="accountSettingRow"><span><b>Alto contraste</b><small>Preferencia visual</small></span><input type="checkbox" checked={highContrast} onChange={(event) => onHighContrastChange(event.target.checked)} /></label></section>
      <section className="card accountCompactCard"><h2>Legal</h2><div className="documentConsentList compactConsentList"><Link href="/legal/terms?returnTo=account"><span>Términos de Uso</span><b>{accepted("terms")}</b></Link><Link href="/legal/privacy-simplified?returnTo=account"><span>Aviso simplificado</span><b>Ver</b></Link><Link href="/legal/privacy?returnTo=account"><span>Aviso de Privacidad</span><b>{accepted("privacy")}</b></Link></div><button type="button" className="textButton accountConsentButton" onClick={() => setManagingConsents(true)}>Gestionar consentimientos</button></section>
      {identity.mode === "authenticated" && <section className="card accountDangerZone"><div><span>TUS DATOS</span><h2>Controles de privacidad</h2></div><button type="button" className="dangerOutlineButton" onClick={() => { setDestructiveError(""); setDeleteStatsText(""); statsRequestId.current = undefined; setDeleteStatsOpen(true); }}>Eliminar estadísticas</button><p>Reinicia promedios y rendimiento desde hoy. Tu cuenta, grupos y rondas históricas se conservan.</p>{statisticsResetAt && <small>Último reset: {new Date(statisticsResetAt).toLocaleString("es-MX")}</small>}<button type="button" className="dangerButton" onClick={() => { setDestructiveError(""); setDeleteAccountPolicy(null); setDeleteAccountText(""); setDeleteAccountOpen(true); }}>Eliminar cuenta</button><p>Elimina la cuenta y solicita borrar o anonimizar su información permitida.</p></section>}
      <section className="card accountContactCard"><h2>Ayuda y privacidad</h2><div className="accountContacts"><a href={`mailto:${legalConfig.supportEmail}`}><span>Soporte</span><b>{legalConfig.supportEmail}</b></a><a href={`mailto:${legalConfig.privacyEmail}`}><span>Privacidad y ARCO</span><b>{legalConfig.privacyEmail}</b></a></div></section>
      <section className="card accountSessionCard single"><button className="secondary big" onClick={logout}>{identity.mode === "guest" ? "Salir del modo invitado" : "Cerrar sesión"}</button></section>{notice}
      {deleteStatsOpen && <StatisticsResetDialog confirmation={deleteStatsText} onConfirmation={setDeleteStatsText} busy={deletingStatistics} error={destructiveError} onClose={() => { setDeleteStatsOpen(false); statsRequestId.current = undefined; setDeleteStatsText(""); setDestructiveError(""); }} onConfirm={() => void deleteStatistics()} />}
      {deleteAccountOpen && <AccountDataDialog confirmation={deleteAccountText} onConfirmation={setDeleteAccountText} policy={deleteAccountPolicy} onPolicy={(policy) => { setDeleteAccountPolicy(policy); setDeleteAccountText(""); setDestructiveError(""); accountRequestId.current = undefined; }} busy={deletingAccount} syncBusy={cloudStatus === "syncing" || cloudStatus === "saving"} error={destructiveError} onClose={() => { setDeleteAccountOpen(false); setDeleteAccountText(""); setDeleteAccountPolicy(null); setDestructiveError(""); }} onConfirm={() => void deleteAccount()} />}
    </>}
  </>;
}
