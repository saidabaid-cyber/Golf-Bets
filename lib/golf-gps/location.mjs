import { PilotLocation } from '../gps-pilot-la-vista-1/pilot.mjs';
import { readingState } from '../gps-pilot-la-vista-1/geodesic.mjs';

/** Reuses the tested real-device adapter; no location persistence or upload.
 * Repeated Start never creates another watcher. Hidden pages stop capture and
 * must obtain a NEW reading on resume; no background tracking promise. */
export class GpsLocationSession {
  constructor(adapter, onChange, runtime = {}) {
    this.now = runtime.now ?? Date.now; this.onChange = onChange; this.wanted = false; this.disposed = false;
    this.document = runtime.document ?? globalThis.document;
    // Browser timers require their Window receiver; do not invoke as a class method.
    this.timerClear = id => runtime.clearInterval ? runtime.clearInterval(id) : globalThis.clearInterval(id);
    this.pilot = new PilotLocation(adapter, state => { this.latest = state; this.emit(); }, this.now);
    this.latest = this.pilot.snapshot();
    this.visibility = () => { if (this.document?.hidden) this.pilot.stop('SUSPENDED'); else if (this.wanted) this.start(); };
    this.document?.addEventListener('visibilitychange', this.visibility);
    this.timer = (runtime.setInterval ?? setInterval)(() => this.emit(), 1000);
    void this.pilot.initializePermission();
  }
  snapshot() {
    const state = this.latest; const reading = state.reading;
    const status = state.active && reading ? readingState({ ...reading, synthetic: false }, this.now()) : state.status;
    return { ...state, status, ageSeconds: reading ? Math.max(0, (this.now() - reading.timestamp) / 1000) : null };
  }
  emit() { if (!this.disposed) this.onChange(this.snapshot()); }
  start() {
    if (this.disposed) return;
    this.wanted = true;
    if (this.document?.hidden) { this.pilot.stop('SUSPENDED'); return; }
    if (!this.pilot.snapshot().active) this.pilot.start();
  }
  stop() { this.wanted = false; this.pilot.stop(); }
  dispose() {
    this.wanted = false; this.disposed = true; this.pilot.dispose(); this.timerClear(this.timer);
    this.document?.removeEventListener('visibilitychange', this.visibility);
  }
}
export function browserLocationAdapter() {
  return { secure: globalThis.isSecureContext === true, geolocation: globalThis.navigator?.geolocation, permissions: globalThis.navigator?.permissions, simulated: false };
}
