import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ACCOUNT_OWNED_ROWS, ACCOUNT_REFERENCE_COLUMNS, deleteAccountGraph, type AccountDeletionGateway } from "../lib/account-deletion";
import { activeWorkspaceScorecardPhotoIds, discardAccountWorkspace, switchAccountWorkspace, WORKSPACE_OWNER_KEY } from "../lib/account-workspace";
import { CloudSyncGate, cloudSyncErrorMessage, syncStatusAfterSkip } from "../lib/cloud-sync-gate";
import { STORAGE_KEYS } from "../lib/round-utils";
import { legalReturnDestination, preserveLegalReturn } from "../lib/legal-navigation";
import { coursePreferenceStorageKey } from "../lib/course-preferences";
import { cloudProfileRevisionKey, pendingProfileWriteKey } from "../lib/profile-sync";
import { internalNotificationStorageKey } from "../lib/internal-notifications";
import { equipmentProfileRecoveryStorageKey, equipmentProfileStorageKey } from "../lib/golf-equipment";
import { ballFitDraftStorageKey } from "../lib/ball-fitting-storage";
import { learningRecordsStorageKey } from "../lib/backyard-ai/memory/learning-events";
import { userPreferenceStorageKey } from "../lib/backyard-ai/memory/personal-memory";
import { backyardAiMetricsStorageKey } from "../lib/backyard-ai/observability/metrics";
import { ACCOUNT_STORAGE_KEYS, accountDeletionMarkerKey, bettingConsentPromptStorageKey } from "../lib/account-state";

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

test("coordinador cloud evita loops propios, agrupa cambios y permite retry manual", () => {
  const gate = new CloudSyncGate();
  assert.equal(gate.begin("v1", "mount"), "run");
  assert.equal(gate.begin("v2", "local"), "busy");
  assert.equal(gate.begin("v2", "manual"), "busy");
  assert.equal(gate.success("v2"), "manual");
  assert.equal(gate.begin("v2", "local"), "unchanged");
  assert.equal(syncStatusAfterSkip("unchanged"), "synced");

  assert.equal(gate.begin("v3", "local"), "run");
  gate.failure("v3");
  assert.equal(gate.begin("v3", "local"), "failed");
  assert.equal(syncStatusAfterSkip("failed"), "error");
  assert.equal(gate.begin("v3", "manual"), "run");
  gate.success("v3");
});

