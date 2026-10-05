import type { SyncStatus } from "./cloud-sync-cycle";

export type CloudSyncTrigger = "mount" | "local" | "online" | "visible" | "retry" | "manual";

/** Small state machine used by the page-level scheduler. It coalesces work,
 * suppresses the sync produced by its own cloud hydration, and remembers a
 * failed fingerprint until data changes or the user explicitly retries. */
export class CloudSyncGate {
  private running = false;
  private cancelled = false;
  private queued: CloudSyncTrigger | null = null;
  private acknowledged = "";
  private failed = "";
  private checkedAt = 0;

  begin(fingerprint: string, trigger: CloudSyncTrigger, now = Date.now()): "run" | "busy" | "unchanged" | "failed" | "cancelled" {
    if (this.cancelled) return "cancelled";
    if (this.running) { this.queue(trigger); return "busy"; }
    const force = trigger === "manual" || trigger === "retry";
    if (!force && fingerprint === this.failed) return "failed";
    // Only a real foreground transition may probe another device's changes.
    // There is no timer. A recent successful flight absorbs overlapping events.
    const foregroundProbe = (trigger === "visible" || trigger === "online") && now - this.checkedAt >= 30_000;
    if (!force && !foregroundProbe && fingerprint === this.acknowledged) return "unchanged";
    this.running = true;
    return "run";
  }

  queue(trigger: CloudSyncTrigger) {
    if (this.cancelled) return;
    const priority: Record<CloudSyncTrigger, number> = { local: 0, visible: 1, online: 2, mount: 3, retry: 4, manual: 5 };
    if (!this.queued || priority[trigger] > priority[this.queued]) this.queued = trigger;
  }

  success(fingerprint: string, now = Date.now()) {
    this.acknowledged = fingerprint;
    this.failed = "";
    this.checkedAt = now;
    return this.release();
  }

  pending() { return this.release(); }

  failure(fingerprint: string) {
    this.failed = fingerprint;
    this.running = false;
    this.queued = null;
  }

  cancel() {
    this.cancelled = true;
    this.running = false;
    this.queued = null;
  }

  private release() {
    this.running = false;
    const queued = this.queued;
    this.queued = null;
    return queued;
  }
}

/** One initial attempt plus at most two automatic retries, even when conflict
 * rebasing changes the hash. UI/auth/foreground events never reset this budget. */
export class CloudRetryBudget {
  private attempts = 0;
  private until = 0;
  allow(trigger: CloudSyncTrigger, now = Date.now()) {
    return trigger === "manual" || (this.attempts < 3 && now >= this.until);
  }
  failure(now = Date.now()) {
    this.attempts += 1;
    const delay = Math.min(300_000, 5_000 * 2 ** (this.attempts - 1));
    this.until = now + delay;
    return this.attempts < 3 ? delay : null;
  }
  reset() { this.attempts = 0; this.until = 0; }
}

export function cloudSyncErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/cancel/i.test(message)) return "";
  if (/token|sesión|jwt|401/i.test(message)) return "La nube pidió renovar la sesión. Tu copia local se conserva; reintenta la conexión.";
  if (/permission|permisos|row-level|42501/i.test(message)) return "La nube rechazó la sincronización. Tu copia local se conserva; vuelve a iniciar sesión o reintenta.";
  if (/schema|migration|migración|tabla|column|PGRST20|42P01|42703/i.test(message)) return "La nube no pudo guardar todos los datos. Tu copia local se conserva; reintenta más tarde.";
  if (/timeout|fetch|network|conexión|503/i.test(message)) return "No pudimos conectar con la nube. Tu copia local se conserva.";
  if (/conflicto/i.test(message)) return "Otro dispositivo actualizó tus datos. Reintenta para conciliarlos.";
  if (/foto|photo/i.test(message)) return "La foto sigue guardada en este dispositivo y queda pendiente de sincronizar.";
  return "La sincronización no terminó. Tu copia local se conserva; puedes reintentar.";
}

export function syncStatusAfterSkip(result: ReturnType<CloudSyncGate["begin"]>): SyncStatus | null {
  return result === "unchanged" ? "synced" : result === "failed" ? "error" : null;
}
