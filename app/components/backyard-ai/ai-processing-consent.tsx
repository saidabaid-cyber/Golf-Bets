"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModalCloseButton } from "../modal-shell";

import {
  acceptRemoteAiProcessingConsent,
  beginAiProcessingConsentMutation,
  RemoteAiProcessingConsentError,
  resolveAuthoritativeAiProcessingConsent,
  revokeRemoteAiProcessingConsent,
} from "../../../lib/backyard-ai/consent-client";
import {
  acceptAiProcessingConsent,
  AI_PROCESSING_CONSENT_UPDATED_EVENT,
  browserAiProcessingConsentStorage,
  readAiProcessingConsent,
  revokeAiProcessingConsent,
  type AiProcessingConsent,
} from "../../../lib/backyard-ai/processing-consent";
import {
  AI_IMAGE_PROCESSING_CONSENT,
  AI_PROVIDER_PROCESSING_CONSENT,
  BACKYARD_AI_PROVIDER_CONSENT_VERSION,
  type BackyardAiProcessingConsentScope,
} from "../../../lib/backyard-ai/privacy";

const SCOPES: readonly BackyardAiProcessingConsentScope[] = [
  AI_PROVIDER_PROCESSING_CONSENT,
  AI_IMAGE_PROCESSING_CONSENT,
];

const SCOPE_COPY: Record<BackyardAiProcessingConsentScope, { title: string; detail: string }> = {
  [AI_PROVIDER_PROCESSING_CONSENT]: {
    title: "Instrucciones de ronda",
    detail: "Permite enviar a Backyard AI el texto o dictado que decidas procesar.",
  },
  [AI_IMAGE_PROCESSING_CONSENT]: {
    title: "Fotografías de scorecard",
    detail: "Permite enviar al proveedor las fotos que elijas para leer una tarjeta.",
  },
};

type ScopeState = {
  active: boolean;
  acceptedAt: string | null;
  checking: boolean;
  pendingRemoteRevocation: boolean;
};

function emptyScopeState(checking = false): ScopeState {
  return { active: false, acceptedAt: null, checking, pendingRemoteRevocation: false };
}

function localScopeState(userId: string, scope: BackyardAiProcessingConsentScope): ScopeState {
  try {
    const consent = readAiProcessingConsent(browserAiProcessingConsentStorage(), userId, scope);
    return {
      active: consent?.revokedAt === null,
      acceptedAt: consent?.acceptedAt ?? null,
      checking: false,
      pendingRemoteRevocation: false,
    };
  } catch {
    return emptyScopeState();
  }
}

function acceptedLabel(acceptedAt: string | null) {
  if (!acceptedAt) return "Vigente";
  const date = new Date(acceptedAt);
  return Number.isNaN(date.getTime())
    ? "Vigente"
    : `Vigente desde ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date)}`;
}

function ephemeralConsent(
  userId: string,
  scope: BackyardAiProcessingConsentScope,
  acceptedAt: string,
): AiProcessingConsent {
  return {
    schemaVersion: 1,
    userId,
    policyVersion: BACKYARD_AI_PROVIDER_CONSENT_VERSION,
    acceptedAt,
    revokedAt: null,
    scope,
  };
}

export function aiProcessingConsentFailureMessage(reason: unknown, authenticated: boolean) {
  if (reason instanceof RemoteAiProcessingConsentError) {
    if (reason.code === "consent_environment_blocked") {
      return "Este Preview no tiene un registro de autorizaciones aislado conectado. No se envió ningún contenido a la IA.";
    }
    if (reason.code === "consent_store_unavailable" || reason.code === "missing_config") {
      return "El registro seguro de autorizaciones no está disponible en este Preview. No se envió ningún contenido a la IA.";
    }
    if (reason.status === 401 || reason.code === "auth_required") {
      return "Tu sesión terminó antes de guardar la autorización. Vuelve a iniciar sesión; no se envió ningún contenido a la IA.";
    }
    return `${reason.message} No se envió ningún contenido a la IA.`;
  }
  return authenticated
    ? "No pude guardar la autorización en tu cuenta. No se envió ningún contenido; inténtalo de nuevo."
    : "No pude guardar la autorización en este dispositivo. Revisa el almacenamiento privado del navegador; no se envió ningún contenido.";
}

