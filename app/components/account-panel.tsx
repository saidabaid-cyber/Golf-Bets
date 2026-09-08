"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LEGAL_DOCUMENT_VERSIONS, legalConfig } from "../../lib/legal-config";
import { accountDeletionMarkerKey, BETTING_DATA_CONSENT_TYPE, emptyBackyardProfileDetails, profileHandicapInput, profileHandicapLabel, validateProfileAvatarUrl, validateProfileDraft, type BackyardProfile, type BackyardProfileDetails } from "../../lib/account-state";
import { ballFitDefaultsFromProfile } from "../../lib/ball-fitting";
import type { GolfInsights } from "../../lib/golf-insights";
import { useBackyardAccount } from "./account-provider";
import { EquipmentProfilePanel } from "./equipment-profile-panel";

type AccountPanelProps = {
  view: "profile" | "account";
  highContrast: boolean;
  onHighContrastChange: (value: boolean) => void;
  notificationsEnabled: boolean;
  onNotificationsEnabledChange: (value: boolean) => void;
  golfInsights?: GolfInsights;
  onOpenStats?: () => void;
  onOpenAccount?: () => void;
};

function profileMoney(value: number) {
  const rounded = Math.round(value);
  if (rounded === 0) return "$0";
  return `${rounded > 0 ? "+" : "−"}$${Math.abs(rounded).toLocaleString("es-MX")}`;
}

function profileDecimal(value: number | undefined) {
  return value === undefined ? "—" : value.toFixed(1);
}

function profileRelative(value: number | undefined) {
  if (value === undefined) return "—";
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "E";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}

type ProfileDetailsDraft = BackyardProfileDetails;

function profileDetailsDraft(profile: BackyardProfile): ProfileDetailsDraft {
  const defaults = emptyBackyardProfileDetails();
  return {
    givenName: profile.givenName || defaults.givenName,
    familyName: profile.familyName || defaults.familyName,
    username: profile.username || defaults.username,
    city: profile.city || defaults.city,
    state: profile.state || defaults.state,
    country: profile.country || defaults.country,
    homeClub: profile.homeClub || defaults.homeClub,
    preferredTee: profile.preferredTee || defaults.preferredTee,
    handedness: profile.handedness || defaults.handedness,
    typicalScore: profile.typicalScore ?? defaults.typicalScore,
    driverDistanceYards: profile.driverDistanceYards ?? defaults.driverDistanceYards,
    driverSwingSpeedBand: profile.driverSwingSpeedBand || defaults.driverSwingSpeedBand,
    usualTrajectory: profile.usualTrajectory || defaults.usualTrajectory,
    shotTendency: profile.shotTendency || defaults.shotTendency,
    greenSpeed: profile.greenSpeed || defaults.greenSpeed,
    gamePriority: profile.gamePriority || defaults.gamePriority,
    priceImportance: profile.priceImportance || defaults.priceImportance,
    improvementGoals: [...(profile.improvementGoals || defaults.improvementGoals)],
    primaryGoal: profile.primaryGoal || defaults.primaryGoal,
    targetHandicap: profile.targetHandicap ?? defaults.targetHandicap,
    planId: profile.planId || defaults.planId,
    ghinLinkStatus: profile.ghinLinkStatus || defaults.ghinLinkStatus,
    golfProfileUpdatedAt: profile.golfProfileUpdatedAt ?? defaults.golfProfileUpdatedAt,
    bio: profile.bio || defaults.bio,
    profileVisibility: profile.profileVisibility || defaults.profileVisibility,
  };
}

