import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DEFAULT_MANUAL_AVATAR, MANUAL_AVATAR_OPTIONS, manualAvatarSvg, manualAvatarUrl, parseManualAvatarConfig, parseManualAvatarUrl, randomManualAvatarConfig } from "../lib/manual-avatar";
import { legacyManualAvatarUrl, type LegacyManualAvatarConfig } from "../lib/manual-avatar-legacy";
import { mergeBackyardProfile, normalizeBackyardProfileCache, safeProfileAvatarValue, validateProfileAvatarUrl, type BackyardProfile } from "../lib/account-state";
import { profileAvatarType } from "../lib/profile-avatar";
import { ensureCloudProfile, saveCloudProfile } from "../lib/cloud-account";
import { CloudDb } from "./helpers/cloud-db";

const owner = "manual-avatar-owner";
const profile: BackyardProfile = { userId: owner, displayName: "Said", email: "said@example.test", defaultHandicap: 7, avatarUrl: "" };

test("configurador local incluye las categorías avanzadas versionadas", () => {
  assert.deepEqual(Object.keys(MANUAL_AVATAR_OPTIONS), ["rostro", "mandibula", "mejillas", "orejas", "piel", "pelo", "colorPelo", "cejas", "ojos", "colorOjos", "nariz", "boca", "barba", "colorBarba", "lentes", "sombrero", "ropa", "colorRopa", "accesorio", "fondo"]);
  for (const [key, choices] of Object.entries(MANUAL_AVATAR_OPTIONS)) {
    assert.ok(choices.length >= 3, key);
    for (const choice of choices) {
      const config = { ...DEFAULT_MANUAL_AVATAR, [key]: choice };
      const parsed = parseManualAvatarConfig(config);
      assert.ok(parsed, `${key}: ${choice}`);
      assert.deepEqual(parseManualAvatarUrl(manualAvatarUrl(parsed)), parsed);
    }
  }
});

