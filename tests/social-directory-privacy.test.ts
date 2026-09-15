import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { searchSocialProfiles } from "../features/social/domain";

test("Social no convierte jugadores frecuentes en usernames ni privacidad inventados", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /knownProfiles=\{EMPTY_SOCIAL_DIRECTORY\}/);
  assert.doesNotMatch(page, /knownProfiles=\{frequentPlayers\.filter/);
});

test("un perfil privado no aparece en sugerencias locales sin amistad verificada", () => {
  const privateProfile = { userId: "peer", username: "peer.real", displayName: "Peer", privacy: "PRIVATE" as const };
  assert.deepEqual(searchSocialProfiles([privateProfile], "peer", "owner", []), []);
});

test("la interfaz no fabrica una solicitud de amistad local que nadie recibiría", () => {
  const panel = readFileSync("app/components/social-connections-panel.tsx", "utf8");
  assert.doesNotMatch(panel, /createFriendRequest\(/);
  assert.match(panel, /No se envió una solicitud/);
  assert.match(panel, /Próximamente/);
});
