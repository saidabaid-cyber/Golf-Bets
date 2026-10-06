import type { CloudDataBundle } from "./cloud-sync";

/** Private, in-memory canonical receipt for one mounted account. Recreating a
 * coordinator keeps conditional reads; signing out/switching accounts clears
 * it. It never replaces a server check or survives a clean session. */
export class CloudCanonicalSession {
  private owner: string | null = null;
  private canonical: CloudDataBundle | undefined;
  select(owner: string | null) {
    if (owner !== this.owner) { this.owner = owner; this.canonical = undefined; }
    return this.canonical;
  }
  remember(owner: string, canonical: CloudDataBundle) {
    if (owner === this.owner) this.canonical = canonical;
  }
}
