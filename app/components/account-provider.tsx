"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
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

function AccessScreen({ onGuest, onAuthenticated }: { onGuest: () => void; onAuthenticated: (session: Session) => void }) {
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function social(provider: "google" | "apple") {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setMessage(`Acceso con ${provider === "google" ? "Google" : "Apple"} pendiente de configuración.`);
      return;
    }
    setBusy(true); setMessage("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
    } catch (error) {
      setMessage(authErrorMessage(error, provider));
      setBusy(false);
    }
  }

  async function sendCode() {
    if (!isValidEmail(email)) { setMessage("Escribe un correo electrónico válido."); return; }
    const supabase = getSupabaseBrowser();
    if (!supabase) { setMessage("Acceso con correo pendiente de configuración."); return; }
    setBusy(true); setMessage("");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setCodeSent(true);
      setMessage("Código enviado. Revisa tu correo.");
    } catch (error) {
      setMessage(authErrorMessage(error, "email"));
    } finally { setBusy(false); }
  }

  async function verifyCode() {
    if (otp.length !== 6) { setMessage("Introduce los 6 dígitos del código."); return; }
    const supabase = getSupabaseBrowser();
    if (!supabase) { setMessage("Acceso con correo pendiente de configuración."); return; }
    setBusy(true); setMessage("");
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: otp, type: "email" });
      if (error || !data.session) throw error || new Error("invalid otp");
      onAuthenticated(data.session);
    } catch (error) {
      setMessage(authErrorMessage(error, "otp"));
    } finally { setBusy(false); }
  }

  return <main className="accessScreen">
    <section className="accessCard">
      <BrandLockup />
      <p className="accessPromise">Tu juego. Tus grupos. Tus reglas. Tu historia.</p>
      {!emailMode ? <div className="accessActions">
        <button className="oauthButton apple" disabled={busy} onClick={() => social("apple")}>Continuar con Apple</button>
        <button className="oauthButton google" disabled={busy} onClick={() => social("google")}>Continuar con Google</button>
        <button className="secondary big" onClick={() => { setEmailMode(true); setMessage(""); }}>Continuar con correo</button>
        <button className="guestButton" onClick={onGuest}>Continuar como invitado</button>
      </div> : <div className="emailAccess">
        {!codeSent ? <>
          <label htmlFor="access-email">Correo electrónico</label>
          <input id="access-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" />
          <button className="primary big" disabled={busy} onClick={sendCode}>{busy ? "Enviando…" : "Enviar código"}</button>
          <button className="textButton" onClick={() => setEmailMode(false)}>← Volver</button>
        </> : <>
          <h2>Introduce el código que enviamos a tu correo</h2>
          <input className="otpInput" aria-label="Código de seis dígitos" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(normalizeOtp(event.target.value))} placeholder="6 dígitos" />
          <button className="primary big" disabled={busy || otp.length !== 6} onClick={verifyCode}>{busy ? "Verificando…" : "Verificar"}</button>
          <div className="otpLinks"><button className="textButton" disabled={busy} onClick={sendCode}>Reenviar código</button><button className="textButton" onClick={() => { setCodeSent(false); setOtp(""); setMessage(""); }}>Cambiar correo</button></div>
        </>}
      </div>}
      {message && <div className="accessMessage" role="status">{message}</div>}
      <p className="legalLead">Al continuar aceptas los <Link href="/legal/terms">Términos de Uso</Link> y el <Link href="/legal/privacy">Aviso de Privacidad</Link>.</p>
    </section>
  </main>;
}

