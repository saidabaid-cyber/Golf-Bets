/** Pilot-only entitlement. Never a role, membership or permission for Course Master.
 * Call only after authenticatedRequest verifies the server identity/lifecycle. */
export function isGpsPilotTester(userId: string, configuredIds: string | undefined) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(userId) || !configuredIds?.trim()) return false;
  const ids = configuredIds.split(",").map(id => id.trim().toLowerCase());
  if (ids.length > 20 || ids.some(id => !uuid.test(id))) return false;
  return ids.includes(userId.toLowerCase());
}
