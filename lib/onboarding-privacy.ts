import { requestOptionalAuthorizationState, saveOptionalAuthorizationScope, type OptionalAuthorizationState } from "./account-optional-authorizations";
import { acceptRemoteAiProcessingConsent, revokeRemoteAiProcessingConsent, saveRemoteAiConsentDecisions } from "./backyard-ai/consent-client";
import { requestAccountNotificationPreferences } from "./account-notification-preferences";
import { legalEvidenceDefinition } from "./legal-evidence";
import { socialRequest } from "./social-activity-client";
import { requestAccountDeviceMediaPreferences, type AccountDeviceMediaPreferences } from "./account-device-permission-preferences";

export const PRIVACY_GROUPS = [
  { title: "Funciones del dispositivo", choices: [
    ["location", "Ubicación", "Buscar campos cercanos. El permiso del dispositivo se solicita por separado."],
    ["camera", "Cámara", "Permite tomar fotos o videos cuando tú decidas usar una función que lo requiera. El permiso del sistema se solicitará al usarla."],
    ["photos", "Fotos / Fototeca", "Elige únicamente las fotos o videos que quieras compartir con The Backyard. Se abrirá el selector cuando tú decidas elegirlos."],
    ["notifications", "Avisos en The Backyard", "Permitir avisos de cuenta; no garantiza entrega push o correo."],
    ["push", "Push", "Preferencia de cuenta. Requiere permiso del dispositivo y proveedor disponible."],
    ["email", "Email de cuenta", "Avisos operativos, separados del marketing."],
    ["rounds", "Avisos de rondas", "Actualizaciones sobre tus rondas."],
    ["reminders", "Recordatorios", "Recordatorios de tu actividad."],
  ] },
  { title: "Experiencia The Backyard", choices: [
    ["sharing", "Actividad con amigos", "Permitir que tus amigos vean las actividades seleccionadas a continuación. Sin ubicación en tiempo real."],
    ["shareRounds", "Compartir rondas terminadas", "Sólo con tus amigos y cuando permitas compartir actividad."],
    ["shareAchievements", "Compartir logros", "Sólo con tus amigos."],
    ["shareEquipment", "Compartir cambios de equipo", "Sólo con tus amigos."],
    ["shareCourses", "Compartir campos jugados", "Sólo con tus amigos; no publica ubicación en tiempo real."],
    ["notifyLike", "Avisos de likes", "Actividad social de tu cuenta."],
    ["notifyComment", "Avisos de comentarios", "Comentarios en tu actividad."],
    ["notifyAttest", "Avisos de validaciones", "Validaciones de rondas compartidas."],
    ["notifyFriendAchievement", "Logros de amigos", "Avisos sobre logros compartidos."],
    ["notifyEquipment", "Equipo de amigos", "Avisos sobre cambios compartidos de equipo."],
    ["notifyFriendRequest", "Solicitudes de amistad", "Avisos sobre solicitudes a tu cuenta."],
    ["memory", "Memoria personal", "Recordar tus preferencias para personalizar tu experiencia privada."],
    ["learning", "Aprendizaje global futuro", "Autorizar datos desidentificados y revisados conforme a la política vigente. No activa entrenamiento ni una función de aprendizaje actual."],
  ] },
  { title: "IA y datos de práctica", choices: [
    ["ai", "Backyard AI", "Procesar el texto o dictado que decidas enviar."],
    ["images", "Fotos e imágenes", "Procesar las imágenes que envíes, incluido tu avatar."],
    ["practice", "Lectura de Launch Monitor", "Analizar fotos y capturas de tus datos de práctica. No es una conexión directa con el dispositivo."],
  ] },
  { title: "Apuestas y resultados", choices: [["financial", "Apuestas, resultados y gastos", legalEvidenceDefinition("financial_data", "accepted")!.statement]] },
  { title: "Marketing", choices: [["marketing", "Comunicaciones de marketing", legalEvidenceDefinition("marketing", "accepted")!.statement]] },
] as const;
export type PrivacyChoice = typeof PRIVACY_GROUPS[number]["choices"][number][0];
export type PrivacyChoices = Record<PrivacyChoice, boolean>;
export const EMPTY_PRIVACY_CHOICES = Object.fromEntries(PRIVACY_GROUPS.flatMap(group => group.choices.map(([key]) => [key, false]))) as PrivacyChoices;
const settings = { memory: "PERSONAL_MEMORY", learning: "GLOBAL_LEARNING", location: "LOCATION_INTERNAL", notifications: "NOTIFICATION_INTERNAL" } as const;
const ai = { ai: "AI_PROVIDER_PROCESSING_CONSENT", images: "AI_IMAGE_PROCESSING_CONSENT", practice: "AI_LAUNCH_MONITOR_PROCESSING_CONSENT" } as const;
const socialKeys = ["notifyLike", "notifyComment", "notifyAttest", "notifyFriendAchievement", "notifyEquipment", "notifyFriendRequest"] as const;
type SocialState = { data: Record<string, unknown> };

