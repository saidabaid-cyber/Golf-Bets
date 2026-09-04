import type { SyncStatus } from "./cloud-sync-cycle";

export type CloudSyncTrigger = "mount" | "local" | "online" | "visible" | "manual";

/** Small state machine used by the page-level scheduler. It coalesces work,
 * suppresses the sync produced by its own cloud hydration, and remembers a
 * failed fingerprint until data changes or the user explicitly retries. */
export class CloudSyncGate {
  private running = false;
  private cancelled = false;
  private queued: CloudSyncTrigger | null = null;
  private acknowledged = "";
  private failed = "";

  begin(fingerprint: string, trigger: CloudSyncTrigger): "run" | "busy" | "unchanged" | "failed" | "cancelled" {
    if (this.cancelled) return "cancelled";
    if (this.running) { this.queue(trigger); return "busy"; }
    const force = trigger !== "local";
    if (!force && fingerprint === this.acknowledged) return "unchanged";
    if (!force && fingerprint === this.failed) return "failed";
    this.running = true;
    return "run";
  }

  queue(trigger: CloudSyncTrigger) {
    if (this.cancelled) return;
    const priority: Record<CloudSyncTrigger, number> = { local: 0, visible: 1, online: 2, mount: 3, manual: 4 };
    if (!this.queued || priority[trigger] > priority[this.queued]) this.queued = trigger;
  }

  success(fingerprint: string) {
    this.acknowledged = fingerprint;
    this.failed = "";
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
