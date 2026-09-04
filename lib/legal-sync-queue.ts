import type { LegalAcceptance } from "./account-state";

export const LEGAL_SYNC_QUEUE_PREFIX = "backyard-legal-sync-v1:";

export type PendingLegalSync = {
  userId: string;
  acceptances: LegalAcceptance[];
  queuedAt: string;
  attempts: number;
  lastAttemptAt?: string;
  lastErrorCode?: string;
};

type QueueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const keyFor = (userId: string) => `${LEGAL_SYNC_QUEUE_PREFIX}${userId}`;

export function readPendingLegalSync(storage: Pick<Storage, "getItem">, userId: string): PendingLegalSync | null {
  try {
    const value = JSON.parse(storage.getItem(keyFor(userId)) || "null") as PendingLegalSync | null;
    return value?.userId === userId && Array.isArray(value.acceptances) ? value : null;
  } catch { return null; }
}

export function queueLegalSync(storage: QueueStorage, userId: string, acceptances: LegalAcceptance[], now = new Date().toISOString()) {
  const prior = readPendingLegalSync(storage, userId);
  const merged = new Map<string, LegalAcceptance>();
  for (const item of [...(prior?.acceptances || []), ...acceptances]) merged.set(`${item.type}:${item.documentVersion}`, item);
  const pending: PendingLegalSync = { userId, acceptances: [...merged.values()], queuedAt: prior?.queuedAt || now, attempts: prior?.attempts || 0, lastAttemptAt: prior?.lastAttemptAt, lastErrorCode: prior?.lastErrorCode };
  storage.setItem(keyFor(userId), JSON.stringify(pending));
  return pending;
}

export function markLegalSyncFailed(storage: QueueStorage, userId: string, error: unknown, now = new Date().toISOString()) {
  const pending = readPendingLegalSync(storage, userId);
  if (!pending) return null;
  const candidate = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  const text = String(candidate.code || candidate.message || error || "sync_failed");
  const next = { ...pending, attempts: pending.attempts + 1, lastAttemptAt: now, lastErrorCode: text.slice(0, 80) };
  storage.setItem(keyFor(userId), JSON.stringify(next));
  return next;
}

export function clearPendingLegalSync(storage: Pick<Storage, "removeItem">, userId: string) {
  storage.removeItem(keyFor(userId));
}

export function legalSyncErrorMessage(error: unknown, online: boolean) {
  if (!online) return "Sin conexión · tu aceptación está guardada en este dispositivo y pendiente de sincronizar.";
  const candidate = error && typeof error === "object" ? error as { code?: unknown; message?: unknown; status?: unknown } : {};
  const code = String(candidate.code || "");
  const message = String(candidate.message || error || "");
  if (["401", "403"].includes(String(candidate.status || "")) || /jwt|session|token.*expir/i.test(message)) return "Tu sesión venció. Inicia sesión nuevamente para sincronizar la aceptación.";
  if (code === "42501" || /permission|row-level|rls/i.test(message)) return "Supabase rechazó la aceptación de esta cuenta. Tu copia local se conserva; reintenta después de revisar el acceso.";
  if (["42P01", "42703", "PGRST204", "PGRST205"].includes(code) || /schema|column.*does not exist/i.test(message)) return "Supabase todavía no admite esta escritura de aceptación. Tu copia local se conserva.";
  return "Tu aceptación está guardada en este dispositivo, pero sigue pendiente de sincronizar.";
}