export function choicesFromCanonical(state: OptionalAuthorizationState, social: SocialState, media: AccountDeviceMediaPreferences): PrivacyChoices {
  return { location: state.scopes.LOCATION_INTERNAL.active, notifications: state.scopes.NOTIFICATION_INTERNAL.active,
    camera: media.camera?.value === "enabled", photos: media.photos?.value === "enabled",
    push: state.notifications.push, email: state.notifications.email, rounds: state.notifications.rounds, reminders: state.notifications.reminders,
    sharing: state.sharing.enabledForFriends, shareRounds: state.sharing.rounds, shareAchievements: state.sharing.achievements, shareEquipment: state.sharing.equipment, shareCourses: state.sharing.courses,
    ...Object.fromEntries(socialKeys.map(key => [key, social.data[key] === true])) as Record<typeof socialKeys[number], boolean>,
    memory: state.scopes.PERSONAL_MEMORY.active, learning: state.scopes.GLOBAL_LEARNING.active,
    ai: state.scopes.AI_PROVIDER_PROCESSING_CONSENT.active, images: state.scopes.AI_IMAGE_PROCESSING_CONSENT.active,
    practice: state.scopes.AI_LAUNCH_MONITOR_PROCESSING_CONSENT.active,
    financial: state.legal?.financial_data.active === true, marketing: state.legal?.marketing.active === true };
}

export async function readOnboardingPrivacy(token: string, signal?: AbortSignal) {
  const [state, social, media] = await Promise.all([requestOptionalAuthorizationState(token, signal), socialRequest<SocialState>("/api/social/preferences", token, { signal }), requestAccountDeviceMediaPreferences(token, undefined, signal)]);
  return { state, social, media, choices: choicesFromCanonical(state, social, media) };
}

/** Each purpose retains its existing ledger. This is deliberately NOT a broad
 * bundle acceptance. Retrying verifies canonical decisions before advancing;
 * partial failure stays on this step and never fabricates a local success. */
export async function saveOnboardingPrivacy(token: string, userId: string, choices: PrivacyChoices, keys: Map<string, string>, signal?: AbortSignal, transport: typeof fetch = fetch) {
  signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000);
  const key = (purpose: string) => { if (!keys.has(purpose)) keys.set(purpose, crypto.randomUUID()); return keys.get(purpose)!; };
  const { state, social, media } = await readOnboardingPrivacy(token, signal);
  for (const preference of ["camera", "photos"] as const) {
    if (!media[preference] || (media[preference].value === "enabled") !== choices[preference]) {
      await requestAccountDeviceMediaPreferences(token, { preference, enabled: choices[preference], idempotencyKey: key(`${preference}:${choices[preference]}`) }, signal);
      keys.delete(`${preference}:${choices[preference]}`);
    }
  }
  for (const [name, scope] of Object.entries(settings) as Array<[keyof typeof settings, typeof settings[keyof typeof settings]]>) {
    if (state.scopes[scope].status === "missing" || state.scopes[scope].active !== choices[name])
      await saveOptionalAuthorizationScope(token, scope, choices[name], key(`${scope}:${choices[name]}`), signal);
  }
  // The API records explicit accept AND decline, with the onboarding source.
  const aiEntries = Object.entries(ai) as Array<[keyof typeof ai, typeof ai[keyof typeof ai]]>;
  const missing = aiEntries.filter(([, scope]) => state.scopes[scope].status === "missing");
  if (missing.length) await saveRemoteAiConsentDecisions(token, userId, missing.map(([name, scope]) => ({ scope, accepted: choices[name] })), "onboarding", signal);
  for (const [name, scope] of aiEntries) {
    if (state.scopes[scope].status !== "missing" && state.scopes[scope].active !== choices[name]) {
      // Initial onboarding RPC deliberately never overwrites prior decisions.
      // An explicit changed checkbox uses the existing accept/revoke contract.
      if (choices[name]) await acceptRemoteAiProcessingConsent(token, userId, scope, signal);
      else await revokeRemoteAiProcessingConsent(token, userId, scope, signal);
    }
  }
  const events = (["financial_data", "marketing"] as const).flatMap(subject => {
    const accepted = choices[subject === "financial_data" ? "financial" : "marketing"];
    if (state.legal?.[subject].status !== "missing" && state.legal?.[subject].active === accepted) return [];
    const action = accepted ? "accepted" : "rejected";
    const definition = legalEvidenceDefinition(subject, action)!;
    return [{ subject, action, documentKey: definition.documentKey, documentVersion: definition.version, documentHash: definition.documentHash,
      statementKey: `${subject}.${action}.${definition.version}`, statementText: definition.statement, statementHash: definition.statementHash,
      locale: "es-MX", origin: "onboarding", clientOccurredAt: (() => { const name = `time:${subject}:${action}`; if (!keys.has(name)) keys.set(name, new Date().toISOString()); return keys.get(name)!; })(), idempotencyKey: key(`${subject}:${action}`) }];
  });
  if (events.length) {
    const response = await transport("/api/legal/evidence", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ events }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000), cache: "no-store", redirect: "error" });
    if (!response.ok) throw new Error("No se confirmó la evidencia de tus decisiones.");
  }
  await requestAccountNotificationPreferences(token, { push: choices.push, email: choices.email, rounds: choices.rounds, reminders: choices.reminders }, signal);
  const preferences = { ...social.data, enabledForFriends: choices.sharing, shareRounds: choices.shareRounds, shareAchievements: choices.shareAchievements, shareEquipment: choices.shareEquipment, shareCourses: choices.shareCourses,
    ...Object.fromEntries(socialKeys.map(name => [name, choices[name]])) };
  await socialRequest<SocialState>("/api/social/preferences", token, { method: "PUT", body: preferences, signal });
  const saved = await readOnboardingPrivacy(token, signal);
  if (Object.keys(choices).some(name => choices[name as PrivacyChoice] !== saved.choices[name as PrivacyChoice])
    || Object.values(saved.state.scopes).some(scope => scope.status === "missing")
    || !saved.state.legal || Object.values(saved.state.legal).some(scope => scope.status === "missing")) throw new Error("No se confirmaron todas las decisiones. Conservamos tu selección para reintentar.");
  return saved.state;
}
