import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as avatars from "../lib/profile-avatar";
import * as manualAvatar from "../lib/manual-avatar";
import { normalizeProfileImageCrop, profileImageCropAfterPan, profileImagePreviewGeometry } from "../lib/profile-image";

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
  const crops: Array<Record<string, number>> = [];
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
      profileImageFromFile: async (_file: File, _size: number, crop: Record<string, number>) => { crops.push(crop); return "data:image/webp;base64,optimized"; },
      profileImageErrorMessage: () => "No pudimos preparar la imagen.",
      normalizeProfileImageCrop,
      profileImageCropAfterPan,
      profileImagePreviewGeometry,
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
    crops,
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
  h.click("SIN FOTO");
  assert.equal(h.value(), "");
});

test("profile avatar supports optimized upload, emoji and created-avatar choices", async () => {
  const upload = imagePicker("https://images.example/google.jpg");
  upload.click("Sube tu foto");
  const file = upload.nodes().find((node) => node.type === "input" && node.props["aria-label"] === "Elegir foto de la galería");
  assert.ok(file);
  (file.props.onChange as (event: unknown) => void)({ target: { files: [{}] } });
  upload.render();
  assert.match(upload.text(), /USAR ESTA FOTO/);
  const cropStage = upload.nodes().find((node) => node.props["aria-label"] === "Editor de recorte. Arrastra para mover y pellizca para ampliar.");
  assert.ok(cropStage);
  const cropImage = upload.nodes().find((node) => node.type === "img" && node.props.alt === "Foto que estás ajustando");
  assert.ok(cropImage);
  (cropImage.props.onLoad as (event: unknown) => void)({ currentTarget: { naturalWidth: 1200, naturalHeight: 800 } });
  upload.render();
  const liveCropStage = upload.nodes().find((node) => node.props["aria-label"] === "Editor de recorte. Arrastra para mover y pellizca para ampliar.")!;
  const surface = { setPointerCapture: () => undefined, getBoundingClientRect: () => ({ width: 320, height: 260 }) };
  const pointer = (pointerId: number, clientX: number, clientY: number) => ({ pointerId, clientX, clientY, currentTarget: surface, preventDefault: () => undefined });
  (liveCropStage.props.onPointerDown as (event: unknown) => void)(pointer(1, 120, 120));
  (liveCropStage.props.onPointerMove as (event: unknown) => void)(pointer(1, 150, 100));
  (liveCropStage.props.onPointerDown as (event: unknown) => void)(pointer(2, 190, 120));
  (liveCropStage.props.onPointerMove as (event: unknown) => void)(pointer(2, 240, 120));
  upload.render();
  const zoom = upload.nodes().find((node) => node.type === "button" && node.props["aria-label"] === "Acercar foto");
  const rotate = upload.nodes().find((node) => node.type === "button" && text(node).includes("ROTAR"));
  assert.ok(zoom && rotate);
  (zoom.props.onClick as () => void)();
  (rotate.props.onClick as () => void)();
  upload.render();
  upload.click("USAR ESTA FOTO");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  upload.render();
  assert.equal(upload.value(), "data:image/webp;base64,optimized");
  assert.deepEqual(upload.busy, [false, true, false]);
  assert.equal(upload.crops[0].rotation, 90);
  assert.ok(upload.crops[0].zoom > 1);
  assert.notEqual(upload.crops[0].positionX, 0);

  const emoji = imagePicker("");
  emoji.click("EMOJI");
  emoji.click("🔥");
  assert.match(emoji.text(), /🔥/);
  emoji.click("USAR EMOJI");
  assert.equal(emoji.value(), "🔥");
  assert.match(emoji.text(), /Emoji listo/);
  const emojiVisual = emoji.nodes().find((node) => typeof node.type === "function" && (node.type as { name?: string }).name === "ModeVisual" && node.props.mode === "emoji");
  assert.equal(emojiVisual?.props.value, "🔥");
  const emojiReady = emoji.nodes().find((node) => node.type === "button" && text(node).includes("EMOJI LISTO"));
  assert.equal(emojiReady?.props.disabled, true);

  const created = imagePicker("");
  created.click("AVATAR");
  const panel = created.nodes().find((node) => node.type === "avatar-create");
  assert.ok(panel);
  const avatar = manualAvatar.manualAvatarUrl(manualAvatar.DEFAULT_MANUAL_AVATAR);
  await (panel.props.onUse as (url: string) => Promise<void>)(avatar);
  created.render();
  assert.equal(created.value(), avatar);
  assert.match(created.text(), /Avatar listo/);
});

test("la pantalla muestra cuatro modos pares y declara honestamente generación desde foto no disponible", () => {
  const source = readFileSync("app/components/profile-image-picker.tsx", "utf8");
  const picker = imagePicker("");
  assert.match(picker.text(), /FOTO \/ AVATAR/);
  assert.match(picker.text(), /SIN FOTO/);
  assert.match(picker.text(), /EMOJI/);
  assert.match(picker.text(), /AVATAR/);
  assert.match(picker.text(), /FOTO/);
  assert.match(source, /PHOTO_AVATAR_GENERATION_CAPABILITY\.available/);
  assert.match(source, /CREAR CARICATURA DESDE MI FOTO/);
  assert.match(source, /requiere un proveedor real/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /pellizca para ampliar/);
  assert.match(source, /rotation/);
  assert.doesNotMatch(source, /Ajuste fino|Horizontal<input|Vertical<input/);
});

test("cambiar entre los cuatro modos no revive la selección anterior", () => {
  const h = imagePicker("https://images.example/photo.jpg");
  h.click("EMOJI");
  h.click("⛳");
  h.click("USAR EMOJI");
  assert.equal(h.value(), "⛳");
  h.click("AVATAR");
  const panel = h.nodes().find((node) => node.type === "avatar-create");
  assert.ok(panel);
  const avatar = manualAvatar.manualAvatarUrl({ ...manualAvatar.DEFAULT_MANUAL_AVATAR, pelo: "rizado" });
  (panel.props.onUse as (url: string) => void)(avatar);
  h.render();
  assert.equal(h.value(), avatar);
  h.click("SIN FOTO");
  assert.equal(h.value(), "");
  h.click("FOTO");
  assert.doesNotMatch(h.text(), /Foto actual/);
});
