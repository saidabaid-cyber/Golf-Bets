import type { GolfBallCatalog } from "./golf-equipment";

/** Keep the last usable Ball Fit catalog while a pinned-id refresh runs.
 * Incoming rows replace matching ids, but a partial/empty refresh never
 * removes catalog rows already available to the active fitting session. */
export function mergeBallFitSessionCatalog(
  current: readonly GolfBallCatalog[],
  incoming: readonly GolfBallCatalog[],
): GolfBallCatalog[] {
  if (!incoming.length) return [...current];
  const merged = new Map(current.map((ball) => [ball.id, ball]));
  for (const ball of incoming) merged.set(ball.id, ball);
  return [...merged.values()];
}
