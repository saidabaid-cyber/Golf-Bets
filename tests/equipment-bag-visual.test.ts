import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { BAG_CATEGORY_SECTIONS } from "../lib/equipment-bag-management";

const source = (path: string) => readFileSync(path, "utf8");

const APPROVED_ASSETS = [
  { file: "driver_ref_b.png", width: 1006, height: 396, sha256: "FE1773758BC305334A0A7D7DCF80A69DA84F2E938A414EE8F01E4B2278937324" },
  { file: "mini-driver_ref_b.png", width: 1996, height: 788, sha256: "37533C9E04A679D8878BDA95945FCA3310FD00979B3BB0B74FFF69E5CFCABFE9" },
  { file: "maderas_ref_b.png", width: 1006, height: 408, sha256: "EE1C3350EC046D0D5DE2653254512E6012F541707A18D09006F7B5456205790D" },
  { file: "hibridos_ref_b.png", width: 1006, height: 410, sha256: "6AE007F531177914236EB09EBE1FC7DEADFE7FA9E4861717CEB1A8CCCA662782" },
  { file: "utility-driving-iron_ref_b.png", width: 1959, height: 803, sha256: "BAAA8C6B685840D5D725916EF2AE9A544ECC9778C21F70D7D62FEB219DF7DC12" },
  { file: "hierros_ref_b.png", width: 1006, height: 412, sha256: "B5A3093D63035BC130CD3FB087FB3E287343573C1E55C405A812966C101A9DEE" },
  { file: "wedges_ref_b.png", width: 1006, height: 412, sha256: "31C3986E305FD124117AC800A160D2BC31201C7C7088E49812A0C6A0E928C925" },
  { file: "putter_ref_b.png", width: 1006, height: 468, sha256: "C013D116BC94F3BACDF3F93E9C29BED1AD76CA78F989E0DF5D49F1E76DCF24B5" },
] as const;

test("Construye tu bolsa preserves the eight canonical category images byte for byte", () => {
  const onboarding = source("app/components/equipment-onboarding.tsx");
  const assets = source("app/components/equipment-category-assets.ts");

  for (const asset of APPROVED_ASSETS) {
    const relative = `/brand/equipment/onboarding-ref-b/${asset.file}`;
    const bytes = readFileSync(join("public", "brand", "equipment", "onboarding-ref-b", asset.file));

    assert.match(assets, new RegExp(relative.replaceAll("/", "\\/")));
    assert.equal(createHash("sha256").update(bytes).digest("hex").toUpperCase(), asset.sha256);
    assert.equal(bytes.readUInt32BE(16), asset.width);
    assert.equal(bytes.readUInt32BE(20), asset.height);
  }

  assert.match(onboarding, /EQUIPMENT_CATEGORY_ASSETS\[category\]/);
  assert.match(onboarding, /<Image className=\{styles\.visualClubImage\}/);
  assert.match(onboarding, /<Image className=\{styles\.visualClubImage\}[\s\S]*?unoptimized \/>/);
  assert.doesNotMatch(onboarding, /ClubCategoryVisual/);
  assert.doesNotMatch(onboarding, /useMasterBrand/);
});

test("Construye tu bolsa renders exactly the canonical eight-card hierarchy and approved copy", () => {
  const onboarding = source("app/components/equipment-onboarding.tsx");
  const buildBlock = onboarding.slice(onboarding.indexOf('{step === "clubs-build"'), onboarding.indexOf('{step === "ball-prompt"'));

  const categories = BAG_CATEGORY_SECTIONS.map((section) => ({
    category: section.categories[0],
    label: section.label,
    description: section.onboardingDescription,
  }));

  assert.deepEqual(categories, [
    { category: "DRIVER", label: "Driver", description: "Máxima distancia para tus tiros de salida." },
    { category: "MINI_DRIVER", label: "Mini Driver", description: "Control desde el tee con una cabeza compacta." },
    { category: "FAIRWAY_WOOD", label: "Maderas", description: "Versatilidad y distancia en el campo." },
    { category: "HYBRID", label: "Híbridos", description: "Confianza en cada lie." },
    { category: "UTILITY_IRON", label: "Utility / Driving Iron", description: "Trayectoria penetrante y control desde el tee." },
    { category: "IRON_SET", label: "Hierros", description: "Precisión para un mejor control." },
    { category: "WEDGE", label: "Wedges", description: "Creatividad alrededor del green." },
    { category: "PUTTER", label: "Putter", description: "Decisión en los últimos golpes." },
  ]);

  assert.match(buildBlock, /Construye tu bolsa/);
  assert.match(onboarding, /BAG_CATEGORY_SECTIONS\.map/);
  assert.match(buildBlock, /Agrega sólo lo que quieras\. Marca \+ modelo es suficiente<br \/>y puedes regresar después desde Perfil\./);
  assert.match(buildBlock, /<BrandLockup compact \/>/);
  assert.match(buildBlock, /className=\{styles\.bagBack\} aria-label="Volver" onClick=\{previous\}/);
  assert.doesNotMatch(buildBlock, /styles\.bagIcon|aria-label="Guardar y continuar después"/);
  assert.match(buildBlock, /configured \? "✓ En mi bolsa" : "Agregar a mi bolsa"/);
  assert.doesNotMatch(buildBlock, /Ver todas las categorías/);
  assert.match(buildBlock, /configured \? "✓" : "\+"/);
  assert.doesNotMatch(buildBlock, /›/);
  assert.doesNotMatch(buildBlock, /savedName|catalog\.brand|catalog\.model/);
});

