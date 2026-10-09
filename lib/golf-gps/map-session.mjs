/** Exactly one map per mounted GPS session. Changes only update overlays.
 * generation prevents late SDK completion from mounting a hidden/disposed map. */
export class GpsMapSession {
  constructor(factory, onStatus) { this.factory = factory; this.onStatus = onStatus; this.surface = null; this.pending = null; this.disposed = false; this.generation = 0; this.scene = null; this.holeKey = null; }
  async open(container, callbacks) {
    if (this.disposed || this.surface || this.pending) return;
    const generation = ++this.generation; this.onStatus('LOADING');
    this.controller = new AbortController();
    this.pending = Promise.resolve().then(() => {
      if (this.disposed || generation !== this.generation) return null;
      return this.factory(container, callbacks, this.controller.signal, this.scene);
    });
    try {
      const surface = await this.pending;
      if (!surface) return;
      if (this.disposed || generation !== this.generation) { surface.destroy(); return; }
      this.surface = surface; this.onStatus('READY');
      if (this.scene) { surface.update(this.scene); surface.fitHole(this.scene); }
    } catch (error) { if (!this.disposed) this.onStatus(error?.code ?? 'MAP_ERROR'); }
    finally { this.pending = null; }
  }
  update(scene) {
    const changedHole = this.holeKey !== scene.holeKey; this.holeKey = scene.holeKey; this.scene = scene;
    if (this.surface) { this.surface.update(scene); if (changedHole) this.surface.fitHole(scene); }
  }
  fitHole() { if (this.surface && this.scene) this.surface.fitHole(this.scene); }
  centerPlayer() { if (this.surface && this.scene?.player) this.surface.centerPlayer(this.scene.player.wgs84); }
  dispose() { this.disposed = true; ++this.generation; this.controller?.abort(); this.surface?.destroy(); this.surface = null; }
}
