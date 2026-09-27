import type { GhinProfileProjection } from "./profile";

export type GhinLinkController = {
  refresh: () => Promise<GhinProfileProjection | null>;
};

/** Selecting GHIN as the user's index source is allowed only after the
 * server-authoritative refresh returns the persisted provider projection. */
export async function linkGhinReadOnly(control: GhinLinkController, onUseGhin: () => Promise<void>) {
  const refreshed = await control.refresh();
  if (!refreshed) return false;
  await onUseGhin();
  return true;
}
