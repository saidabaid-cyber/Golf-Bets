import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const source = (path: string) => readFileSync(path, "utf8");
type Node = { type?: unknown; props?: { children?: unknown; onClick?: () => void; className?: string } };
function children(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(children);
  if (!value || typeof value !== "object") return [];
  const node = value as Node;
  return [node, ...children(node.props?.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (typeof value === "string" || typeof value === "number") return String(value);
  return value && typeof value === "object" ? text((value as Node).props?.children) : "";
}
function hub(props: Record<string, unknown>) {
  const exports: { PlayHub?: (props: Record<string, unknown>) => unknown } = {};
  const code = ts.transpileModule(source("app/components/play-hub.tsx"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, require: (id: string) => {
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id.endsWith(".module.css")) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (id === "./backyard-icon") return { BackyardIcon: () => null };
    throw Error(`Unexpected dependency ${id}`);
  } });
  return children(exports.PlayHub!(props));
}

for (const [label, callback] of [["Configurar ronda completa", "onNewRound"], ["Ronda sin apuestas", "onScoreOnly"], ["Subir score total", "onTotalScore"]]) {
  test(`V3 play card dispatches exactly the existing action: ${label}`, () => {
    let calls = 0;
    const nodes = hub({ [callback]: () => { calls++; } });
    const buttons = nodes.filter(node => node.type === "button" && text(node.props?.children).includes(label));
    assert.equal(buttons.length, 1);
    buttons[0].props!.onClick!();
    assert.equal(calls, 1);
  });
}
test("V3 active round continues through the same callback without creating a new round", () => {
  let continued = 0, created = 0;
  const nodes = hub({ activeRound: { status: "live", totalHoles: 18, playerCount: 2, currentHole: 10, playedHoles: 9, courseName: "Synthetic QA" }, onContinueRound: () => { continued++; }, onNewRound: () => { created++; } });
  const button = nodes.find(node => node.type === "button" && text(node.props?.children) === "Volver al hoyo");
  assert.ok(button); button.props!.onClick!();
  assert.equal(continued, 1); assert.equal(created, 0);
});

function luminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
for (const [foreground, background] of [["103e2d", "ffffff"], ["55675c", "f6f6f0"], ["816830", "ffffff"], ["354f40", "f7f8f3"]]) {
  test(`V3 text palette satisfies WCAG AA contrast: ${foreground}/${background}`, () => {
    const a = luminance(foreground), b = luminance(background);
    assert.ok((Math.max(a,b) + .05) / (Math.min(a,b) + .05) >= 4.5);
  });
}
test("V3 uses shared tokens, safe text controls and reduced-motion without external fonts", () => {
  const css = source("app/design-system.css");
  for (const token of ["--by-forest", "--by-editorial", "--by-radius", "--by-space-4", "--by-touch"]) assert.ok(css.includes(token));
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /input:not\(\[type=checkbox\]\):not\(\[type=radio\]\)/);
  assert.match(css, /\.highContrast/);
  assert.doesNotMatch(css, /fonts\.googleapis|https:\/\//);
});
test("V3 product surfaces keep catalog media where required and the approved institutional visual for Mi Bola", () => {
  const profile = source("app/components/equipment-profile-panel.tsx");
  assert.match(profile, /BallFitBallVisual as ProfileBallVisual/);
  assert.equal((profile.match(/<ProfileBallVisual \/>/g) || []).length, 2);
  assert.doesNotMatch(profile, /CatalogProductMedia|currentBallCatalog/);
  assert.match(source("app/components/ball-fit-wizard.tsx"), /CatalogProductMedia item=\{catalogBall\}/);
  const media = source("app/components/catalog-product-media.tsx");
  assert.match(media, /!item\?\.imageUrl \|\| failed/);
  assert.match(media, /loading="lazy"/);
});
test("V3 QR keeps the share canvas and identifier without displaying a technical URL", () => {
  const qr = source("app/components/social-qr.tsx");
  assert.match(qr, /socialOriginForBrowser\(location\.origin,process\.env\.NEXT_PUBLIC_APP_ORIGIN\)/);
  assert.doesNotMatch(qr, /socialProfileLink\(userId,PUBLIC_SOCIAL_ORIGIN\)/);
  assert.doesNotMatch(qr, /socialProfileLink\(userId,location.origin\)/);
  assert.match(qr, /onClick=\{\(\) => void copyLink\(\)\}>Copiar enlace de perfil/);
  assert.doesNotMatch(qr, /<input[^>]*value=\{link\}/);
  assert.match(qr, /toBlob\(resolve,"image\/png"\)/);
  assert.match(qr, /navigator.canShare/);
});
test("V3 community feed scrolls without clipping content behind navigation", () => {
  assert.match(source("app/navigation-redesign.css"), /height:auto;min-height:100dvh;overflow:visible/);
  assert.match(source("app/navigation-redesign.css"), /112px \+ env\(safe-area-inset-bottom\)/);
  assert.match(source("app/components/home-dashboard-clean.module.css"), /overflow:visible/);
});
test("V3 keeps product status legible and rules disclosure actions accessible", () => {
  assert.match(source("app/components/equipment.module.css"), /\.itemHeader > \.currentBadge \{ flex-shrink: 0; white-space: nowrap;/);
  const rules = source("app/components/rules-panel.tsx");
  assert.match(rules, /aria-expanded=\{open\} aria-controls=\{id \+ "-body"\} onClick=\{onToggle\}/);
  assert.match(rules, /<BackyardIcon name=\{icon\}/);
  assert.match(rules, /title="Preguntar a la IA" icon="spark"/);
});
