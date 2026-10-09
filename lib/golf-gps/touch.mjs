/** Observes pointers without consuming SDK gestures. A pan/pinch/marker drag
 * cannot become a target tap on release. No personal coordinates retained. */
export class MapTapGuard {
  constructor(now = Date.now) { this.now = now; this.pointers = new Map(); this.blockUntil = 0; this.validUntil = 0; this.observed = false; }
  down(event, marker = false) {
    this.observed = true; this.validUntil = 0;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, invalid: marker });
    if (this.pointers.size > 1) for (const point of this.pointers.values()) point.invalid = true;
  }
  move(event) {
    const point = this.pointers.get(event.pointerId);
    if (point && Math.hypot(event.clientX - point.x, event.clientY - point.y) > 8) point.invalid = true;
  }
  up(event, canceled = false) {
    this.move(event); const point = this.pointers.get(event.pointerId); this.pointers.delete(event.pointerId);
    if (!point || point.invalid || canceled) this.suppress();
    else if (!this.pointers.size) this.validUntil = this.now() + 700;
  }
  suppress() { this.validUntil = 0; this.blockUntil = this.now() + 700; }
  allow() { return !this.pointers.size && this.now() >= this.blockUntil && (!this.observed || this.now() <= this.validUntil); }
}
