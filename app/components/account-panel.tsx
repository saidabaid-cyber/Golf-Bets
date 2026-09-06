"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LEGAL_DOCUMENT_VERSIONS, legalConfig } from "../../lib/legal-config";
import { BETTING_DATA_CONSENT_TYPE, emptyBackyardProfileDetails, profileHandicapInput, profileHandicapLabel, validateProfileAvatarUrl, validateProfileDraft, type BackyardProfile, type BackyardProfileDetails } from "../../lib/account-state";
import type { GolfInsights } from "../../lib/golf-insights";
import { useBackyardAccount } from "./account-provider";

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
    bio: profile.bio || defaults.bio,
    profileVisibility: profile.profileVisibility || defaults.profileVisibility,
  };
}

export function AccountPanel({ view, highContrast, onHighContrastChange, notificationsEnabled, onNotificationsEnabledChange, golfInsights, onOpenStats, onOpenAccount }: AccountPanelProps) {
  const { identity, updateProfile, logout, finishAccountDeletion, openAccess, acceptances, bettingConsentGranted, requestBettingConsent, cloudLinked, cloudStatus, requestCloudLink, lastCloudSync, cloudIssues, retryCloudSync } = useBackyardAccount();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(identity.displayName);
  const [handicap, setHandicap] = useState(profileHandicapInput(identity.defaultHandicap));
  const [avatarUrl, setAvatarUrl] = useState(identity.avatarUrl);
  const [profileDetails, setProfileDetails] = useState<ProfileDetailsDraft>(() => profileDetailsDraft(identity));
  const [message, setMessage] = useState("");
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
    if (!validation.ok) { setMessage(validation.message); return; }
    const avatarValidation = validateProfileAvatarUrl(avatarUrl);
    if (!avatarValidation.ok) { setMessage(avatarValidation.message); return; }
    setSavingProfile(true); setMessage("");
    try {
      const result = await updateProfile({ displayName: validation.displayName, defaultHandicap: validation.defaultHandicap, avatarUrl: avatarValidation.avatarUrl, ...profileDetails });
      setEditing(false);
      setMessage(result === "cloud" ? "Nombre, avatar y HCP sincronizados. Los datos ampliados se guardaron en este dispositivo." : "Perfil actualizado en este dispositivo. Los datos ampliados quedan pendientes de sincronización Beta.");
    } catch { setMessage("No se confirmó el guardado del perfil. Conservamos lo que escribiste; reintenta."); }
    finally { setSavingProfile(false); }
  }

  async function deleteAccount() {
    if (identity.mode === "guest") { setMessage("El modo invitado no tiene una cuenta de nube. Puedes borrar cada ronda e histórico desde la app o los datos del sitio desde el navegador."); setDeleteOpen(false); return; }
    setDeletingAccount(true); setMessage("");
    try {
      const response = await fetch("/api/account/delete", { method: "DELETE", headers: { authorization: `Bearer ${identity.accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ confirmation: "ELIMINAR" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "delete failed");
      await finishAccountDeletion();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se completó la eliminación. La cuenta sigue activa; reintenta."); setDeleteOpen(false); }
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

    {view === "profile" && <section className="card profileCard">
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
        {identity.bio && <p className="profileBio">{identity.bio}</p>}
        <p className="hint">The Backyard guarda el valor que capturas; no emite ni certifica un handicap oficial.</p>
      </div>}
    </section>}

    {view === "profile" && message && <div className="notice" role="status">{message}</div>}

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
    {message && <div className="notice" role="status">{message}</div>}

    {deleteOpen && <div className="modalBackdrop"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-account-title"><h2 id="delete-account-title">Eliminar mi cuenta y mis datos</h2><p>Se eliminarán definitivamente tu usuario, datos de nube y fotos. También se limpiará el workspace local de esta cuenta; los datos de invitado y de otras cuentas no se tocarán. Escribe <b>ELIMINAR</b> para confirmar.</p><input aria-label="Confirmación de eliminación" value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder="ELIMINAR" autoComplete="off" /><div className="dialogActions"><button className="secondary" disabled={deletingAccount} onClick={() => { setDeleteOpen(false); setDeleteText(""); }}>Cancelar</button><button className="dangerButton" disabled={deleteText !== "ELIMINAR" || deletingAccount} onClick={deleteAccount}>{deletingAccount ? "Eliminando…" : "Eliminar definitivamente"}</button></div></section></div>}
    </>}
  </>;
}
