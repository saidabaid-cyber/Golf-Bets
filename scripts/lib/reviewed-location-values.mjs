/** PostgREST may serialize PostgreSQL float8 with 15 significant digits.
 * Compare that wire representation, not an arbitrary geographic tolerance.
 * This only identifies a no-op: stored coordinates/evidence are never rounded.
 */
export function sameStoredCoordinate(stored, source) {
  return Number.isFinite(stored) && Number.isFinite(source)
    && (stored === source || stored.toPrecision(15) === source.toPrecision(15));
}