test("each complete onboarding card opens its matching selector without adding equipment", () => {
  const onboarding = source("app/components/equipment-onboarding.tsx");
  const buildBlock = onboarding.slice(onboarding.indexOf('{step === "clubs-build"'), onboarding.indexOf('{step === "ball-prompt"'));

  assert.match(buildBlock, /ONBOARDING_CLUB_CATEGORIES\.map\(\(\{ category,[\s\S]*key=\{category\}/);
  assert.match(buildBlock, /onClick=\{\(\) => \{ if \(category === "WEDGE"\) \{ setWedgeCollectionOpen\(true\); return; \} setClubEditorCategory\(category\); setClubEditorOpen\(true\); \}\}/);
  assert.match(onboarding, /if \(wedgeCollectionOpen\)[\s\S]*?<WedgeCollectionEditor[\s\S]*?wedges=\{currentWedges\}/);
  assert.match(onboarding, /initialCategory=\{clubEditorCategory \|\| undefined\}/);
  assert.match(onboarding, /onCancel=\{\(\) => \{ setClubEditorOpen\(false\); setClubEditorCategory\(null\); \}\}/);
  assert.doesNotMatch(buildBlock, /upsertPlayerClub|saveClub\(/);
});

test("configured equipment remains visible and returning preserves onboarding progress", () => {
  const onboarding = source("app/components/equipment-onboarding.tsx");

  assert.match(onboarding, /const clubs = currentClubs\.filter\(\(club\) => club\.category === category\)/);
  assert.match(onboarding, /const configured = clubs\.length > 0/);
  assert.match(onboarding, /className=\{configured \? styles\.visualClubSelected : styles\.visualClubCard\}/);
  assert.match(onboarding, /configured \? "✓ En mi bolsa" : "Agregar a mi bolsa"/);
  assert.doesNotMatch(onboarding, /savedName && <span>✓ \{savedName\}/);
  assert.match(onboarding, /if \(saved\) setClubEditorOpen\(false\)/);
  assert.match(onboarding, /currentClubs\.length \? "Continuar con mi bolsa" : "Continuar sin bastones"/);
});

test("mobile REF-B hero and cards preserve the approved composition without overflowing at 390px", () => {
  const css = source("app/components/equipment.module.css");

  assert.match(css, /data-equipment-step="clubs-build"\] \{ overflow-x:clip/);
  assert.match(css, /\.bagHero \{[\s\S]*onboarding-course-hero\.png/);
  assert.match(css, /@media\(max-width:560px\)[\s\S]*\.visualBagGrid \{ gap:8px/);
  assert.match(css, /@media\(max-width:560px\)[\s\S]*\.visualClubCard,\.visualClubSelected \{ grid-template-columns:minmax\(0,36%\) minmax\(0,1fr\) 40px;height:110px;min-height:110px/);
  assert.match(css, /\.visualClubMedia > \.visualClubImage \{ width:100%;height:100%;object-fit:cover;object-position:center/);
  assert.match(css, /\.visualClubCard,\.visualClubSelected \{[\s\S]*overflow:hidden/);
  assert.match(css, /\.visualClubCopy > \.visualClubAction \{[\s\S]*background:#e9f1e5/);
  assert.match(css, /\.visualClubCard > strong,\.visualClubSelected > strong \{ display:grid;width:48px;height:48px;[^}]*background:#0d7043;[^}]*color:#fff/);
  assert.match(css, /data-equipment-step="clubs-build"\] \.syncStatus \{ display:none/);
  assert.doesNotMatch(css, /\.visualClubProduct\[data-club-category=/);
});

test("onboarding and Mi Bolsa category selection consume one canonical asset registry", () => {
  const assets = source("app/components/equipment-category-assets.ts");
  const onboarding = source("app/components/equipment-onboarding.tsx");
  const editors = source("app/components/equipment-editors.tsx");

  const expected = {
    DRIVER: "driver_ref_b.png",
    MINI_DRIVER: "mini-driver_ref_b.png",
    FAIRWAY_WOOD: "maderas_ref_b.png",
    HYBRID: "hibridos_ref_b.png",
    UTILITY_IRON: "utility-driving-iron_ref_b.png",
    IRON_SET: "hierros_ref_b.png",
    WEDGE: "wedges_ref_b.png",
    PUTTER: "putter_ref_b.png",
  } as const;

  for (const [category, file] of Object.entries(expected)) {
    assert.match(assets, new RegExp(`${category}: \\{ src: \"\\/brand\\/equipment\\/onboarding-ref-b\\/${file.replace(".", "\\.")}`));
  }
  assert.match(onboarding, /import \{ EQUIPMENT_CATEGORY_ASSETS \} from "\.\/equipment-category-assets"/);
  assert.match(editors, /import \{ EQUIPMENT_CATEGORY_ASSETS \} from "\.\/equipment-category-assets"/);
  assert.match(editors, /const asset = EQUIPMENT_CATEGORY_ASSETS\[category\]/);
  assert.doesNotMatch(editors, /backyard-(driver|fairway|hybrid|irons|wedge|putter)-clean\.png/);
  assert.doesNotMatch(editors, /ClubCategoryVisual/);
});

test("Mi Bolsa keeps distinct Mini Driver and Utility assets and compact navigable rows", () => {
  const assets = source("app/components/equipment-category-assets.ts");
  const editors = source("app/components/equipment-editors.tsx");
  const profile = source("app/components/equipment-profile-panel.tsx");
  const css = source("app/components/equipment.module.css");
  const mini = readFileSync(join("public", "brand", "equipment", "onboarding-ref-b", "mini-driver_ref_b.png"));
  const utility = readFileSync(join("public", "brand", "equipment", "onboarding-ref-b", "utility-driving-iron_ref_b.png"));
  const driver = readFileSync(join("public", "brand", "equipment", "onboarding-ref-b", "driver_ref_b.png"));
  const irons = readFileSync(join("public", "brand", "equipment", "onboarding-ref-b", "hierros_ref_b.png"));

  assert.match(assets, /MINI_DRIVER: \{ src: "\/brand\/equipment\/onboarding-ref-b\/mini-driver_ref_b\.png"/);
  assert.match(assets, /UTILITY_IRON: \{ src: "\/brand\/equipment\/onboarding-ref-b\/utility-driving-iron_ref_b\.png"/);
  assert.notEqual(createHash("sha256").update(mini).digest("hex"), createHash("sha256").update(driver).digest("hex"));
  assert.notEqual(createHash("sha256").update(utility).digest("hex"), createHash("sha256").update(irons).digest("hex"));
  assert.match(editors, /return <button type="button" key=\{category\} aria-label=\{label\} onClick=\{\(\) => chooseCategory\(category\)\}/);
  assert.match(editors, /<strong aria-hidden="true">›<\/strong>/);
  assert.match(css, /\.catalogChoiceGrid button \{ display: grid; grid-template-columns: 88px minmax\(0, 1fr\) 28px; min-height: 66px/);
  assert.match(profile, /import \{ EQUIPMENT_CATEGORY_ASSETS \} from "\.\/equipment-category-assets"/);
  assert.match(profile, /const asset = EQUIPMENT_CATEGORY_ASSETS\[category\]/);
  assert.match(profile, /<CanonicalCategoryImage category=\{club\.category\}[^>]*eager=\{club\.isCurrent\}/);
  assert.match(profile, /<CanonicalCategoryImage category=\{category\}[^>]*sizes="\(max-width: 430px\) 104px, 132px"/);
  assert.doesNotMatch(profile, /ClubCategoryVisual/);
  assert.match(css, /\.profileClubButton \{[^}]*grid-template-columns:132px minmax\(0,1fr\) max-content/);
  assert.match(css, /@media\(max-width:430px\)[\s\S]*\.profileClubButton \{[^}]*grid-template-columns:112px minmax\(0,1fr\) max-content/);
  assert.match(css, /\.missingCategoryCard \{[^}]*overflow:hidden/);
});
