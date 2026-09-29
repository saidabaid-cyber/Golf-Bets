import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

const APPROVED_ASSETS = [
  { file: "driver_ref_b.png", width: 1006, height: 396, sha256: "FE1773758BC305334A0A7D7DCF80A69DA84F2E938A414EE8F01E4B2278937324" },
  { file: "maderas_ref_b.png", width: 1006, height: 408, sha256: "EE1C3350EC046D0D5DE2653254512E6012F541707A18D09006F7B5456205790D" },
  { file: "hibridos_ref_b.png", width: 1006, height: 410, sha256: "6AE007F531177914236EB09EBE1FC7DEADFE7FA9E4861717CEB1A8CCCA662782" },
  { file: "hierros_ref_b.png", width: 1006, height: 412, sha256: "B5A3093D63035BC130CD3FB087FB3E287343573C1E55C405A812966C101A9DEE" },
  { file: "wedges_ref_b.png", width: 1006, height: 412, sha256: "31C3986E305FD124117AC800A160D2BC31201C7C7088E49812A0C6A0E928C925" },
  { file: "putter_ref_b.png", width: 1006, height: 468, sha256: "C013D116BC94F3BACDF3F93E9C29BED1AD76CA78F989E0DF5D49F1E76DCF24B5" },
] as const;

test("Construye tu bolsa preserves the six approved REF-B images byte for byte", () => {
  const onboarding = source("app/components/equipment-onboarding.tsx");

  for (const asset of APPROVED_ASSETS) {
    const relative = `/brand/equipment/onboarding-ref-b/${asset.file}`;
    const bytes = readFileSync(join("public", "brand", "equipment", "onboarding-ref-b", asset.file));

    assert.match(onboarding, new RegExp(relative.replaceAll("/", "\\/")));
    assert.equal(createHash("sha256").update(bytes).digest("hex").toUpperCase(), asset.sha256);
    assert.equal(bytes.readUInt32BE(16), asset.width);
    assert.equal(bytes.readUInt32BE(20), asset.height);
  }

  assert.match(onboarding, /<Image className=\{styles\.visualClubImage\}/);
  assert.match(onboarding, /<Image className=\{styles\.visualClubImage\}[\s\S]*?unoptimized \/>/);
  assert.doesNotMatch(onboarding, /ClubCategoryVisual/);
  assert.doesNotMatch(onboarding, /useMasterBrand/);
});

test("Construye tu bolsa renders exactly the approved six-card hierarchy and copy", () => {
  const onboarding = source("app/components/equipment-onboarding.tsx");
  const categoryBlock = onboarding.slice(onboarding.indexOf("const ONBOARDING_CLUB_CATEGORIES"), onboarding.indexOf("type EquipmentOnboardingProps"));
  const buildBlock = onboarding.slice(onboarding.indexOf('{step === "clubs-build"'), onboarding.indexOf('{step === "ball-prompt"'));

  const categories = [...categoryBlock.matchAll(/category: "([A-Z_]+)", label: "([^"]+)", description: "([^"]+)"/g)]
    .map((match) => ({ category: match[1], label: match[2], description: match[3] }));

  assert.deepEqual(categories, [
    { category: "DRIVER", label: "Driver", description: "Máxima distancia y confianza" },
    { category: "FAIRWAY_WOOD", label: "Maderas", description: "Versatilidad en cada golpe" },
    { category: "HYBRID", label: "Híbridos", description: "Precisión en cualquier terreno" },
    { category: "IRON_SET", label: "Hierros", description: "Control y consistencia" },
    { category: "WEDGE", label: "Wedges", description: "Creatividad en cada situación" },
    { category: "PUTTER", label: "Putter", description: "Confianza en el último golpe" },
  ]);

  assert.match(buildBlock, /Construye tu bolsa/);
  assert.match(buildBlock, /Selecciona tu equipamiento ideal/);
  assert.doesNotMatch(buildBlock, /Agregar a mi bolsa/);
  assert.doesNotMatch(buildBlock, /Ver todas las categorías/);
  assert.doesNotMatch(buildBlock, /clubs\.length \? "✓" : "\+"/);
  assert.match(buildBlock, /<strong aria-hidden="true">›<\/strong>/);
});

test("each complete onboarding card opens its matching selector without adding equipment", () => {
  const onboarding = source("app/components/equipment-onboarding.tsx");
  const buildBlock = onboarding.slice(onboarding.indexOf('{step === "clubs-build"'), onboarding.indexOf('{step === "ball-prompt"'));

  assert.match(buildBlock, /ONBOARDING_CLUB_CATEGORIES\.map\(\(\{ category,[\s\S]*key=\{category\}/);
  assert.match(buildBlock, /onClick=\{\(\) => \{ setClubEditorCategory\(category\); setClubEditorOpen\(true\); \}\}/);
  assert.match(onboarding, /initialCategory=\{clubEditorCategory \|\| undefined\}/);
  assert.match(onboarding, /onCancel=\{\(\) => \{ setClubEditorOpen\(false\); setClubEditorCategory\(null\); \}\}/);
  assert.doesNotMatch(buildBlock, /upsertPlayerClub|saveClub\(/);
});

test("configured equipment remains visible and returning preserves onboarding progress", () => {
  const onboarding = source("app/components/equipment-onboarding.tsx");

  assert.match(onboarding, /const clubs = currentClubs\.filter\(\(club\) => club\.category === category\)/);
  assert.match(onboarding, /const savedName = first \?/);
  assert.match(onboarding, /savedName && <span>✓ \{savedName\}/);
  assert.match(onboarding, /className=\{clubs\.length \? styles\.visualClubSelected : styles\.visualClubCard\}/);
  assert.match(onboarding, /if \(saved\) setClubEditorOpen\(false\)/);
});

test("mobile REF-B cards keep their source crop and cannot overflow at 390px", () => {
  const css = source("app/components/equipment.module.css");

  assert.match(css, /data-equipment-step="clubs-build"\] \{ overflow-x:clip/);
  assert.match(css, /@media\(max-width:560px\)[\s\S]*\.visualClubCard,\.visualClubSelected \{ grid-template-columns:minmax\(0,62%\) minmax\(0,1fr\) 34px/);
  assert.match(css, /\.visualClubMedia > \.visualClubImage \{[^}]*width:100%;height:auto;object-fit:contain/);
  assert.match(css, /\.visualClubCard,\.visualClubSelected \{[\s\S]*overflow:hidden/);
  assert.match(css, /\.visualClubCard > strong,\.visualClubSelected > strong \{ display:grid;width:48px;height:48px;[^}]*background:#eef0ee/);
  assert.doesNotMatch(css, /\.visualClubProduct\[data-club-category=/);
});