test("veinte renders derivados de la misma nube conservan single-flight y no generan otro POST", () => {
  const gate = new CloudSyncGate();
  let networkCycles = 0;
  const begin = (fingerprint: string) => {
    const decision = gate.begin(fingerprint, "local");
    if (decision === "run") networkCycles += 1;
    return decision;
  };
  assert.equal(begin("same-state"), "run");
  for (let index = 0; index < 20; index += 1) assert.equal(begin("same-state"), "busy");
  assert.equal(gate.success("same-state"), "local", "las veinte solicitudes se consolidan en una sola pendiente");
  assert.equal(begin("same-state"), "unchanged", "el fingerprint confirmado no vuelve a la red");
  assert.equal(networkCycles, 1);

  const page = readFileSync("app/page.tsx", "utf8");
  assert.doesNotMatch(page, /useEffect\(\(\) => \{\s*requestCloudSync\.current\?\.\(\);\s*\}, \[courses,/);
  assert.doesNotMatch(page, /window\.addEventListener\("focus",/);
  assert.doesNotMatch(page.match(/\}, \[hydrated, identity\.mode[^\n]+/)?.[0] || "", /identity\.accessToken/);
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(provider, /!Object\.is\(current\.defaultHandicap, preferences\.defaultHandicap\)/);
});

test("logout/cambio de cuenta cancela el coordinador sin ejecutar cola obsoleta", () => {
  const gate = new CloudSyncGate();
  assert.equal(gate.begin("a1", "mount"), "run");
  assert.equal(gate.begin("a2", "local"), "busy");
  gate.cancel();
  assert.equal(gate.begin("a2", "manual"), "cancelled");
  assert.equal(gate.pending(), null);
});

test("errores cloud son humanos, recuperables y no exponen detalles internos", () => {
  assert.match(cloudSyncErrorMessage(new Error("Failed to fetch")), /copia local/);
  assert.match(cloudSyncErrorMessage(new Error("JWT expired")), /renovar la sesión/);
  assert.doesNotMatch(cloudSyncErrorMessage(new Error("JWT expired")), /vuelve a iniciar sesión/i);
  assert.match(cloudSyncErrorMessage(new Error("photo upload failed")), /foto sigue guardada/);
  assert.equal(cloudSyncErrorMessage(new Error("Sync cancelled")), "");
});

test("eliminar cuenta local descarta solo A y conserva invitado y B", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEYS.history, "guest-history");
  switchAccountWorkspace(storage, "user-a");
  storage.setItem(STORAGE_KEYS.history, "a-history");
  storage.setItem("backyard-profile-cache-v1:user-a", "a-profile");
  storage.setItem(pendingProfileWriteKey("user-a"), "pending-profile");
  storage.setItem(cloudProfileRevisionKey("user-a"), "2026-09-06T12:00:00.000Z");
  storage.setItem(coursePreferenceStorageKey("favorites", "user-a"), '["course-a"]');
  storage.setItem(coursePreferenceStorageKey("recents", "user-a"), '["course-a"]');
  storage.setItem(internalNotificationStorageKey("user-a"), '{"version":1,"readEventKeys":["round-a"]}');
  storage.setItem(internalNotificationStorageKey("user-b"), '{"version":1,"readEventKeys":["round-b"]}');
  storage.setItem(equipmentProfileStorageKey("user-a")!, "equipment");
  storage.setItem(equipmentProfileRecoveryStorageKey("user-a")!, "equipment-recovery");
  storage.setItem(ballFitDraftStorageKey("user-a")!, "fit-draft");
  storage.setItem(learningRecordsStorageKey("user-a")!, "ai-learning");
  storage.setItem(userPreferenceStorageKey("user-a")!, "ai-preferences");
  storage.setItem(backyardAiMetricsStorageKey("user-a")!, "ai-metrics");
  storage.setItem(bettingConsentPromptStorageKey("user-a"), "shown");
  storage.setItem(accountDeletionMarkerKey("user-a"), "pending");
  switchAccountWorkspace(storage, "user-b");
  storage.setItem(STORAGE_KEYS.history, "b-history");
  switchAccountWorkspace(storage, "user-a");

  discardAccountWorkspace(storage, "user-a");
  assert.equal(storage.getItem(WORKSPACE_OWNER_KEY), "guest");
  assert.equal(storage.getItem(STORAGE_KEYS.history), "guest-history");
  assert.equal(storage.getItem("backyard-profile-cache-v1:user-a"), null);
  assert.equal(storage.getItem(pendingProfileWriteKey("user-a")), null);
  assert.equal(storage.getItem(cloudProfileRevisionKey("user-a")), null);
  assert.equal(storage.getItem(coursePreferenceStorageKey("favorites", "user-a")), null);
  assert.equal(storage.getItem(coursePreferenceStorageKey("recents", "user-a")), null);
  assert.equal(storage.getItem(internalNotificationStorageKey("user-a")), null);
  assert.equal(storage.getItem(equipmentProfileStorageKey("user-a")!), null);
  assert.equal(storage.getItem(equipmentProfileRecoveryStorageKey("user-a")!), null);
  assert.equal(storage.getItem(ballFitDraftStorageKey("user-a")!), null);
  assert.equal(storage.getItem(learningRecordsStorageKey("user-a")!), null);
  assert.equal(storage.getItem(userPreferenceStorageKey("user-a")!), null);
  assert.equal(storage.getItem(backyardAiMetricsStorageKey("user-a")!), null);
  assert.equal(storage.getItem(bettingConsentPromptStorageKey("user-a")), null);
  assert.equal(storage.getItem(accountDeletionMarkerKey("user-a")), "pending");
  assert.equal(storage.getItem(internalNotificationStorageKey("user-b")), '{"version":1,"readEventKeys":["round-b"]}');
  switchAccountWorkspace(storage, "user-b");
  assert.equal(storage.getItem(STORAGE_KEYS.history), "b-history");
  switchAccountWorkspace(storage, "user-a");
  assert.equal(storage.getItem(STORAGE_KEYS.history), null);

  storage.setItem(ACCOUNT_STORAGE_KEYS.mode, "authenticated");
  switchAccountWorkspace(storage, "user-b");
  discardAccountWorkspace(storage, "user-a");
  assert.equal(storage.getItem(WORKSPACE_OWNER_KEY), "user-b");
  assert.equal(storage.getItem(ACCOUNT_STORAGE_KEYS.mode), "authenticated");
});

function deletionGateway(options: { failStorage?: boolean } = {}) {
  const calls: string[] = [];
  const folders: Record<string, Array<{ name: string; isFolder: boolean }>> = {
    "user-a": [{ name: "round-1", isFolder: true }, { name: "root.webp", isFolder: false }],
    "user-a/round-1": [{ name: "card.jpg", isFolder: false }],
  };
  const gateway: AccountDeletionGateway = {
    listStorage: async (prefix, offset) => { calls.push(`list:${prefix}:${offset}`); return offset ? [] : folders[prefix] || []; },
    removeStorage: async paths => { calls.push(`storage:${paths.sort().join(",")}`); if (options.failStorage) throw new Error("storage unavailable"); },
    ownedTournaments: async userId => { calls.push(`tournaments:${userId}`); return [{ id: "t-1", publicId: "public-1" }, { id: "t-2", publicId: "public-2" }]; },
    deleteWhere: async (table, column, value) => { calls.push(`delete:${table}:${column}:${value}`); },
    deleteWhereIn: async (table, column, values) => { calls.push(`delete-in:${table}:${column}:${values.join(",")}`); },
    clearReference: async (table, column, userId) => { calls.push(`clear:${table}:${column}:${userId}`); },
    deleteAuthUser: async userId => { calls.push(`auth:${userId}`); },
  };
  return { gateway, calls };
}

test("eliminación server-side limpia media/datos/referencias y Auth al final", async () => {
  const { gateway, calls } = deletionGateway();
  const result = await deleteAccountGraph(gateway, "user-a");
  assert.deepEqual(result, { deletedPhotoCount: 2, deletedTournamentCount: 2 });
  assert.ok(calls.indexOf("storage:user-a/round-1/card.jpg,user-a/root.webp") < calls.indexOf("auth:user-a"));
  assert.equal(calls.at(-1), "auth:user-a");
  for (const [table, column] of ACCOUNT_OWNED_ROWS) assert.ok(calls.includes(`delete:${table}:${column}:user-a`), `${table} no se eliminó`);
  for (const [table, column] of ACCOUNT_REFERENCE_COLUMNS) assert.ok(calls.includes(`clear:${table}:${column}:user-a`), `${table}.${column} no se limpió`);
  assert.ok(calls.includes("delete-in:score_audit_log:tournament_id:t-1,t-2"));
  assert.ok(calls.includes("delete-in:polla_join_attempts:public_id:public-1,public-2"));
});

test("un fallo de Storage impide afirmar eliminación o borrar Auth", async () => {
  const { gateway, calls } = deletionGateway({ failStorage: true });
  await assert.rejects(deleteAccountGraph(gateway, "user-a"), /storage unavailable/);
  assert.equal(calls.some(call => call.startsWith("auth:")), false);
});

test("endpoint deriva user id del token y nunca acepta userId del body", () => {
  const source = readFileSync("app/api/account/delete/route.ts", "utf8");
  assert.match(source, /auth\.getUser\(token\)/);
  assert.match(source, /data\.user\.id/);
  assert.doesNotMatch(source, /body\.userId|userId\s*:\s*body/);
  assert.match(source, /confirmation !== "ELIMINAR"/);
});

test("documentos legales regresan al origen y conservan contexto entre documentos", () => {
  assert.deepEqual(legalReturnDestination("account"), { href: "/?screen=account", label: "← Regresar a Mi Cuenta" });
  assert.match(legalReturnDestination("onboarding").label, /consentimiento/);
  assert.match(legalReturnDestination("access").label, /acceso/);
  assert.equal(preserveLegalReturn("/legal/privacy#contact", "account"), "/legal/privacy?returnTo=account#contact");
});

test("Cuenta y acceso presentan Apple solo cuando está disponible y usan el origin real para OAuth", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const account = readFileSync("app/components/account-panel.tsx", "utf8");
  assert.match(provider, /const appleAvailable = Boolean\(socialEnabled && providers\?\.status === "ready" && providers\.apple\)/);
  assert.match(provider, /appleAvailable \? "Continuar con Apple" : "Apple · Próximamente"/);
  assert.match(provider, /disabled=\{busy \|\| !appleAvailable\}/);
  assert.doesNotMatch(account, />Apple</);
  assert.match(provider, /`\$\{window\.location\.origin\}\/auth\/callback`/);
});

