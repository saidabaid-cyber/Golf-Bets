import { distanceMeters, toYards, readingState, validCoordinate } from './geodesic.mjs';

// Deliberately separate from operationalDistance()/Course Master. This one
// explicitly authorized provisional pilot never upgrades its target to reviewed.
export function pilotDistance(reading, target, now = Date.now()) {
  if (target?.status !== 'PROVISIONAL_NOT_FIELD_VERIFIED' || target?.candidate !== true ||
      target?.isFlag !== false || target?.fieldVerifiedAt !== null ||
      target?.source?.provider !== 'INEGI' || !validCoordinate(target?.coordinates)) {
    return { status: 'INVALID_PROVISIONAL_TARGET', meters: null, yards: null };
  }
  const state = readingState(reading ? { ...reading, synthetic: false } : null, now);
  if (state !== 'LIVE_REPORTED') return { status: state, meters: null, yards: null };
  try {
    const meters = distanceMeters(reading.wgs84, target.coordinates);
    return { status: reading.synthetic ? 'SIMULATED_PROVISIONAL_DISTANCE' : 'PROVISIONAL_DIRECT_DISTANCE',
      meters, yards: toYards(meters), targetFieldVerified: false };
  } catch { return { status: 'DISTANCE_UNAVAILABLE', meters: null, yards: null }; }
}

export function pilotHostEnabled({ enabled, branch, deploymentEnvironment, host }) {
  return enabled === 'true' && branch === 'integration/backyard-current' &&
    deploymentEnvironment === 'preview' && host === 'dev.thebackyard.com.mx';
}

export class PilotLocation {
  constructor(adapter, onChange, now = () => Date.now()) {
    this.adapter = adapter; this.onChange = onChange; this.now = now;
    this.watchId = null; this.generation = 0; this.disposed = false;
    this.permissionHandle = null; this.permission = 'unknown';
    this.status = 'STOPPED'; this.reading = null;
  }
  snapshot() { return { status: this.status, permission: this.permission,
    reading: this.reading, active: this.watchId !== null, simulated: !!this.adapter.simulated }; }
  emit() { if (!this.disposed) this.onChange(this.snapshot()); }
  async initializePermission() {
    try {
      const p = await this.adapter.permissions?.query({ name: 'geolocation' });
      if (this.disposed || !p) return;
      this.permissionHandle = p; this.permission = p.state;
      p.onchange = () => {
        if (this.disposed) return;
        this.permission = p.state;
        if (p.state === 'denied') this.stop('DENIED'); else this.emit();
      };
    } catch { /* Safari may not implement permissions.query. Action remains explicit. */ }
    this.emit();
  }
  start() {
    if (this.disposed) return;
    this.stop(); this.reading = null;
    if (this.permission === 'denied') return this.stop('DENIED');
    if (!this.adapter.secure) return this.stop('HTTPS_REQUIRED');
    if (!this.adapter.geolocation) return this.stop('UNAVAILABLE');
    const generation = ++this.generation;
    this.status = 'WAITING'; this.emit();
    try {
      const id = this.adapter.geolocation.watchPosition(pos => {
        if (this.disposed || generation !== this.generation) return;
        this.reading = { wgs84: [pos.coords.longitude, pos.coords.latitude],
          accuracyMeters: pos.coords.accuracy, timestamp: pos.timestamp,
          method: this.adapter.simulated ? 'EXPLICIT_LOCAL_QA_SIMULATION' : 'DEVICE_GEOLOCATION',
          synthetic: !!this.adapter.simulated };
        this.permission = 'granted';
        this.status = readingState({ ...this.reading, synthetic: false }, this.now()); this.emit();
      }, error => {
        if (this.disposed || generation !== this.generation) return;
        this.status = { 1: 'DENIED', 2: 'UNAVAILABLE', 3: 'TIMEOUT' }[error.code] || 'UNAVAILABLE';
        this.reading = null;
        if (error.code === 1) { this.permission = 'denied'; this.stop('DENIED'); } else this.emit();
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
      // Also handles adapters firing a denial synchronously in a test.
      if (this.disposed || generation !== this.generation) this.adapter.geolocation.clearWatch(id);
      else { this.watchId = id; this.emit(); }
    } catch { this.stop('UNAVAILABLE'); }
  }
  stop(status = 'STOPPED') {
    ++this.generation;
    if (this.watchId !== null) this.adapter.geolocation.clearWatch(this.watchId);
    this.watchId = null; this.status = status; this.emit();
  }
  dispose() {
    this.stop(); this.disposed = true;
    if (this.permissionHandle) this.permissionHandle.onchange = null;
    this.reading = null;
  }
}
