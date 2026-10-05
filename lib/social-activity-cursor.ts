const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;
/** Keep Postgres microseconds intact so tied timestamps do not skip a page. */
export function socialActivityCursor(value: string): { at: string; id: string } | null {
  const parts = value.split("|");
  if (parts.length !== 2) return null;
  const [at, id] = parts;
  return UTC_INSTANT.test(at) && Number.isFinite(Date.parse(at)) && UUID.test(id) ? { at, id } : null;
}
