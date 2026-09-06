import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { InternalNotificationList } from "../app/components/social-feed";
import type { InternalNotification } from "../lib/internal-notifications";

function notice(overrides: Partial<InternalNotification>): InternalNotification {
  return {
    id: "round:r1",
    kind: "round",
    title: "Ronda guardada",
    detail: "Tarjeta disponible en Histórico",
    occurredAt: "2026-09-06T10:00:00.000Z",
    roundId: "r1",
    eventKey: '["round:r1","2026-09-06T10:00:00.000Z"]',
    unread: true,
    ...overrides,
  };
}

test("cada aviso ofrece control accesible de lectura sin obligar a abrirlo", () => {
  const markup = renderToStaticMarkup(createElement(InternalNotificationList, {
    notifications: [
      notice({}),
      notice({
        id: "group:g1",
        kind: "group",
        title: "Grupo actualizado",
        groupId: undefined,
        roundId: undefined,
        eventKey: '["group:g1","2026-09-06T09:00:00.000Z"]',
        occurredAt: "2026-09-06T09:00:00.000Z",
        unread: false,
      }),
    ],
    onOpen: () => undefined,
    onReadChange: () => undefined,
  }));

  assert.match(markup, /Ronda guardada Abrir/);
  assert.match(markup, /Marcar como leído/);
  assert.match(markup, /Marcar como no leído/);
  assert.match(markup, /Marcar “Grupo actualizado” como no leído/);
});
