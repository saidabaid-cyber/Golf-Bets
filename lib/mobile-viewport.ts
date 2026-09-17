/** One lock per mounted owner, not one saved overflow string per modal. This
 * survives nested dialogs closing in either order and React Strict Mode. */
export function createScrollLock(lock: () => () => void) {
  const owners = new Set<symbol>();
  let restore: (() => void) | undefined;
  return () => {
    const owner = Symbol();
    if (!owners.size) restore = lock();
    owners.add(owner);
    return () => {
      if (!owners.delete(owner) || owners.size) return;
      const release = restore;
      restore = undefined;
      release?.();
    };
  };
}

export function scrollDocumentToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

export function resetViewScroll(container?: HTMLElement | null) {
  const modal = container?.closest<HTMLElement>('[aria-modal="true"]');
  if (modal) {
    modal.scrollTop = 0;
    if (container) container.scrollTop = 0;
  } else scrollDocumentToTop();
}

export const lockModalScroll = createScrollLock(() => {
  const body = document.body;
  const previous = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width };
  const y = window.scrollY;
  // overflow:hidden alone does not lock the document reliably on iOS Safari.
  Object.assign(body.style, { overflow: "hidden", position: "fixed", top: `-${y}px`, width: "100%" });
  return () => {
    Object.assign(body.style, previous);
    window.scrollTo({ top: y, behavior: "instant" });
  };
});

const dialogs = new Map<HTMLElement, number>();
export function registerModal(dialog: HTMLElement) {
  dialogs.set(dialog, (dialogs.get(dialog) ?? 0) + 1);
  const release = lockModalScroll();
  if (dialogs.get(dialog) === 1) dialog.scrollTop = 0;
  return () => {
    const count = (dialogs.get(dialog) ?? 1) - 1;
    if (count) dialogs.set(dialog, count); else dialogs.delete(dialog);
    release();
  };
}

export function isTopModal(dialog: HTMLElement) {
  const visible = [...dialogs.keys()].filter((item) => item.isConnected && item.getClientRects().length > 0);
  visible.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  return visible.at(-1) === dialog;
}