function optionalDraftNumber(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const SWING_SPEED_LABELS: Record<Exclude<BackyardProfileDetails["driverSwingSpeedBand"], "">, string> = {
  UNDER_85: "Menos de 85 mph",
  FROM_85_TO_95: "85–95 mph",
  FROM_95_TO_105: "95–105 mph",
  OVER_105: "Más de 105 mph",
};

const TRAJECTORY_LABELS: Record<Exclude<BackyardProfileDetails["usualTrajectory"], "">, string> = { LOW: "Baja", MID: "Media", HIGH: "Alta" };
const TENDENCY_LABELS: Record<Exclude<BackyardProfileDetails["shotTendency"], "">, string> = { DRAW: "Draw", FADE: "Fade", HOOK: "Hook", SLICE: "Slice", STRAIGHT: "Recta", VARIABLE: "Variable" };
const GREEN_SPEED_LABELS: Record<Exclude<BackyardProfileDetails["greenSpeed"], "">, string> = { SLOW: "Lentos", MID: "Medios", FAST: "Rápidos", VARIABLE: "Varía" };
const GAME_PRIORITY_LABELS: Record<Exclude<BackyardProfileDetails["gamePriority"], "">, string> = { DISTANCE: "Distancia", CONTROL: "Control", ACCURACY: "Precisión", FEEL: "Sensación", SHORT_GAME: "Juego corto" };
const PRICE_IMPORTANCE_LABELS: Record<Exclude<BackyardProfileDetails["priceImportance"], "">, string> = { LOW: "Poca", MID: "Media", HIGH: "Alta" };

function gameProfileChanged(profile: BackyardProfile, draft: ProfileDetailsDraft, handicap: number | null) {
  return JSON.stringify([
    profile.defaultHandicap ?? null,
    profile.handedness || "",
    profile.typicalScore ?? null,
    profile.driverDistanceYards ?? null,
    profile.driverSwingSpeedBand || "",
    profile.usualTrajectory || "",
    profile.shotTendency || "",
    profile.greenSpeed || "",
    profile.gamePriority || "",
    profile.priceImportance || "",
  ]) !== JSON.stringify([
    handicap,
    draft.handedness,
    draft.typicalScore,
    draft.driverDistanceYards,
    draft.driverSwingSpeedBand,
    draft.usualTrajectory,
    draft.shotTendency,
    draft.greenSpeed,
    draft.gamePriority,
    draft.priceImportance,
  ]);
}

export function AccountPanel({ view, highContrast, onHighContrastChange, notificationsEnabled, onNotificationsEnabledChange, golfInsights, onOpenStats, onOpenAccount }: AccountPanelProps) {
  const { identity, updateProfile, logout, finishAccountDeletion, openAccess, acceptances, bettingConsentGranted, requestBettingConsent, cloudLinked, cloudStatus, requestCloudLink, lastCloudSync, cloudIssues, retryCloudSync } = useBackyardAccount();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(identity.displayName);
  const [handicap, setHandicap] = useState(profileHandicapInput(identity.defaultHandicap));
  const [avatarUrl, setAvatarUrl] = useState(identity.avatarUrl);
  const [profileDetails, setProfileDetails] = useState<ProfileDetailsDraft>(() => profileDetailsDraft(identity));
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const sessionExpired = cloudIssues.some((issue) => issue.kind === "session_expired");

  useEffect(() => {
    if (!editing) {
      setName(identity.displayName);
      setHandicap(profileHandicapInput(identity.defaultHandicap));
      setAvatarUrl(identity.avatarUrl);
      setProfileDetails(profileDetailsDraft(identity));
    }
  }, [identity, editing]);
  const userAcceptances = useMemo(() => acceptances.filter((item) => item.userId === identity.userId), [acceptances, identity.userId]);
  const acceptance = (type: keyof typeof LEGAL_DOCUMENT_VERSIONS) => userAcceptances.find((item) => item.type === type);
  const acceptedLabel = (type: keyof typeof LEGAL_DOCUMENT_VERSIONS) => {
    const record = acceptance(type);
    return record ? `v. ${record.documentVersion} · ${new Date(record.acceptedAt).toLocaleDateString("es-MX")}` : "Pendiente";
  };
  const bettingAcceptance = userAcceptances.find((item) => item.type === BETTING_DATA_CONSENT_TYPE);
  const bettingAcceptanceLabel = bettingAcceptance
    ? `${new Date(bettingAcceptance.acceptedAt).toLocaleDateString("es-MX")} · ${bettingAcceptance.syncStatus === "synced" ? "Sincronizada" : bettingAcceptance.syncStatus === "pending" ? "Local; nube pendiente" : "En este dispositivo"}`
    : "No otorgado";

  async function saveProfile() {
    const validation = validateProfileDraft(name, handicap);
    if (!validation.ok) { setMessageKind("error"); setMessage(validation.message); return; }
    const avatarValidation = validateProfileAvatarUrl(avatarUrl);
    if (!avatarValidation.ok) { setMessageKind("error"); setMessage(avatarValidation.message); return; }
    if (profileDetails.typicalScore !== null && (!Number.isInteger(profileDetails.typicalScore) || profileDetails.typicalScore < 40 || profileDetails.typicalScore > 200)) {
      setMessageKind("error"); setMessage("El score típico debe ser un entero entre 40 y 200, o quedar vacío."); return;
    }
    if (profileDetails.driverDistanceYards !== null && (!Number.isFinite(profileDetails.driverDistanceYards) || profileDetails.driverDistanceYards < 50 || profileDetails.driverDistanceYards > 500)) {
      setMessageKind("error"); setMessage("La distancia de driver debe estar entre 50 y 500 yardas, o quedar vacía."); return;
    }
    setSavingProfile(true); setMessageKind("success"); setMessage("");
    try {
      const golfProfileUpdatedAt = gameProfileChanged(identity, profileDetails, validation.defaultHandicap)
        ? new Date().toISOString()
        : identity.golfProfileUpdatedAt ?? null;
      const result = await updateProfile({ displayName: validation.displayName, defaultHandicap: validation.defaultHandicap, avatarUrl: avatarValidation.avatarUrl, ...profileDetails, golfProfileUpdatedAt });
      setEditing(false);
      setMessage(result === "cloud" ? "Perfil y datos de Mi juego guardados. La identidad básica quedó sincronizada." : "Perfil y Mi juego actualizados en este dispositivo. Los datos ampliados quedan pendientes de sincronización Beta.");
    } catch { setMessageKind("error"); setMessage("No se confirmó el guardado del perfil. Conservamos lo que escribiste; reintenta."); }
    finally { setSavingProfile(false); }
  }

  async function deleteAccount() {
    if (identity.mode === "guest") { setMessageKind("success"); setMessage("El modo invitado no tiene una cuenta de nube. Puedes borrar cada ronda e histórico desde la app o los datos del sitio desde el navegador."); setDeleteOpen(false); return; }
    if (cloudStatus === "syncing" || cloudStatus === "saving") { setMessageKind("error"); setMessage("Espera a que termine el guardado en curso antes de eliminar la cuenta."); return; }
    setDeletingAccount(true); setMessageKind("success"); setMessage("");
    const deletionMarker = accountDeletionMarkerKey(identity.userId);
    try {
      const requestedAt = new Date().toISOString();
      localStorage.setItem(deletionMarker, requestedAt);
      if (localStorage.getItem(deletionMarker) !== requestedAt) throw new Error("deletion_marker_not_persisted");
    } catch {
      setMessageKind("error");
      setMessage("No pudimos preparar la eliminación de forma segura en este dispositivo. Libera espacio o revisa el almacenamiento del navegador y reintenta.");
      setDeletingAccount(false);
      return;
    }
    let responseStatus: number | null = null;
    let serverDeletionConfirmed = false;
    try {
      const response = await fetch("/api/account/delete", { method: "DELETE", headers: { authorization: `Bearer ${identity.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ confirmation: "ELIMINAR" }) });
      responseStatus = response.status;
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "No se completó la eliminación en el servidor.");
      }
      serverDeletionConfirmed = true;
      const locallyComplete = await finishAccountDeletion();
      localStorage.setItem(deletionMarker, locallyComplete ? "completed" : "completed_cleanup_pending");
    } catch (error) {
      if (responseStatus === null || serverDeletionConfirmed || responseStatus >= 500) {
        // A lost response is ambiguous: honor the destructive request locally,
        // A confirmed response followed by a local failure has the same safe
        // recovery path. Keep the barrier so stale work cannot revive data.
        let locallyComplete = false;
        try { locallyComplete = await finishAccountDeletion(); }
        finally {
          localStorage.setItem(deletionMarker, serverDeletionConfirmed
            ? locallyComplete ? "completed" : "completed_cleanup_pending"
            : locallyComplete ? "pending_confirmation" : "cleanup_pending");
        }
      } else {
        localStorage.removeItem(deletionMarker);
        setMessageKind("error");
        setMessage(error instanceof Error ? error.message : "No se completó la eliminación en el servidor. Reintenta.");
        setDeleteOpen(false);
      }
    }
    finally { setDeletingAccount(false); }
  }

  return <>
    <section className="hero accountHero"><div><div className="eyebrow">{view === "profile" ? "THE BACKYARD · GOLFISTA" : "THE BACKYARD ACCOUNT"}</div><h1>{view === "profile" ? "Mi Perfil" : "Cuenta y privacidad"}</h1><p>{view === "profile" ? "Tu identidad de golf, HCP capturado y estadísticas reales." : "Acceso, sincronización, consentimientos y preferencias de tu cuenta."}</p></div></section>

    {view === "account" && identity.mode === "guest" && <section className="card guestAccountCard"><h2>Modo invitado · Los datos permanecen en este dispositivo</h2><div className="accountInlineActions"><button className="primary" onClick={openAccess}>Crear cuenta</button><button className="secondary" onClick={openAccess}>Iniciar sesión</button></div></section>}

    {view === "account" && identity.mode === "authenticated" && <section className="card cloudAccountStatus" aria-label="Estado de la cuenta">
      <h2>{sessionExpired ? "Datos disponibles en este dispositivo" : "Sesión iniciada"}</h2>
      <p role="status">{cloudStatus === "synced" ? "Guardado en la nube ✓" : cloudStatus === "syncing" ? "Sincronizando con la nube…" : cloudStatus === "saving" ? "Guardando en este dispositivo…" : cloudStatus === "offline" ? "Sin conexión · Pendiente de sincronizar" : cloudStatus === "error" ? "Error de sincronización · Tu copia local se conserva" : cloudLinked ? "Pendiente de sincronizar" : "Guardado en este dispositivo · Nube sin vincular"}</p>
      {lastCloudSync && <p className="hint">Última sincronización confirmada: {new Date(lastCloudSync).toLocaleString("es-MX")}</p>}
      {cloudIssues.map((issue) => <p className={issue.kind === "offline" || issue.kind === "conflict" ? "hint" : "bad"} key={issue.domain}><b>{issue.domain === "auth" ? "Sesión" : issue.domain === "profile" ? "Perfil" : issue.domain === "legal" ? "Consentimientos" : issue.domain === "files" ? "Archivos" : issue.domain === "conflict" ? "Conflicto" : "Ronda"}:</b> {issue.message}</p>)}
      {cloudLinked && !sessionExpired && <button className="secondary" disabled={cloudStatus === "syncing" || cloudStatus === "saving"} onClick={() => void retryCloudSync()}>Reintentar sincronización</button>}
      {sessionExpired && <button className="primary" onClick={openAccess}>Volver a iniciar sesión</button>}
    </section>}
    {view === "account" && identity.mode === "authenticated" && !cloudLinked && <section className="card"><h2>Sincronización</h2><p>Tus datos siguen seguros en este dispositivo. Puedes vincularlos a tu cuenta cuando la nube esté configurada.</p><button className="primary" onClick={requestCloudLink}>Vincular datos locales</button></section>}

    {view === "profile" && identity.mode === "guest" && <section className="card guestAccountCard">
      <h2>Tu golf permanece en este dispositivo</h2>
      <p>Las rondas, grupos y estadísticas locales siguen disponibles. Crea una cuenta o inicia sesión para tener un perfil persistente con nombre, avatar y preferencias.</p>
      <div className="accountInlineActions"><button className="primary" onClick={openAccess}>Crear cuenta</button><button className="secondary" onClick={openAccess}>Iniciar sesión</button></div>
    </section>}

    {view === "profile" && identity.mode === "authenticated" && <section className="card profileCard">
      <div className="sectionTitle"><div className="profileIdentity"><div className="accountAvatar">{identity.avatarUrl ? <img src={identity.avatarUrl} alt={`Avatar de ${identity.displayName}`} referrerPolicy="no-referrer" /> : (identity.displayName.trim()[0] || "J").toUpperCase()}</div><div><h2>{identity.displayName}</h2><p>{identity.email || "Perfil local en este dispositivo"}</p></div></div><button className="secondary" onClick={() => setEditing((value) => !value)}>{editing ? "Cancelar" : "Editar perfil"}</button></div>
      {editing && <div className="profileForm profileFormExpanded">
        <label>Nombre visible<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" /></label>
        <label>HCP capturado manualmente (opcional)<input type="text" inputMode="text" value={handicap} onChange={(event) => setHandicap(event.target.value)} placeholder="Ej. 8.4 o +1.2" /></label>
        <div className="profileAvatarEditor">
          <label>Foto de perfil (URL HTTPS)<input type="url" inputMode="url" autoComplete="url" maxLength={2048} value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://…" /></label>
          <button type="button" className="secondary" disabled={!avatarUrl} onClick={() => setAvatarUrl("")}>Quitar foto</button>
          <p className="hint">Quitarla en The Backyard no modifica tu foto de Google.</p>
        </div>
        <label>Nombre(s)<input value={profileDetails.givenName} onChange={(event) => setProfileDetails((current) => ({ ...current, givenName: event.target.value }))} autoComplete="given-name" /></label>
        <label>Apellidos<input value={profileDetails.familyName} onChange={(event) => setProfileDetails((current) => ({ ...current, familyName: event.target.value }))} autoComplete="family-name" /></label>
        <label>Usuario<input value={profileDetails.username} onChange={(event) => setProfileDetails((current) => ({ ...current, username: event.target.value }))} placeholder="sin @" autoComplete="username" /></label>
        <label>Club<input value={profileDetails.homeClub} onChange={(event) => setProfileDetails((current) => ({ ...current, homeClub: event.target.value }))} /></label>
        <label>Ciudad<input value={profileDetails.city} onChange={(event) => setProfileDetails((current) => ({ ...current, city: event.target.value }))} autoComplete="address-level2" /></label>
        <label>Estado<input value={profileDetails.state} onChange={(event) => setProfileDetails((current) => ({ ...current, state: event.target.value }))} autoComplete="address-level1" /></label>
        <label>País<input value={profileDetails.country} onChange={(event) => setProfileDetails((current) => ({ ...current, country: event.target.value }))} autoComplete="country-name" /></label>
        <label>Tee preferido<input value={profileDetails.preferredTee} onChange={(event) => setProfileDetails((current) => ({ ...current, preferredTee: event.target.value }))} /></label>
        <label>Mano<select value={profileDetails.handedness} onChange={(event) => setProfileDetails((current) => ({ ...current, handedness: event.target.value as ProfileDetailsDraft["handedness"] }))}><option value="">Sin indicar</option><option value="right">Derecha</option><option value="left">Izquierda</option><option value="ambidextrous">Ambas</option></select></label>
        <div className="profileGameHeading"><div className="eyebrow">MI JUEGO</div><b>Preferencias golfísticas opcionales</b><p className="hint">HCP y mano usan los mismos datos de tu perfil; no necesitas repetirlos. Completa sólo lo que conozcas.</p></div>
        <label>Score típico<input type="number" inputMode="numeric" min={40} max={200} value={profileDetails.typicalScore ?? ""} onChange={(event) => setProfileDetails((current) => ({ ...current, typicalScore: optionalDraftNumber(event.target.value) }))} placeholder="Ej. 88" /></label>
        <label>Distancia con driver (yd)<input type="number" inputMode="decimal" min={50} max={500} step="1" value={profileDetails.driverDistanceYards ?? ""} onChange={(event) => setProfileDetails((current) => ({ ...current, driverDistanceYards: optionalDraftNumber(event.target.value) }))} placeholder="Ej. 235" /></label>
        <label>Velocidad de swing · driver<select value={profileDetails.driverSwingSpeedBand} onChange={(event) => setProfileDetails((current) => ({ ...current, driverSwingSpeedBand: event.target.value as ProfileDetailsDraft["driverSwingSpeedBand"] }))}><option value="">No la sé / sin indicar</option><option value="UNDER_85">Menos de 85 mph</option><option value="FROM_85_TO_95">85–95 mph</option><option value="FROM_95_TO_105">95–105 mph</option><option value="OVER_105">Más de 105 mph</option></select></label>
        <label>Trayectoria habitual<select value={profileDetails.usualTrajectory} onChange={(event) => setProfileDetails((current) => ({ ...current, usualTrajectory: event.target.value as ProfileDetailsDraft["usualTrajectory"] }))}><option value="">Sin indicar</option><option value="LOW">Baja</option><option value="MID">Media</option><option value="HIGH">Alta</option></select></label>
        <label>Tendencia habitual<select value={profileDetails.shotTendency} onChange={(event) => setProfileDetails((current) => ({ ...current, shotTendency: event.target.value as ProfileDetailsDraft["shotTendency"] }))}><option value="">Sin indicar</option><option value="DRAW">Draw</option><option value="FADE">Fade</option><option value="HOOK">Hook</option><option value="SLICE">Slice</option><option value="STRAIGHT">Recta</option><option value="VARIABLE">Variable</option></select></label>
        <label>Greens habituales<select value={profileDetails.greenSpeed} onChange={(event) => setProfileDetails((current) => ({ ...current, greenSpeed: event.target.value as ProfileDetailsDraft["greenSpeed"] }))}><option value="">Sin indicar</option><option value="SLOW">Lentos</option><option value="MID">Medios</option><option value="FAST">Rápidos</option><option value="VARIABLE">Varía</option></select></label>
        <label>Prioridad de juego<select value={profileDetails.gamePriority} onChange={(event) => setProfileDetails((current) => ({ ...current, gamePriority: event.target.value as ProfileDetailsDraft["gamePriority"] }))}><option value="">Sin indicar</option><option value="DISTANCE">Distancia</option><option value="CONTROL">Control</option><option value="ACCURACY">Precisión</option><option value="FEEL">Sensación</option><option value="SHORT_GAME">Juego corto</option></select></label>
        <label>Importancia del precio<select value={profileDetails.priceImportance} onChange={(event) => setProfileDetails((current) => ({ ...current, priceImportance: event.target.value as ProfileDetailsDraft["priceImportance"] }))}><option value="">Sin indicar</option><option value="LOW">Poca</option><option value="MID">Media</option><option value="HIGH">Alta</option></select></label>
        <label>Privacidad<select value={profileDetails.profileVisibility} onChange={(event) => setProfileDetails((current) => ({ ...current, profileVisibility: event.target.value as ProfileDetailsDraft["profileVisibility"] }))}><option value="private">Privado</option><option value="friends">Amigos</option></select></label>
        <label className="profileBioField">Bio<textarea value={profileDetails.bio} onChange={(event) => setProfileDetails((current) => ({ ...current, bio: event.target.value }))} maxLength={280} rows={3} /></label>
        <p className="hint profileLocalDetail">Los datos ampliados se conservan en este dispositivo. Su réplica multi-dispositivo se habilitará sólo con el esquema aislado de Beta.</p>
        <button className="primary profileSaveButton" disabled={savingProfile} onClick={saveProfile}>{savingProfile ? "Guardando…" : "Guardar perfil"}</button>
      </div>}
      {!editing && <div className="profileMetaList">
        <div className="profileMeta"><span>HCP capturado manualmente</span><b>{profileHandicapLabel(identity.defaultHandicap)}</b></div>
        {identity.username && <div className="profileMeta"><span>Usuario</span><b>@{identity.username}</b></div>}
        {identity.homeClub && <div className="profileMeta"><span>Club</span><b>{identity.homeClub}</b></div>}
        {(identity.city || identity.state || identity.country) && <div className="profileMeta"><span>Ubicación</span><b>{[identity.city, identity.state, identity.country].filter(Boolean).join(", ")}</b></div>}
        {identity.preferredTee && <div className="profileMeta"><span>Tee preferido</span><b>{identity.preferredTee}</b></div>}
        {identity.handedness && <div className="profileMeta"><span>Mano</span><b>{identity.handedness === "right" ? "Derecha" : identity.handedness === "left" ? "Izquierda" : "Ambas"}</b></div>}
        {(identity.typicalScore !== null && identity.typicalScore !== undefined) && <div className="profileMeta"><span>Score típico</span><b>{identity.typicalScore}</b></div>}
        {(identity.driverDistanceYards !== null && identity.driverDistanceYards !== undefined) && <div className="profileMeta"><span>Driver aproximado</span><b>{identity.driverDistanceYards} yd</b></div>}
        {identity.driverSwingSpeedBand && <div className="profileMeta"><span>Velocidad de swing</span><b>{SWING_SPEED_LABELS[identity.driverSwingSpeedBand]}</b></div>}
        {identity.usualTrajectory && <div className="profileMeta"><span>Trayectoria</span><b>{TRAJECTORY_LABELS[identity.usualTrajectory]}</b></div>}
        {identity.shotTendency && <div className="profileMeta"><span>Tendencia</span><b>{TENDENCY_LABELS[identity.shotTendency]}</b></div>}
        {identity.greenSpeed && <div className="profileMeta"><span>Greens habituales</span><b>{GREEN_SPEED_LABELS[identity.greenSpeed]}</b></div>}
        {identity.gamePriority && <div className="profileMeta"><span>Prioridad</span><b>{GAME_PRIORITY_LABELS[identity.gamePriority]}</b></div>}
        {identity.priceImportance && <div className="profileMeta"><span>Importancia del precio</span><b>{PRICE_IMPORTANCE_LABELS[identity.priceImportance]}</b></div>}
        {identity.golfProfileUpdatedAt && <div className="profileMeta"><span>Mi juego actualizado</span><b>{new Date(identity.golfProfileUpdatedAt).toLocaleDateString("es-MX")}</b></div>}
        {identity.bio && <p className="profileBio">{identity.bio}</p>}
        <p className="hint">The Backyard guarda el valor que capturas; no emite ni certifica un handicap oficial.</p>
      </div>}
    </section>}

    {view === "profile" && identity.mode === "authenticated" && message && <div className={messageKind === "error" ? "notice bad" : "notice"} role={messageKind === "error" ? "alert" : "status"}>{message}</div>}

    {view === "profile" && identity.mode === "authenticated" && <EquipmentProfilePanel userId={identity.userId} accessToken={identity.accessToken} defaultHandicap={identity.defaultHandicap} ballFitDefaults={ballFitDefaultsFromProfile(identity)} />}

    {view === "profile" && golfInsights && <section className="card betaProfileGolfCard">
      <div className="sectionTitle"><div><h2>Mi golf</h2><p>Resumen calculado sólo con tu histórico disponible.</p></div>{onOpenStats && <button type="button" className="textButton" onClick={onOpenStats}>Ver Stats</button>}</div>
      <div className="betaProfileGolfStats">
        <span><small>Rondas</small><b>{golfInsights.rounds}</b></span>
        <span><small>Promedio{golfInsights.scoreScopeHoles ? ` · ${golfInsights.scoreScopeHoles}H` : ""}</small><b>{profileDecimal(golfInsights.averageScore)}</b></span>
        <span><small>Mejor score{golfInsights.scoreScopeHoles ? ` · ${golfInsights.scoreScopeHoles}H` : ""}</small><b>{golfInsights.bestScore ?? "—"}</b></span>
        <span><small>Apuestas</small><b className={golfInsights.betBalance === undefined ? "" : golfInsights.betBalance >= 0 ? "good" : "bad"}>{golfInsights.betBalance === undefined ? "—" : profileMoney(golfInsights.betBalance)}</b></span>
      </div>
      <div className="betaProfileGolfStats betaProfileScoringStats">
        <span><small>Pars</small><b>{golfInsights.scoredRounds ? golfInsights.pars : "—"}</b></span>
        <span><small>Birdies</small><b>{golfInsights.scoredRounds ? golfInsights.birdies : "—"}</b></span>
        <span><small>Bogeys</small><b>{golfInsights.scoredRounds ? golfInsights.bogeys : "—"}</b></span>
        <span><small>Dobles+</small><b>{golfInsights.scoredRounds ? golfInsights.doublesOrWorse : "—"}</b></span>
      </div>
      <div className="betaAverageStrip">
        <span>Últimas 5 <b>{profileDecimal(golfInsights.last5Average)}</b></span>
        <span>Últimas 10 <b>{profileDecimal(golfInsights.last10Average)}</b></span>
        <span>Promedio vs par <b>{profileRelative(golfInsights.averageVsPar)}</b></span>
      </div>
      {golfInsights.scoreScopeHoles
        ? <p className="hint">Promedios con {golfInsights.scoreSampleRounds} {golfInsights.scoreSampleRounds === 1 ? "tarjeta completa" : "tarjetas completas"} de {golfInsights.scoreScopeHoles} hoyos; el resultado por hoyo considera {golfInsights.scoredRounds} {golfInsights.scoredRounds === 1 ? "ronda completa" : "rondas completas"}.</p>
        : <p className="hint">Las rondas sin tarjeta completa se conservan, pero no generan promedios.</p>}
    </section>}

    {view === "profile" && <section className="card"><div className="sectionTitle"><div><h2>Cuenta y privacidad</h2><p>Acceso, sincronización, documentos, preferencias y cierre de sesión.</p></div></div><button type="button" className="secondary big" onClick={onOpenAccount}>Abrir configuración de cuenta</button></section>}

    {view === "account" && <><section className="card"><h2>Documentos y consentimiento</h2><div className="documentConsentList">
      <Link href="/legal/terms?returnTo=account"><span>Términos de Uso</span><b>{acceptedLabel("terms")}</b></Link>
      <Link href="/legal/privacy?returnTo=account"><span>Aviso de Privacidad</span><b>{acceptedLabel("privacy")}</b></Link>
      <Link href="/legal/terms?returnTo=account#rules-referee"><span>Árbitro de Reglas</span><b>{acceptedLabel("rules_referee")}</b></Link>
      <div><span>Edad 18+</span><b>{acceptance("age_confirmation") ? "Confirmada" : "Pendiente"}</b></div>
      <div><span>Datos de apuestas, resultados y gastos</span><b>{bettingAcceptanceLabel}</b></div>
    </div></section>
    {!bettingConsentGranted && <section className="card"><h2>Funciones de apuestas</h2><p className="muted">Para activar o registrar apuestas, resultados y gastos necesitas otorgar el consentimiento específico. Las demás funciones y tus datos anteriores siguen disponibles.</p><button type="button" className="secondary" onClick={() => void requestBettingConsent()}>Revisar consentimiento específico</button></section>}

    {identity.mode === "authenticated" && <section className="card"><h2>Métodos de acceso</h2><div className="accessMethodList">{["google", "email"].map((provider) => <span key={provider}>{provider === "google" ? "Google" : "Correo"}<b>{identity.providers.includes(provider) || (provider === "email" && Boolean(identity.email)) ? "✓" : "—"}</b></span>)}</div><p className="hint">Tu cuenta conserva el mismo perfil tanto con Google como con código por correo.</p></section>}

    <section className="card"><h2>Preferencias</h2><label className="preferenceRow"><span>Alto contraste</span><input type="checkbox" checked={highContrast} onChange={(event) => onHighContrastChange(event.target.checked)} /></label><label className="preferenceRow"><span>Idioma</span><select value="es" disabled><option value="es">Español</option></select></label><label className="preferenceRow"><span><b>Avisos dentro de la app</b><small className="preferenceDescription">Notificaciones de actividad nueva en Social. No activa notificaciones push ni permisos del teléfono.</small></span><input type="checkbox" checked={notificationsEnabled} onChange={(event) => onNotificationsEnabledChange(event.target.checked)} aria-label="Activar avisos dentro de la app" /></label></section>

    <section className="card accountContactCard"><h2>Contacto</h2><div className="accountContacts"><a href={`mailto:${legalConfig.supportEmail}`}><span>Soporte</span><b>{legalConfig.supportEmail}</b></a><a href={`mailto:${legalConfig.privacyEmail}`}><span>Privacidad y ARCO</span><b>{legalConfig.privacyEmail}</b></a></div></section>

    <section className={`card accountSessionCard ${identity.mode === "guest" ? "single" : ""}`}><button className="secondary big" onClick={logout}>{identity.mode === "guest" ? "Salir del modo invitado" : "Cerrar sesión"}</button>{identity.mode === "authenticated" && <button className="dangerButton" onClick={() => setDeleteOpen(true)}>Eliminar cuenta</button>}</section>
    {message && <div className={messageKind === "error" ? "notice bad" : "notice"} role={messageKind === "error" ? "alert" : "status"}>{message}</div>}

    {deleteOpen && <div className="modalBackdrop"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-account-title"><h2 id="delete-account-title">Eliminar mi cuenta y mis datos</h2><p>Se eliminarán definitivamente tu usuario, datos de nube y fotos. También se limpiará el workspace local de esta cuenta; los datos de invitado y de otras cuentas no se tocarán. Escribe <b>ELIMINAR</b> para confirmar.</p>{(cloudStatus === "syncing" || cloudStatus === "saving") && <p role="status">Terminando el guardado actual antes de permitir la eliminación…</p>}<input aria-label="Confirmación de eliminación" value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder="ELIMINAR" autoComplete="off" /><div className="dialogActions"><button className="secondary" disabled={deletingAccount} onClick={() => { setDeleteOpen(false); setDeleteText(""); }}>Cancelar</button><button className="dangerButton" disabled={deleteText !== "ELIMINAR" || deletingAccount || cloudStatus === "syncing" || cloudStatus === "saving"} onClick={deleteAccount}>{deletingAccount ? "Eliminando…" : "Eliminar definitivamente"}</button></div></section></div>}
    </>}
  </>;
}