export type AiProcessingConsentPromptProps = {
  userId: string;
  accessToken?: string | null;
  requiresRemoteConsent: boolean;
  scope: BackyardAiProcessingConsentScope;
  onAccepted: (consent: AiProcessingConsent, result: { accountPersisted: boolean; localPersisted: boolean }) => void;
  onCancel: () => void;
};

/**
 * The only UI that creates a processing-consent acceptance. Merely mounting,
 * checking or using an already-authorized feature never sends a POST.
 */
export function AiProcessingConsentPrompt({ userId, accessToken, requiresRemoteConsent, scope, onAccepted, onCancel }: AiProcessingConsentPromptProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [checking, setChecking] = useState(Boolean(accessToken));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checkGeneration = useRef(0);
  const checkAbort = useRef<AbortController | null>(null);
  const acceptGeneration = useRef(0);
  const acceptAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const acceptedCallback = useRef(onAccepted);

  useEffect(() => {
    acceptedCallback.current = onAccepted;
  }, [onAccepted]);

  useEffect(() => {
    acceptAbort.current?.abort();
    acceptAbort.current = null;
    acceptGeneration.current += 1;
    setBusy(false);
    setConfirmed(false);
  }, [accessToken, scope, userId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      checkAbort.current?.abort();
      acceptAbort.current?.abort();
      checkGeneration.current += 1;
      acceptGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!accessToken) {
      setChecking(false);
      setError(requiresRemoteConsent
        ? "Tu cuenta necesita recuperar la sesión para guardar o verificar esta autorización. No se enviará ningún contenido mientras tanto."
        : "");
      return;
    }
    const generation = ++checkGeneration.current;
    checkAbort.current?.abort();
    const controller = new AbortController();
    checkAbort.current = controller;
    setChecking(true);
    setError("");
    void resolveAuthoritativeAiProcessingConsent({
      accessToken,
      storage: browserAiProcessingConsentStorage(),
      userId,
      scope,
      signal: controller.signal,
    }).then((result) => {
      if (controller.signal.aborted || generation !== checkGeneration.current || result.discarded) return;
      if (result.active && result.consent && !result.pendingLocalRevocation) {
        acceptedCallback.current(result.consent, { accountPersisted: true, localPersisted: result.cachePersisted });
      } else if (result.pendingLocalRevocation) {
        setError("Esta autorización fue revocada en este dispositivo y todavía no se ha sincronizado. Puedes aceptarla de nuevo de forma explícita o reintentar la revocación en Perfil.");
      }
    }).catch((reason: unknown) => {
      if (controller.signal.aborted || generation !== checkGeneration.current || (reason instanceof DOMException && reason.name === "AbortError")) return;
      setError("No pude verificar la autorización guardada. Puedes volver a aceptarla explícitamente para reintentar.");
    }).finally(() => {
      if (!controller.signal.aborted && generation === checkGeneration.current) setChecking(false);
    });
    return () => {
      controller.abort();
      if (generation === checkGeneration.current) checkGeneration.current += 1;
    };
  }, [accessToken, requiresRemoteConsent, scope, userId]);

  async function accept() {
    if (!confirmed || busy || checking) return;
    if (requiresRemoteConsent && !accessToken) {
      setError("Tu cuenta necesita recuperar la sesión antes de autorizar el procesamiento. No se envió ningún contenido.");
      return;
    }
    setBusy(true);
    setError("");
    checkAbort.current?.abort();
    checkGeneration.current += 1;
    acceptAbort.current?.abort();
    const controller = new AbortController();
    acceptAbort.current = controller;
    const generation = ++acceptGeneration.current;
    const isCurrent = () => mounted.current && !controller.signal.aborted && generation === acceptGeneration.current;
    try {
      if (accessToken) {
        const remote = await acceptRemoteAiProcessingConsent(accessToken, userId, scope, controller.signal);
        if (!isCurrent()) return;
        if (!remote.active || !remote.acceptedAt || remote.revokedAt !== null) {
          throw new Error("remote_consent_not_active");
        }
        const cached = acceptAiProcessingConsent(browserAiProcessingConsentStorage(), userId, scope, remote.acceptedAt);
        if (!isCurrent()) return;
        acceptedCallback.current(cached.ok ? cached.consent : ephemeralConsent(userId, scope, remote.acceptedAt), {
          accountPersisted: true,
          localPersisted: cached.ok && cached.persisted,
        });
        return;
      }
      const local = acceptAiProcessingConsent(browserAiProcessingConsentStorage(), userId, scope);
      if (!local.ok) throw new Error(local.error);
      if (!isCurrent()) return;
      acceptedCallback.current(local.consent, { accountPersisted: false, localPersisted: local.persisted });
    } catch (reason: unknown) {
      if (!isCurrent() || (reason instanceof DOMException && reason.name === "AbortError")) return;
      setError(aiProcessingConsentFailureMessage(reason, Boolean(accessToken)));
      setBusy(false);
    } finally {
      if (acceptAbort.current === controller) acceptAbort.current = null;
    }
  }

  const copy = SCOPE_COPY[scope];
  return <div className="modalBackdrop">
    <section className="confirmDialog" role="dialog" aria-modal="true" aria-labelledby="ai-processing-consent-title" aria-busy={checking || busy}>
      <ModalCloseButton onClose={onCancel} disabled={busy} />
      <h2 id="ai-processing-consent-title">Autorizar procesamiento con IA</h2>
      <p><b>{copy.title}.</b> {copy.detail}</p>
      <p>El proveedor procesa únicamente el contenido que envíes al usar esta función. No autoriza datos de apuestas, memoria personal ni uso para entrenamiento global.</p>
      <label className="consentCheck">
        <input type="checkbox" checked={confirmed} disabled={checking || busy} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>Acepto el procesamiento descrito para esta función bajo la versión {BACKYARD_AI_PROVIDER_CONSENT_VERSION}.</span>
      </label>
      <p className="legalLead">Puedes revocar esta autorización en Perfil → Privacidad / IA. Consulta el <Link href="/legal/privacy">Aviso de Privacidad</Link>.</p>
      {checking && <p role="status">Verificando tu autorización…</p>}
      {error && <div className="notice bad" role="alert">{error}</div>}
      <div className="dialogActions">
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Ahora no</button>
        <button type="button" className="primary" disabled={!confirmed || checking || busy || (requiresRemoteConsent && !accessToken)} onClick={() => void accept()}>{busy ? "Guardando…" : "Aceptar y continuar"}</button>
      </div>
    </section>
  </div>;
}