test("la importación explícita sólo selecciona fotos del workspace activo", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([{ scorecardPhotoIds: ["guest-card-1"] }]));
  storage.setItem(STORAGE_KEYS.draft, JSON.stringify({ photoId: "guest-card-2" }));
  switchAccountWorkspace(storage, "user-a");
  assert.deepEqual(activeWorkspaceScorecardPhotoIds(storage, "user-a"), ["guest-card-1", "guest-card-2"]);
  assert.deepEqual(activeWorkspaceScorecardPhotoIds(storage, "user-b"), []);
});

test("el consentimiento de apuestas se monta como overlay sin destruir la acción pendiente", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const dialog = readFileSync("app/components/betting-consent-dialog.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  assert.doesNotMatch(provider, /if \(bettingConsentOpen\) return/);
  assert.match(provider, /<Fragment key=\{identity\.userId\}>\{children\}<\/Fragment>[\s\S]*\{bettingConsentDialog\}/);
  assert.match(provider, /<BetaOnboardingFlow[\s\S]*\{bettingConsentDialog\}[\s\S]*<\/AccountContext\.Provider>/);
  assert.match(dialog, /className="modalBackdrop bettingConsentAccess"/);
  assert.match(css, /\.bettingConsentDialog\{position:relative/);
});

test("una eliminación interrumpida conserva el barrier y ofrece reintento sin montar la app", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const panel = readFileSync("app/components/account-panel.tsx", "utf8");
  assert.match(provider, /startsWith\(ACCOUNT_DELETION_MARKER_PREFIX\)/);
  assert.match(provider, /if \(marker\.state === "completed" \|\| marker\.state === "pending_confirmation"\) continue/);
  assert.match(provider, /marker\.state === "completed_cleanup_pending"\s*\? "completed_cleanup_pending"/);
  assert.match(provider, /clearDeletedAuthSessionForUser\(supabase\.auth, userId\)/);
  assert.match(provider, /clearDeletedAuthSessionForUser\(supabase\.auth, session\.user\.id\)/);
  assert.match(provider, /deletionMarker === "completed"[\s\S]*"completed_cleanup_pending"/);
  assert.match(provider, /const deletesActiveAccount = activeUserId\.current === deletedUserId \|\| ownsLocalWorkspace/);
  assert.match(provider, /if \(deletesActiveAccount\) \{[\s\S]*localStorage\.removeItem\(ACCOUNT_STORAGE_KEYS\.mode\)/);
  const purgeBody = provider.match(/async function purgeDeletedAccountLocal[\s\S]+?(?=\n  async function finishAccountDeletion)/)?.[0] || "";
  const firstAsyncCleanup = purgeBody.indexOf("await clearDeletedAuthSession");
  assert.ok(firstAsyncCleanup > 0);
  assert.ok(purgeBody.indexOf("setIdentity(null)") < firstAsyncCleanup, "la identidad eliminada se cierra antes del primer await");
  assert.doesNotMatch(purgeBody.slice(firstAsyncCleanup), /setIdentity\(null\)|removeItem\(ACCOUNT_STORAGE_KEYS\.mode\)/, "una cuenta nueva no puede borrarse por un flag capturado antes de await");
  assert.match(provider, /trackPending: false/);
  assert.match(provider, /setPendingLocalDeletionOwner\(nextPendingLocalDeletionOwner\(localStorage\)\)/);
  assert.match(provider, /setPendingDeletionSession\(session\)/);
  assert.match(provider, /if \(pendingDeletionSession\) return[\s\S]*Reintentar eliminación/);
  assert.match(provider, /serverDeletionConfirmed \? "completed_cleanup_pending" : "pending_confirmation"/);
  assert.match(provider, /if \(pendingLocalDeletionOwner\) return[\s\S]*Reintentar limpieza/);
  assert.match(panel, /serverDeletionConfirmed/);
  assert.match(panel, /localStorage\.getItem\(deletionMarker\) !== requestedAt/);
  assert.match(panel, /No pudimos preparar la eliminación de forma segura/);
  assert.match(panel, /responseStatus === null \|\| serverDeletionConfirmed \|\| responseStatus >= 500/);
  assert.match(panel, /"completed_cleanup_pending"/);
});
