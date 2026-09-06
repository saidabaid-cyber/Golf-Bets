import assert from "node:assert/strict";
import test from "node:test";

import {
  INTERNAL_NOTIFICATION_READ_LIMIT,
  deriveInternalNotifications,
  internalNotificationEventKey,
  internalNotificationStorageKey,
  markAllInternalNotificationsRead,
  markAllInternalNotificationsReadInStorage,
  normalizeInternalNotificationReadState,
  persistInternalNotificationReadState,
  readInternalNotificationReadState,
  setInternalNotificationRead,
} from "../lib/internal-notifications";
import type { PersonalActivity } from "../lib/golf-insights";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function activity(id: string, occurredAt: string): PersonalActivity {
  return {
    id,
    kind: id.startsWith("group:") ? "group" : "round",
    title: `Actividad ${id}`,
    detail: "Dato real del espacio local",
    occurredAt,
    ...(id.startsWith("group:") ? { groupId: id.slice(6) } : { roundId: id.slice(6) }),
  };
}

test("la clave estable incluye id y fecha para que una actualización sea un evento nuevo", () => {
  const first = activity("group:viernes", "2026-09-06T08:00:00.000Z");
  const updated = activity("group:viernes", "2026-09-06T09:00:00.000Z");
  assert.notEqual(internalNotificationEventKey(first), internalNotificationEventKey(updated));
  assert.deepEqual(JSON.parse(internalNotificationEventKey(first)), [first.id, first.occurredAt]);
});

test("estado ausente o malformado se recupera vacío sin lanzar", () => {
  const storage = new MemoryStorage();
  const key = internalNotificationStorageKey("account-a");
  storage.values.set(key, "{not-json");
  assert.deepEqual(readInternalNotificationReadState(storage, "account-a"), {
    ok: true,
    state: { version: 1, readEventKeys: [] },
    recoveredMalformed: true,
  });

  storage.values.set(key, JSON.stringify({ version: 9, readEventKeys: ["old"] }));
  assert.deepEqual(readInternalNotificationReadState(storage, "account-a"), {
    ok: true,
    state: { version: 1, readEventKeys: [] },
    recoveredMalformed: true,
  });
  assert.deepEqual(normalizeInternalNotificationReadState({ version: 1, readEventKeys: ["a", 7, "a", "b"] }), {
    version: 1,
    readEventKeys: ["a", "b"],
  });
});

test("marcar todo leído conserva el estado y una edición posterior vuelve a ser no leída", () => {
  const original = [
    activity("round:r1", "2026-09-06T10:00:00.000Z"),
    activity("group:g1", "2026-09-06T09:00:00.000Z"),
  ];
  const state = markAllInternalNotificationsRead(original);
  assert.deepEqual(deriveInternalNotifications(original, state).map((item) => item.unread), [false, false]);

  const changedGroup = activity("group:g1", "2026-09-06T11:00:00.000Z");
  const notifications = deriveInternalNotifications([changedGroup, original[0]], state);
  assert.deepEqual(notifications.map((item) => item.unread), [true, false]);
});

test("marcar todo limita el estado a las 100 actividades actuales más recientes", () => {
  const items = Array.from({ length: 125 }, (_, index) => activity(
    `round:r${index}`,
    new Date(Date.UTC(2026, 8, 6, 0, index)).toISOString(),
  )).reverse();
  const state = markAllInternalNotificationsRead(items);
  assert.equal(state.readEventKeys.length, INTERNAL_NOTIFICATION_READ_LIMIT);
  assert.equal(state.readEventKeys[0], internalNotificationEventKey(items[0]));
  assert.equal(state.readEventKeys.at(-1), internalNotificationEventKey(items[99]));
  assert.equal(deriveInternalNotifications(items, state).filter((item) => item.unread).length, 25);

  const pruned = persistInternalNotificationReadState(new MemoryStorage(), "account-a", {
    version: 1,
    readEventKeys: [...state.readEventKeys, "stale-event"],
  }, items.slice(0, 3));
  assert.equal(pruned.ok, true);
  assert.deepEqual(pruned.state.readEventKeys, items.slice(0, 3).map(internalNotificationEventKey));
});

test("las marcas de lectura quedan aisladas por cuenta", () => {
  const storage = new MemoryStorage();
  const items = [activity("round:private", "2026-09-06T10:00:00.000Z")];
  const written = markAllInternalNotificationsReadInStorage(storage, "account-a", items);
  assert.equal(written.ok, true);
  assert.notEqual(internalNotificationStorageKey("account-a"), internalNotificationStorageKey("account-b"));
  assert.deepEqual(readInternalNotificationReadState(storage, "account-a", items).state.readEventKeys, written.state.readEventKeys);
  assert.deepEqual(readInternalNotificationReadState(storage, "account-b", items).state.readEventKeys, []);
});

test("un error de escritura se devuelve explícitamente y nunca afirma persistencia", () => {
  const items = [activity("round:r1", "2026-09-06T10:00:00.000Z")];
  const result = markAllInternalNotificationsReadInStorage({
    setItem() { throw new Error("quota exceeded"); },
  }, "account-a", items);
  assert.deepEqual(result, {
    ok: false,
    persisted: false,
    state: markAllInternalNotificationsRead(items),
    error: "storage_write_failed",
  });
});

test("identidad faltante y error de lectura se distinguen sin compartir namespace", () => {
  assert.deepEqual(readInternalNotificationReadState(new MemoryStorage(), "  "), {
    ok: false,
    state: { version: 1, readEventKeys: [] },
    error: "identity_missing",
  });
  assert.deepEqual(readInternalNotificationReadState({ getItem() { throw new Error("blocked"); } }, "account-a"), {
    ok: false,
    state: { version: 1, readEventKeys: [] },
    error: "storage_read_failed",
  });
});

test("un aviso se puede marcar leído y no leído sin perder las demás marcas", () => {
  const first = activity("round:r1", "2026-09-06T10:00:00.000Z");
  const second = activity("group:g1", "2026-09-06T09:00:00.000Z");
  const firstRead = setInternalNotificationRead({ version: 1, readEventKeys: [] }, first, true);
  const bothRead = setInternalNotificationRead(firstRead, second, true);

  assert.deepEqual(deriveInternalNotifications([first, second], bothRead).map((item) => item.unread), [false, false]);
  const firstUnread = setInternalNotificationRead(bothRead, first, false);
  assert.deepEqual(deriveInternalNotifications([first, second], firstUnread).map((item) => item.unread), [true, false]);
});

test("avisos locales duplicados no inflan el contador ni repiten claves React", () => {
  const original = activity("round:r1", "2026-09-06T10:00:00.000Z");
  const duplicate = { ...original, title: "Copia recuperada" };
  const notifications = deriveInternalNotifications([original, duplicate], { version: 1, readEventKeys: [] });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, original.title);
  assert.equal(notifications[0].unread, true);
});