export type AiProcessingConsentSettingsProps = {
  userId: string;
  accessToken?: string | null;
  requiresRemoteConsent: boolean;
};

export function AiProcessingConsentSettings({ userId, accessToken, requiresRemoteConsent }: AiProcessingConsentSettingsProps) {
  const [states, setStates] = useState<Record<BackyardAiProcessingConsentScope, ScopeState>>(() => ({
    [AI_PROVIDER_PROCESSING_CONSENT]: typeof window === "undefined" || accessToken || requiresRemoteConsent
      ? emptyScopeState(Boolean(accessToken))
      : localScopeState(userId, AI_PROVIDER_PROCESSING_CONSENT),
    [AI_IMAGE_PROCESSING_CONSENT]: typeof window === "undefined" || accessToken || requiresRemoteConsent
      ? emptyScopeState(Boolean(accessToken))
      : localScopeState(userId, AI_IMAGE_PROCESSING_CONSENT),
  }));
  const [busyScope, setBusyScope] = useState<BackyardAiProcessingConsentScope | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"status" | "error">("status");
  const generations = useRef<Record<BackyardAiProcessingConsentScope, number>>({
    [AI_PROVIDER_PROCESSING_CONSENT]: 0,
    [AI_IMAGE_PROCESSING_CONSENT]: 0,
  });
  const aborts = useRef<Partial<Record<BackyardAiProcessingConsentScope, AbortController>>>({});

  const setScopeState = useCallback((scope: BackyardAiProcessingConsentScope, next: ScopeState) => {
    setStates((current) => ({ ...current, [scope]: next }));
  }, []);

  const invalidateScopeRead = useCallback((scope: BackyardAiProcessingConsentScope) => {
    generations.current[scope] += 1;
    aborts.current[scope]?.abort();
    delete aborts.current[scope];
    beginAiProcessingConsentMutation(userId, scope);
  }, [userId]);

  const loadScope = useCallback(async (scope: BackyardAiProcessingConsentScope) => {
    const generation = ++generations.current[scope];
    aborts.current[scope]?.abort();
    const controller = new AbortController();
    aborts.current[scope] = controller;
    setStates((current) => ({ ...current, [scope]: { ...current[scope], checking: true } }));
    try {
      if (!accessToken) {
        if (!controller.signal.aborted && generation === generations.current[scope]) {
          setScopeState(scope, requiresRemoteConsent ? emptyScopeState() : localScopeState(userId, scope));
          if (requiresRemoteConsent) {
            setMessageKind("error");
            setMessage("No pude verificar las autorizaciones de IA porque la sesión de tu cuenta no está disponible. Las funciones permanecen bloqueadas.");
          }
        }
        return;
      }
      const result = await resolveAuthoritativeAiProcessingConsent({
        accessToken,
        storage: browserAiProcessingConsentStorage(),
        userId,
        scope,
        signal: controller.signal,
      });
      if (controller.signal.aborted || generation !== generations.current[scope] || result.discarded) return;
      setScopeState(scope, {
        active: result.active && !result.pendingLocalRevocation,
        acceptedAt: result.consent?.acceptedAt ?? result.acceptedAt,
        checking: false,
        pendingRemoteRevocation: result.pendingLocalRevocation,
      });
    } catch (reason: unknown) {
      if (controller.signal.aborted || generation !== generations.current[scope] || (reason instanceof DOMException && reason.name === "AbortError")) return;
      setStates((current) => ({
        ...current,
        [scope]: { ...emptyScopeState(), pendingRemoteRevocation: current[scope].pendingRemoteRevocation },
      }));
      setMessageKind("error");
      setMessage("No pude verificar una autorización de IA en tu cuenta. Se mantiene desactivada hasta poder consultar el registro seguro.");
    } finally {
      if (!controller.signal.aborted && generation === generations.current[scope]) {
        setStates((current) => ({ ...current, [scope]: { ...current[scope], checking: false } }));
      }
    }
  }, [accessToken, requiresRemoteConsent, setScopeState, userId]);

  const loadAll = useCallback(() => {
    void Promise.allSettled(SCOPES.map((scope) => loadScope(scope)));
  }, [loadScope]);

  useEffect(() => {
    const generationCounters = generations.current;
    const controllers = aborts.current;
    loadAll();
    function refresh(event: Event) {
      const consent = (event as CustomEvent<AiProcessingConsent>).detail;
      if (consent?.userId === userId && SCOPES.includes(consent.scope)) void loadScope(consent.scope);
    }
    function refreshFromStorage() { loadAll(); }
    window.addEventListener(AI_PROCESSING_CONSENT_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refreshFromStorage);
    return () => {
      window.removeEventListener(AI_PROCESSING_CONSENT_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refreshFromStorage);
      for (const scope of SCOPES) {
        generationCounters[scope] += 1;
        controllers[scope]?.abort();
      }
    };
  }, [loadAll, loadScope, userId]);

  async function revoke(scope: BackyardAiProcessingConsentScope) {
    if (busyScope) return;
    invalidateScopeRead(scope);
    const now = new Date().toISOString();
    const known = states[scope];
    try {
      const storage = browserAiProcessingConsentStorage();
      let existing = readAiProcessingConsent(storage, userId, scope);
      if (!existing && known.acceptedAt) {
        const seeded = acceptAiProcessingConsent(storage, userId, scope, known.acceptedAt);
        existing = seeded.ok ? seeded.consent : null;
      }
      if (existing?.revokedAt === null) revokeAiProcessingConsent(storage, userId, scope, now);
    } catch {
      // Remote remains the authenticated authority; the UI still fails closed
      // while the explicit revocation request is in progress.
    }
    setScopeState(scope, { active: false, acceptedAt: known.acceptedAt, checking: false, pendingRemoteRevocation: Boolean(accessToken) || requiresRemoteConsent });
    setBusyScope(scope);
    setMessage("");
    try {
      if (accessToken) {
        const remote = await revokeRemoteAiProcessingConsent(accessToken, userId, scope);
        if (remote.active || !remote.revokedAt) throw new Error("remote_revocation_not_confirmed");
        revokeAiProcessingConsent(browserAiProcessingConsentStorage(), userId, scope, remote.revokedAt);
      } else if (requiresRemoteConsent) {
        throw new Error("authenticated_session_missing");
      }
      setScopeState(scope, { active: false, acceptedAt: known.acceptedAt, checking: false, pendingRemoteRevocation: false });
      setMessageKind("status");
      setMessage("Autorización revocada. La aceptación original se conserva únicamente como registro auditable.");
    } catch {
      setScopeState(scope, { active: false, acceptedAt: known.acceptedAt, checking: false, pendingRemoteRevocation: Boolean(accessToken) || requiresRemoteConsent });
      setMessageKind("error");
      setMessage(accessToken || requiresRemoteConsent
        ? "La función quedó bloqueada en este dispositivo, pero no pude confirmar la revocación en tu cuenta. Usa Reintentar revocación cuando recuperes conexión."
        : "No pude guardar la revocación en este dispositivo. Inténtalo de nuevo.");
    } finally {
      setBusyScope(null);
    }
  }

  return <section className="card" aria-labelledby="ai-privacy-settings-title">
    <div className="sectionTitle"><div><h2 id="ai-privacy-settings-title">Privacidad / IA</h2><p>Autorizaciones versionadas e independientes para procesar instrucciones y fotos.</p></div></div>
    <div className="documentConsentList">
      {SCOPES.map((scope) => {
        const state = states[scope];
        const copy = SCOPE_COPY[scope];
        return <div key={scope}>
          <span><b>{copy.title}</b><small className="preferenceDescription">{copy.detail}</small></span>
          <span>
            <b>{state.checking ? "Verificando…" : state.pendingRemoteRevocation ? "Revocación pendiente" : state.active ? acceptedLabel(state.acceptedAt) : "No autorizada"}</b>
            {(state.active || state.pendingRemoteRevocation) && <button type="button" className="textButton" disabled={Boolean(busyScope) || state.checking} onClick={() => void revoke(scope)}>{busyScope === scope ? "Revocando…" : state.pendingRemoteRevocation ? "Reintentar revocación" : "Revocar"}</button>}
          </span>
        </div>;
      })}
    </div>
    <p className="hint">No autoriza datos de apuestas, memoria personal ni uso para entrenamiento global. Esos permisos son separados y opcionales.</p>
    {message && <div className={messageKind === "error" ? "notice bad" : "notice"} role={messageKind === "error" ? "alert" : "status"}>{message}</div>}
  </section>;
}
