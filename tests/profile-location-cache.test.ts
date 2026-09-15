import assert from "node:assert/strict";
import test from "node:test";
import { mergeBackyardProfile, normalizeBackyardProfileCache, type BackyardProfile } from "../lib/account-state";

const base: BackyardProfile = { userId: "profile-location-owner", email: "qa@example.test", displayName: "Said", avatarUrl: "😎", defaultHandicap: 7 };
const core = { displayName: "Said", avatarUrl: "😎", defaultHandicap: 7 };
const puebla = { countryCode: "MX", country: "México", stateCode: "MX-PUE", state: "Puebla", locationUpdatedAt: "2026-09-15T12:00:00.000Z" };

test("perfil conserva códigos geográficos y fecha tras serializar/recargar", () => {
  const profile = mergeBackyardProfile(base, { ...core, ...puebla });
  const restored = normalizeBackyardProfileCache(JSON.parse(JSON.stringify(profile)), base);
  for (const key of Object.keys(puebla) as (keyof typeof puebla)[]) assert.equal(restored[key], puebla[key]);
  const avatarChanged = mergeBackyardProfile(restored, { ...core, avatarUrl: "🏌️" });
  assert.equal(avatarChanged.stateCode, "MX-PUE");
  assert.equal(avatarChanged.countryCode, "MX");
  assert.equal(avatarChanged.locationUpdatedAt, puebla.locationUpdatedAt);
});

test("cambiar país por código o nombre legacy nunca conserva Puebla", () => {
  const mexican = mergeBackyardProfile(base, { ...core, ...puebla });
  for (const patch of [{ countryCode: "US" }, { country: "United States" }, { countryCode: "US", country: "Estados Unidos", state: "", stateCode: "" }]) {
    const changed = mergeBackyardProfile(mexican, { ...core, ...patch });
    assert.equal(changed.countryCode, "US");
    assert.equal(changed.country, "Estados Unidos");
    assert.equal(changed.stateCode, "");
    assert.equal(changed.state, "");
  }
  const cleared = mergeBackyardProfile(mexican, { ...core, countryCode: "", country: "", stateCode: "", state: "" });
  assert.equal(cleared.countryCode, "");
  assert.equal(cleared.state, "");
  assert.equal(mexican.state, "Puebla");
});

test("un cambio de nombre de estado no reutiliza el código del estado anterior", () => {
  const mexican = mergeBackyardProfile(base, { ...core, ...puebla });
  const changed = mergeBackyardProfile(mexican, { ...core, state: "Jalisco" });
  assert.equal(changed.stateCode, "MX-JAL");
  assert.equal(changed.state, "Jalisco");
  const legacy = normalizeBackyardProfileCache({ ...base, country: "País anterior", state: "Región anterior" }, base);
  assert.equal(mergeBackyardProfile(legacy, { ...core, avatarUrl: "🏌️" }).state, "Región anterior");
});