function ConsentScreen({ onAccept, onBack }: { onAccept: () => Promise<void>; onBack: () => Promise<void> }) {
  const [rules, setRules] = useState(false);
  const [age, setAge] = useState(false);
  const [busy, setBusy] = useState(false);
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
    <button className="primary big" disabled={!rules || !age || busy} onClick={async () => { setBusy(true); try { await onAccept(); } finally { setBusy(false); } }}>{busy ? "Guardando…" : "Continuar"}</button>
    <button className="textButton consentBack" disabled={busy} onClick={onBack}>← Volver al acceso</button>
  </section></main>;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<BackyardIdentity | null>(null);
  const [acceptances, setAcceptances] = useState<LegalAcceptance[]>([]);
  const [accessRequested, setAccessRequested] = useState(false);
  const [showMigration, setShowMigration] = useState(false);
  const [cloudConsentChecked, setCloudConsentChecked] = useState(false);

  function activateSession(session: Session) {
    const profile = profileFromUser(session.user);
    setIdentity({ ...profile, mode: "authenticated", providers: session.user.app_metadata?.providers || [session.user.app_metadata?.provider].filter((value): value is string => Boolean(value)), accessToken: session.access_token });
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.mode, "authenticated");
    setCloudConsentChecked(false);
    const migrationDecision = localStorage.getItem(migrationDecisionStorageKey(session.user.id));
    setShowMigration(hasLocalGolfData(localStorage) && !migrationDecision);
  }

  useEffect(() => {
    const localAcceptances = parseLegalAcceptances(localStorage.getItem(ACCOUNT_STORAGE_KEYS.acceptances));
    setAcceptances(localAcceptances);
    const supabase = getSupabaseBrowser();
    let mounted = true;
    supabase?.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) activateSession(data.session);
      else if (localStorage.getItem(ACCOUNT_STORAGE_KEYS.mode) === "guest") {
        const profile = guestProfile();
        setIdentity({ ...profile, mode: "guest", providers: [], accessToken: null });
        setCloudConsentChecked(true);
      }
      setReady(true);
    }).catch(() => {
      if (!mounted) return;
      if (localStorage.getItem(ACCOUNT_STORAGE_KEYS.mode) === "guest") {
        const profile = guestProfile();
        setIdentity({ ...profile, mode: "guest", providers: [], accessToken: null });
        setCloudConsentChecked(true);
      }
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
      if (session) activateSession(session);
      else if (localStorage.getItem(ACCOUNT_STORAGE_KEYS.mode) !== "guest") setIdentity(null);
    });
    return () => { mounted = false; listener?.data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (identity?.mode !== "authenticated") return;
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    let mounted = true;
    Promise.all([
      supabase.from("legal_acceptances").select("user_id,type,version,accepted_at,locale").eq("user_id", identity.userId),
      supabase.from("profiles").select("display_name,avatar_url,default_handicap").eq("id", identity.userId).maybeSingle(),
    ]).then(([legalResult, profileResult]) => {
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
          defaultHandicap: typeof cloudProfile.default_handicap === "number" ? cloudProfile.default_handicap : current.defaultHandicap,
        }) : current);
      }
    }).catch(() => undefined).finally(() => { if (mounted) setCloudConsentChecked(true); });
    return () => { mounted = false; };
  }, [identity?.mode, identity?.userId]);

  const currentConsent = identity ? hasCurrentLegalConsent(acceptances, identity.userId) : false;

  async function acceptConsent() {
    if (!identity) return;
    const next = buildLegalAcceptances(identity.userId, new Date().toISOString());
    const merged = mergeLegalAcceptances(acceptances, next);
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(merged));
    setAcceptances(merged);
    if (identity.mode === "authenticated") {
      const supabase = getSupabaseBrowser();
      if (!supabase) return;
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
      await Promise.all(writes).catch(() => undefined);
    }
  }

  async function updateProfile(profile: Pick<BackyardProfile, "displayName" | "defaultHandicap" | "avatarUrl">) {
    if (!identity) return;
    const next = mergeBackyardProfile(identity, profile);
    setIdentity(next);
    localStorage.setItem(`backyard-profile-cache-v1:${identity.userId}`, JSON.stringify(profile));
    if (identity.mode === "guest") {
      localStorage.setItem(ACCOUNT_STORAGE_KEYS.guestProfile, JSON.stringify(profile));
      return;
    }
    const supabase = getSupabaseBrowser();
    const { error } = await supabase!.from("profiles").upsert({
      id: identity.userId,
      display_name: profile.displayName,
      default_handicap: profile.defaultHandicap,
      avatar_url: profile.avatarUrl || null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async function logout() {
    try {
      await getSupabaseBrowser()?.auth.signOut();
    } catch {
      // Local logout remains available if the network/provider is unavailable.
    } finally {
      localStorage.removeItem(ACCOUNT_STORAGE_KEYS.mode);
      setIdentity(null);
      setAccessRequested(false);
    }
  }

  async function keepLocalDataForAccount() {
    if (!identity) return;
    localStorage.setItem(migrationDecisionStorageKey(identity.userId), "link-later");
    const guestConsent = acceptances.filter((item) => item.userId === "guest");
    if (guestConsent.length && !hasCurrentLegalConsent(acceptances, identity.userId)) {
      const migrated = guestConsent.map((item) => ({ ...item, userId: identity.userId }));
      const merged = mergeLegalAcceptances(acceptances, migrated);
      localStorage.setItem(ACCOUNT_STORAGE_KEYS.acceptances, JSON.stringify(merged));
      setAcceptances(merged);
      if (identity.mode === "authenticated") {
        const supabase = getSupabaseBrowser();
        if (supabase) {
          const rulesAcceptance = migrated.find((item) => item.type === "rules_referee");
          const writes = [supabase.from("legal_acceptances").upsert(migrated.map((item) => ({ user_id: item.userId, type: item.type, version: item.documentVersion, accepted_at: item.acceptedAt, locale: item.locale })), { onConflict: "user_id,type,version", ignoreDuplicates: true })];
          if (rulesAcceptance) writes.push(supabase.from("rules_referee_acceptances").upsert({ user_id: rulesAcceptance.userId, document_version: rulesAcceptance.documentVersion, accepted_at: rulesAcceptance.acceptedAt, locale: rulesAcceptance.locale }, { onConflict: "user_id,document_version", ignoreDuplicates: true }));
          await Promise.all(writes).catch(() => undefined);
        }
      }
    }
    setShowMigration(false);
  }

  const context = identity ? ({ identity, updateProfile, logout, openAccess: () => setAccessRequested(true), acceptances }) : null;
  const migrationDialog = showMigration && <div className="modalBackdrop"><section className="confirmDialog migrationDialog" role="dialog" aria-modal="true" aria-labelledby="migration-title">
    <h2 id="migration-title">Encontramos datos de The Backyard en este dispositivo.</h2>
    <p>Nada se borrará ni se duplicará. Puedes conservarlos para vincularlos cuando la sincronización de nube esté activa.</p>
    <div className="migrationActions"><button className="primary" onClick={keepLocalDataForAccount}>Conservar y vincular a mi cuenta</button><button className="secondary" onClick={() => { if (identity) localStorage.setItem(migrationDecisionStorageKey(identity.userId), "skip"); setShowMigration(false); }}>Continuar sin importar por ahora</button></div>
  </section></div>;

  if (!ready) return <main className="accessScreen"><div className="accessLoading">Cargando The Backyard…</div></main>;
  if (!identity || accessRequested) return <AccessScreen onGuest={() => {
    const profile = guestProfile();
    localStorage.setItem(ACCOUNT_STORAGE_KEYS.mode, "guest");
    setIdentity({ ...profile, mode: "guest", providers: [], accessToken: null });
    setCloudConsentChecked(true);
    setAccessRequested(false);
  }} onAuthenticated={(session) => { activateSession(session); setAccessRequested(false); }} />;
  if (identity.mode === "authenticated" && !currentConsent && !cloudConsentChecked) return <main className="accessScreen"><div className="accessLoading">Verificando tus consentimientos…</div></main>;
  if (!currentConsent) {
    if (migrationDialog && hasCurrentLegalConsent(acceptances, "guest")) return <main className="accessScreen">{migrationDialog}</main>;
    return <ConsentScreen onAccept={acceptConsent} onBack={logout} />;
  }

  return <AccountContext.Provider value={context!}>
    {children}
    {migrationDialog}
  </AccountContext.Provider>;
}