test("SVG canónico contiene sólo capas locales y metadata regenerable", () => {
  const config = { ...DEFAULT_MANUAL_AVATAR, pelo: "rizado" as const, lentes: "redondos" as const, barba: "corta" as const };
  const svg = manualAvatarSvg(config);
  const url = manualAvatarUrl(config);
  assert.deepEqual(parseManualAvatarUrl(url), config);
  assert.equal(manualAvatarUrl(parseManualAvatarUrl(url)!), url);
  assert.equal(profileAvatarType(url), "custom_avatar");
  assert.deepEqual(validateProfileAvatarUrl(url), { ok: true, avatarUrl: url });
  assert.ok(url.length < 30_000);
  assert.match(svg, /<metadata id="backyard-avatar-config">/);
  assert.doesNotMatch(svg, /<script|<foreignObject|<image|<use|href=|https:\/\//i);
});

test("avatares v1/v2 existentes se validan de forma canónica y migran a v3", () => {
  const old: LegacyManualAvatarConfig = { version: 2, persona: "golfista", fondo: "sage", rostro: "ovalado", piel: "media", pelo: "corto", colorPelo: "castano", ojos: "almendrados", colorOjos: "cafe", cejas: "suaves", nariz: "recta", boca: "sonrisa", barba: "ninguna", accesorio: "ninguno" };
  const oldUrl = legacyManualAvatarUrl(old);
  const parsedV2 = parseManualAvatarUrl(oldUrl);
  assert.equal(parsedV2?.version, 3);
  assert.equal(parsedV2?.ropa, "polo");
  assert.equal(parsedV2?.fondo, "green");
  const currentSvg = atob(oldUrl.split(",")[1]);
  const legacyFields = Object.fromEntries(Object.entries(old).filter(([key]) => key !== "version" && key !== "fondo"));
  const legacy = { version: 1, ...legacyFields };
  const legacySvg = currentSvg.replace(
    /<metadata id="backyard-avatar-config">[A-Za-z0-9+/]+={0,2}<\/metadata>/,
    `<metadata id="backyard-avatar-config">${btoa(JSON.stringify(legacy))}</metadata>`,
  );
  const parsed = parseManualAvatarUrl(`data:image/svg+xml;base64,${btoa(legacySvg)}`);
  assert.equal(parsed?.version, 3);
  assert.equal(parsed?.fondo, "green");
});

test("SVG arbitrario, cambios de config, scripts y recursos externos se rechazan", () => {
  const canonical = manualAvatarUrl(DEFAULT_MANUAL_AVATAR);
  const svg = atob(canonical.split(",")[1]);
  const invalid = [
    "data:image/svg+xml;base64,AAAA",
    "data:image/svg+xml,<svg onload=alert(1) />",
    `data:image/svg+xml;base64,${btoa(svg.replace("Avatar Backyard", "Avatar alterado"))}`,
    `data:image/svg+xml;base64,${btoa(svg.replace("</svg>", "<script>alert(1)</script></svg>"))}`,
    `data:image/svg+xml;base64,${btoa(svg.replace("</svg>", "<foreignObject/><image href='https://evil.invalid/x'/></svg>"))}`,
    `data:image/svg+xml;base64,${btoa(svg.replace("backyard-avatar-config", "other-config"))}`,
  ];
  for (const value of invalid) {
    assert.equal(parseManualAvatarUrl(value), null);
    assert.equal(validateProfileAvatarUrl(value).ok, false);
    assert.equal(safeProfileAvatarValue(value), "");
  }
  assert.equal(parseManualAvatarConfig({ ...DEFAULT_MANUAL_AVATAR, surprise: "injection" }), null);
  assert.equal(parseManualAvatarConfig({ ...DEFAULT_MANUAL_AVATAR, version: 1 }), null);
  assert.equal(parseManualAvatarConfig({ ...DEFAULT_MANUAL_AVATAR, piel: "<script>" }), null);
});

test("aleatorio es reproducible con fuente controlada y no altera el default", () => {
  const config = randomManualAvatarConfig(() => .999);
  assert.equal(config.sombrero, "bucket");
  assert.equal(config.piel, DEFAULT_MANUAL_AVATAR.piel);
  assert.deepEqual(parseManualAvatarUrl(manualAvatarUrl(config)), config);
  assert.equal(DEFAULT_MANUAL_AVATAR.ropa, "polo");
});

test("avatar manual guarda configuración en cache y cloud sin columna nueva y recarga para edición", async () => {
  const config = { ...DEFAULT_MANUAL_AVATAR, rostro: "redondo" as const, piel: "oscura" as const, sombrero: "gorra" as const };
  const url = manualAvatarUrl(config);
  const next = mergeBackyardProfile(profile, { displayName: "Said", defaultHandicap: 7, avatarUrl: url });
  const cached = normalizeBackyardProfileCache(JSON.parse(JSON.stringify(next)), profile);
  assert.deepEqual(parseManualAvatarUrl(cached.avatarUrl), config);
  const db = new CloudDb();
  await saveCloudProfile(db.client, owner, { displayName: "Said", defaultHandicap: 7, avatarUrl: url }, "2026-09-15T15:00:00.000Z");
  const hydrated = await ensureCloudProfile(db.client, owner, profile);
  assert.equal(hydrated.avatar_url, url);
  assert.deepEqual(parseManualAvatarUrl(safeProfileAvatarValue(hydrated.avatar_url)), config);
  assert.equal(db.rows("profiles").length, 1);
});

test("UI creador ya no conecta a servicios externos y avatar recargado no abre editor", () => {
  const creator = readFileSync("app/components/avatar-creation-panel.tsx", "utf8");
  const picker = readFileSync("app/components/profile-image-picker.tsx", "utf8");
  assert.doesNotMatch(creator, /fetch\(|avatar-generation|OpenAI|accessToken|userId/);
  assert.match(creator, /ALEATORIO/);
  assert.match(creator, /USAR ESTE AVATAR/);
  assert.match(creator, /VOLVER/);
  assert.match(picker, /type === "custom_avatar" \? "avatar" : type/);
  assert.match(picker, /mode === "avatar" && <AvatarCreationPanel/);
  assert.doesNotMatch(picker, /onSaveAvatar/);
  assert.match(picker, /onChange\(url\)/);
  assert.match(creator, /PLAYERA \/ POLO/);
  assert.match(creator, /FONDO/);
});

test("colores táctiles y opciones de pelo, barba y accesorios exigidos están disponibles", () => {
  for (const option of ["sinPelo", "medio", "ondulado"]) assert.ok((MANUAL_AVATAR_OPTIONS.pelo as readonly string[]).includes(option));
  for (const option of ["cafeOscuro", "cafe", "blanco"]) assert.ok((MANUAL_AVATAR_OPTIONS.colorPelo as readonly string[]).includes(option));
  for (const option of ["media", "completa", "candado", "barbaBigote"]) assert.ok((MANUAL_AVATAR_OPTIONS.barba as readonly string[]).includes(option));
  for (const option of ["redondos", "aviador", "sol"]) assert.ok((MANUAL_AVATAR_OPTIONS.lentes as readonly string[]).includes(option));
  for (const option of ["visera", "gorraGolf", "bucket"]) assert.ok((MANUAL_AVATAR_OPTIONS.sombrero as readonly string[]).includes(option));
  const creator = readFileSync("app/components/avatar-creation-panel.tsx", "utf8");
  assert.match(creator, /MANUAL_AVATAR_SWATCHES/);
  assert.match(creator, /className=\{styles.swatch\}/);
});

test("Home, navegación, ronda y Social consumen el mismo media validado; onboarding no duplica Grupos", () => {
  const media = readFileSync("app/components/profile-avatar-media.tsx", "utf8");
  const home = readFileSync("app/components/home-dashboard.tsx", "utf8");
  const navigation = readFileSync("app/components/profile-navigation-button.tsx", "utf8");
  const round = readFileSync("app/components/round-capture-v2.tsx", "utf8");
  const social = readFileSync("app/components/social-connections-panel.tsx", "utf8");
  const group = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  assert.match(media, /safeProfileAvatarValue\(value\)/);
  assert.match(home, /<ProfileAvatarMedia value=\{avatarUrl\}/);
  assert.match(navigation, /<ProfileAvatarMedia value=\{avatarUrl\}/);
  assert.match(round, /<ProfileAvatarMedia className=\{styles.avatar\} value=\{activePlayer.id === owner\?\.id \? ownerAvatarUrl : undefined\}/);
  assert.match(social, /<ProfileAvatarMedia value=\{p.avatar_url\}/);
  assert.doesNotMatch(group, /ProfileImagePicker[^>]+kind="group"|GroupInviteManager/);
});
