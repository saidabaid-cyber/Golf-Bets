"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LEGAL_DOCUMENT_VERSIONS, legalConfig } from "../../lib/legal-config";
import { profileHandicapInput, profileHandicapLabel, validateProfileDraft } from "../../lib/account-state";
import { useBackyardAccount } from "./account-provider";

export function AccountPanel({ highContrast, onHighContrastChange }: { highContrast: boolean; onHighContrastChange: (value: boolean) => void }) {
  const { identity, updateProfile, logout, finishAccountDeletion, openAccess, acceptances, cloudLinked, cloudStatus, requestCloudLink, lastCloudSync, cloudIssues, retryCloudSync } = useBackyardAccount();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(identity.displayName);
  const [handicap, setHandicap] = useState(profileHandicapInput(identity.defaultHandicap));
  const [message, setMessage] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const sessionExpired = cloudIssues.some((issue) => issue.kind === "session_expired");

  useEffect(() => { if (!editing) { setName(identity.displayName); setHandicap(profileHandicapInput(identity.defaultHandicap)); } }, [identity.displayName, identity.defaultHandicap, editing]);
  const userAcceptances = useMemo(() => acceptances.filter((item) => item.userId === identity.userId), [acceptances, identity.userId]);
  const acceptance = (type: keyof typeof LEGAL_DOCUMENT_VERSIONS) => userAcceptances.find((item) => item.type === type);
  const acceptedLabel = (type: keyof typeof LEGAL_DOCUMENT_VERSIONS) => {
    const record = acceptance(type);
    return record ? `v. ${record.documentVersion} · ${new Date(record.acceptedAt).toLocaleDateString("es-MX")}` : "Pendiente";
  };

  async function saveProfile() {
    const validation = validateProfileDraft(name, handicap);
    if (!validation.ok) { setMessage(validation.message); return; }
    setSavingProfile(true); setMessage("");
    try {
      await updateProfile({ displayName: validation.displayName, defaultHandicap: validation.defaultHandicap, avatarUrl: identity.avatarUrl });
      setEditing(false); setMessage("Perfil actualizado.");
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
    <section className="hero accountHero"><div><div className="eyebrow">THE BACKYARD ACCOUNT</div><h1>Mi Cuenta</h1><p>{identity.mode === "guest" ? "Estás usando The Backyard como invitado." : "Tu identidad para los juegos y futuros deportes de The Backyard."}</p></div></section>

    {identity.mode === "guest" && <section className="card guestAccountCard"><h2>Modo invitado</h2><p>Los datos permanecen en este dispositivo. Crear una cuenta permitirá sincronizar tu información cuando la nube esté activada.</p><div className="accountInlineActions"><button className="primary" onClick={openAccess}>Crear cuenta</button><button className="secondary" onClick={openAccess}>Iniciar sesión</button></div></section>}

    {identity.mode === "authenticated" && <section className="card cloudAccountStatus" aria-label="Estado de la cuenta">
      <h2>{sessionExpired ? "Datos disponibles en este dispositivo" : "Sesión iniciada"}</h2>
      <p role="status">{cloudStatus === "synced" ? "Guardado en la nube ✓" : cloudStatus === "syncing" ? "Sincronizando con la nube…" : cloudStatus === "saving" ? "Guardando en este dispositivo…" : cloudStatus === "offline" ? "Sin conexión · Pendiente de sincronizar" : cloudStatus === "error" ? "Error de sincronización · Tu copia local se conserva" : cloudLinked ? "Pendiente de sincronizar" : "Guardado en este dispositivo · Nube sin vincular"}</p>
      {lastCloudSync && <p className="hint">Última sincronización confirmada: {new Date(lastCloudSync).toLocaleString("es-MX")}</p>}
      {cloudIssues.map((issue) => <p className={issue.kind === "offline" || issue.kind === "conflict" ? "hint" : "bad"} key={issue.domain}><b>{issue.domain === "auth" ? "Sesión" : issue.domain === "profile" ? "Perfil" : issue.domain === "legal" ? "Consentimientos" : issue.domain === "files" ? "Archivos" : issue.domain === "conflict" ? "Conflicto" : "Ronda"}:</b> {issue.message}</p>)}
      {cloudLinked && !sessionExpired && <button className="secondary" disabled={cloudStatus === "syncing" || cloudStatus === "saving"} onClick={() => void retryCloudSync()}>Reintentar sincronización</button>}
      {sessionExpired && <button className="primary" onClick={openAccess}>Volver a iniciar sesión</button>}
    </section>}
    {identity.mode === "authenticated" && !cloudLinked && <section className="card"><h2>Sincronización</h2><p>Tus datos siguen seguros en este dispositivo. Puedes vincularlos a tu cuenta cuando la nube esté configurada.</p><button className="primary" onClick={requestCloudLink}>Vincular datos locales</button></section>}

    <section className="card profileCard">
      <div className="sectionTitle"><div className="profileIdentity"><div className="accountAvatar">{identity.avatarUrl ? <img src={identity.avatarUrl} alt="Avatar" /> : (identity.displayName.trim()[0] || "J").toUpperCase()}</div><div><h2>{identity.displayName}</h2><p>{identity.email || "Sin correo · Invitado"}</p></div></div><button className="secondary" onClick={() => setEditing((value) => !value)}>{editing ? "Cancelar" : "Editar"}</button></div>
      {editing && <div className="profileForm"><label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" /></label><label>HCP Index (opcional)<input type="text" inputMode="decimal" value={handicap} onChange={(event) => setHandicap(event.target.value)} placeholder="Ej. 8.4 o +1.2" /></label><button className="primary" disabled={savingProfile} onClick={saveProfile}>{savingProfile ? "Guardando…" : "Guardar perfil"}</button></div>}
      {!editing && <div className="profileMeta"><span>HCP Index</span><b>{profileHandicapLabel(identity.defaultHandicap)}</b></div>}
    </section>

    <section className="card"><h2>Documentos y consentimiento</h2><div className="documentConsentList">
      <Link href="/legal/terms?returnTo=account"><span>Términos de Uso</span><b>{acceptedLabel("terms")}</b></Link>
      <Link href="/legal/privacy?returnTo=account"><span>Aviso de Privacidad</span><b>{acceptedLabel("privacy")}</b></Link>
      <Link href="/legal/terms?returnTo=account#rules-referee"><span>Árbitro de Reglas</span><b>{acceptedLabel("rules_referee")}</b></Link>
      <div><span>Edad 18+</span><b>{acceptance("age_confirmation") ? "Confirmada" : "Pendiente"}</b></div>
    </div></section>

    <section className="card"><h2>Métodos de acceso</h2>{identity.mode === "guest" ? <p className="muted">Invitado local · sin proveedor vinculado</p> : <div className="accessMethodList">{["google", "email"].map((provider) => <span key={provider}>{provider === "google" ? "Google" : "Correo"}<b>{identity.providers.includes(provider) || (provider === "email" && Boolean(identity.email)) ? "✓" : "—"}</b></span>)}</div>}<p className="hint">Tu cuenta conserva el mismo perfil tanto con Google como con código por correo.</p></section>

    <section className="card"><h2>Preferencias</h2><label className="preferenceRow"><span>Alto contraste</span><input type="checkbox" checked={highContrast} onChange={(event) => onHighContrastChange(event.target.checked)} /></label><label className="preferenceRow"><span>Idioma</span><select value="es" disabled><option value="es">Español</option></select></label><label className="preferenceRow"><span>Notificaciones</span><select value="future" disabled><option value="future">Próximamente</option></select></label></section>

    <section className="card accountContactCard"><h2>Contacto</h2><div className="accountContacts"><a href={`mailto:${legalConfig.supportEmail}`}><span>Soporte</span><b>{legalConfig.supportEmail}</b></a><a href={`mailto:${legalConfig.privacyEmail}`}><span>Privacidad y ARCO</span><b>{legalConfig.privacyEmail}</b></a></div></section>

    <section className={`card accountSessionCard ${identity.mode === "guest" ? "single" : ""}`}><button className="secondary big" onClick={logout}>{identity.mode === "guest" ? "Salir del modo invitado" : "Cerrar sesión"}</button>{identity.mode === "authenticated" && <button className="dangerButton" onClick={() => setDeleteOpen(true)}>Eliminar cuenta</button>}</section>
    {message && <div className="notice" role="status">{message}</div>}

    {deleteOpen && <div className="modalBackdrop"><section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="delete-account-title"><h2 id="delete-account-title">Eliminar mi cuenta y mis datos</h2><p>Se eliminarán definitivamente tu usuario, datos de nube y fotos. También se limpiará el workspace local de esta cuenta; los datos de invitado y de otras cuentas no se tocarán. Escribe <b>ELIMINAR</b> para confirmar.</p><input aria-label="Confirmación de eliminación" value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder="ELIMINAR" autoComplete="off" /><div className="dialogActions"><button className="secondary" disabled={deletingAccount} onClick={() => { setDeleteOpen(false); setDeleteText(""); }}>Cancelar</button><button className="dangerButton" disabled={deleteText !== "ELIMINAR" || deletingAccount} onClick={deleteAccount}>{deletingAccount ? "Eliminando…" : "Eliminar definitivamente"}</button></div></section></div>}
  </>;
}
