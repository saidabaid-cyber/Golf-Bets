import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as avatars from "../lib/profile-avatar";
import * as manualAvatar from "../lib/manual-avatar";

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (value && typeof value === "object") return text((value as Node).props.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function imagePicker(initialValue: string) {
  const slots: unknown[] = [];
  let cursor = 0;
  let value = initialValue;
  const changes: string[] = [];
  const busy: boolean[] = [];
  const exports: Record<string, (props: unknown) => Node> = {};
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const react = {
    useId: () => "avatar-test",
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useEffect: () => undefined,
  };
  const compiled = ts.transpileModule(readFileSync("app/components/profile-image-picker.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(compiled, { exports, URL: { createObjectURL: () => "blob:avatar", revokeObjectURL: () => undefined }, require: (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name.endsWith("/profile-avatar")) return avatars;
    if (name.endsWith("/manual-avatar")) return manualAvatar;
    if (name.endsWith("/profile-image")) return {
      profileImageFromFile: async () => "data:image/webp;base64,optimized",
      profileImageErrorMessage: () => "No pudimos preparar la imagen.",
    };
    if (name.endsWith("/photo-avatar-generation")) return { PHOTO_AVATAR_GENERATION_CAPABILITY: { available: false, reason: "provider_not_configured" } };
    if (name === "./avatar-creation-panel") return { AvatarCreationPanel: "avatar-create" };
    if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => key }) };
    throw new Error(name);
  } });
  let tree: Node;
  const render = () => {
    cursor = 0;
    tree = exports.ProfileImagePicker({ value, onChange: (next: string) => { value = next; changes.push(next); }, onBusyChange: (next: boolean) => busy.push(next) });
    return tree;
  };
  render();
  return {
    render,
    nodes: () => nodes(tree),
    text: () => text(tree),
    value: () => value,
    changes,
    busy,
    click(label: string) {
      const button = nodes(tree).find((node) => node.type === "button" && (text(node).trim() === label || text(node).includes(label)));
      assert.ok(button, label);
      (button.props.onClick as () => void)();
      render();
    },
  };
}

test("Google photo is preserved until the person chooses a different avatar mode", () => {
  const photo = "https://images.example/google.jpg";
  const h = imagePicker(photo);
  assert.equal(h.nodes().find((node) => node.type === "img")?.props.src, photo);
  assert.deepEqual(h.changes, []);
  h.click("Sin imagen");
  assert.equal(h.value(), "");
});

test("profile avatar supports optimized upload, emoji and created-avatar choices", async () => {
  const upload = imagePicker("https://images.example/google.jpg");
  upload.click("SUBIR UNA IMAGEN");
  const file = upload.nodes().find((node) => node.type === "input" && node.props["aria-label"] === "Elegir foto de la galería");
  assert.ok(file);
  (file.props.onChange as (event: unknown) => void)({ target: { files: [{}] } });
  upload.render();
  assert.match(upload.text(), /USAR ESTA FOTO/);
  upload.click("USAR ESTA FOTO");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  upload.render();
  assert.equal(upload.value(), "data:image/webp;base64,optimized");
  assert.deepEqual(upload.busy, [false, true, false]);

  const emoji = imagePicker("");
  emoji.click("Emoji");
  emoji.click("🔥");
  emoji.click("USAR EMOJI");
  assert.equal(emoji.value(), "🔥");

  const created = imagePicker("");
  created.click("CREAR MI AVATAR");
  const panel = created.nodes().find((node) => node.type === "avatar-create");
  assert.ok(panel);
  await (panel.props.onUse as (url: string) => Promise<void>)("avatar:v1:test");
  created.render();
  assert.equal(created.value(), "avatar:v1:test");
  assert.match(created.text(), /Avatar listo/);
});

test("la pantalla prioriza crear/subir y declara honestamente generación desde foto no disponible", () => {
  const source = readFileSync("app/components/profile-image-picker.tsx", "utf8");
  const picker = imagePicker("");
  assert.match(picker.text(), /ELIGE TU AVATAR/);
  assert.match(picker.text(), /CREAR MI AVATAR/);
  assert.match(picker.text(), /SUBIR UNA IMAGEN/);
  assert.match(source, /PHOTO_AVATAR_GENERATION_CAPABILITY\.available/);
  assert.match(source, /CREAR AVATAR DESDE MI FOTO/);
  assert.match(source, /requiere un proveedor de generación real/);
});
