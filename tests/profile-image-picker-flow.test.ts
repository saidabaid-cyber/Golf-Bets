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

function imagePicker(initialValue: string, options: { generationError?: boolean; capabilityAvailable?: boolean } = {}) {
  const slots: unknown[] = [];
  let cursor = 0;
  let value = initialValue;
  const changes: string[] = [];
  const busy: boolean[] = [];
  const crops: Array<Record<string, number>> = [];
  const generationRequests: Array<{ sourceImageDataUrl: string; variant: number; accessToken: string }> = [];
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
  runInNewContext(compiled, { exports, AbortController, DOMException, URL: { createObjectURL: () => "blob:avatar", revokeObjectURL: () => undefined }, require: (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name.endsWith("/profile-avatar")) return avatars;
    if (name.endsWith("/manual-avatar")) return manualAvatar;
    if (name.endsWith("/profile-image")) return {
      profileImageFromFile: async (_file: File, _size: number, crop: Record<string, number>) => { crops.push(crop); return "data:image/webp;base64,optimized"; },
      profileImageFromDataUrl: async () => `data:image/webp;base64,generated${generationRequests.at(-1)?.variant || 1}`,
      profileImageErrorMessage: () => "No pudimos preparar la imagen.",
      normalizeProfileImageCrop,
      profileImageCropAfterPan,
      profileImagePreviewGeometry,
    };
    if (name.endsWith("/consent-client")) return { resolveAuthoritativeAiProcessingConsent: async () => ({ active: true, discarded: false, pendingLocalRevocation: false }) };
    if (name.endsWith("/processing-consent")) return { browserAiProcessingConsentStorage: () => ({}) };
    if (name.endsWith("/privacy")) return { AI_IMAGE_PROCESSING_CONSENT: "AI_IMAGE_PROCESSING_CONSENT" };
    if (name.endsWith("/photo-avatar-generation")) return {
      MAX_PHOTO_AVATAR_VARIANTS: 3,
      PhotoAvatarGenerationError: class PhotoAvatarGenerationError extends Error {
        code: string; status: number;
        constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
      },
      readPhotoAvatarGenerationCapability: async () => ({ available: options.capabilityAvailable !== false, provider: "openai", model: "gpt-image-test" }),
      requestPhotoAvatarGeneration: async (input: { sourceImageDataUrl: string; variant: number; accessToken: string }) => {
        generationRequests.push(input);
        if (options.generationError) throw new Error("provider failed");
        return { avatarDataUrl: `data:image/webp;base64,provider${input.variant}`, provider: "openai", model: "gpt-image-test", variant: input.variant };
      },
    };
    if (name === "./avatar-creation-panel") return { AvatarCreationPanel: "avatar-create" };
    if (name.endsWith("/backyard-ai/ai-processing-consent")) return { AiProcessingConsentPrompt: "consent-prompt" };
    if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => key }) };
    throw new Error(name);
  } });
  let tree: Node;
  const render = () => {
    cursor = 0;
    tree = exports.ProfileImagePicker({ value, onChange: (next: string) => { value = next; changes.push(next); }, onBusyChange: (next: boolean) => busy.push(next), accessToken: "qa-token", userId: "qa-user" });
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
    generationRequests,
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
  assert.equal(created.nodes().some((node) => node.type === "avatar-create"), false, "usar el avatar cierra el editor compartido");
  assert.equal(created.nodes().find((node) => node.type === "button" && text(node).includes("AVATAR"))?.props["aria-pressed"], true);
  assert.equal(created.nodes().find((node) => node.type === "img" && node.props.alt === "Vista previa del avatar creado")?.props.src, avatar);
  created.click("EDITAR AVATAR");
  assert.ok(created.nodes().some((node) => node.type === "avatar-create"));
});

test("onboarding y Editar perfil comparten el mismo cierre y preview del avatar manual", () => {
  const onboarding = readFileSync("app/components/account-provider.tsx", "utf8");
  const profile = readFileSync("app/components/profile-account-panel.tsx", "utf8");
  const picker = readFileSync("app/components/profile-image-picker.tsx", "utf8");
  assert.match(onboarding, /<ProfileImagePicker value=\{avatarUrl\}/);
  assert.match(profile, /<ProfileImagePicker value=\{avatarUrl\}/);
  assert.match(picker, /setAvatarEditorOpen\(false\); setMessage\(""\); setStatus\("Avatar listo/);
  assert.match(picker, /aria-label="Avatar manual listo"/);
});

test("la pantalla muestra cuatro modos pares y conecta la caricatura con el endpoint real", () => {
  const source = readFileSync("app/components/profile-image-picker.tsx", "utf8");
  const picker = imagePicker("");
  assert.match(picker.text(), /FOTO \/ AVATAR/);
  assert.match(picker.text(), /SIN FOTO/);
  assert.match(picker.text(), /EMOJI/);
  assert.match(picker.text(), /AVATAR/);
  assert.match(picker.text(), /FOTO/);
  assert.match(source, /requestPhotoAvatarGeneration/);
  assert.match(source, /readPhotoAvatarGenerationCapability/);
  assert.match(source, /resolveAuthoritativeAiProcessingConsent/);
  assert.match(source, /CREAR CARICATURA DESDE MI FOTO/);
  assert.match(source, /USAR AVATAR/);
  assert.match(source, /GENERAR OTRA/);
  assert.match(source, /VOLVER A FOTO/);
  assert.doesNotMatch(source, /disabled=\{!PHOTO_AVATAR_GENERATION_CAPABILITY\.available/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /pellizca para ampliar/);
  assert.match(source, /rotation/);
  assert.doesNotMatch(source, /Ajuste fino|Horizontal<input|Vertical<input/);
});

test("foto recortada genera, compara, selecciona y solicita una variante distinta sin perder el original", async () => {
  const h = imagePicker("");
  h.click("Sube tu foto");
  assert.doesNotMatch(h.text(), /CREAR CARICATURA DESDE MI FOTO/, "sin una foto no se ofrece el envío al proveedor");
  const file = h.nodes().find((node) => node.type === "input" && node.props["aria-label"] === "Elegir foto de la galería");
  assert.ok(file);
  (file.props.onChange as (event: unknown) => void)({ target: { files: [{}] } });
  h.render();
  h.click("CREAR CARICATURA DESDE MI FOTO");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  h.render();
  assert.match(h.text(), /FOTO ORIGINAL/);
  assert.match(h.text(), /AVATAR CREADO/);
  assert.deepEqual(h.generationRequests.map((request) => request.variant), [1]);
  assert.equal(h.generationRequests[0]?.accessToken, "qa-token");
  assert.equal(h.generationRequests[0]?.sourceImageDataUrl, "data:image/webp;base64,optimized");
  assert.equal(h.value(), "");
  h.click("USAR AVATAR");
  assert.equal(h.value(), "data:image/webp;base64,generated1");
  h.click("GENERAR OTRA");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  h.render();
  assert.deepEqual(h.generationRequests.map((request) => request.variant), [1, 2]);
  assert.equal(h.generationRequests[1]?.sourceImageDataUrl, "data:image/webp;base64,optimized");
  assert.match(h.text(), /FOTO ORIGINAL/);
  h.click("VOLVER A FOTO");
  assert.match(h.text(), /USAR ESTA FOTO/);
  h.click("CREAR CARICATURA DESDE MI FOTO");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  h.render();
  assert.deepEqual(h.generationRequests.map((request) => request.variant), [1, 2, 1], "volver al crop inicia una serie nueva desde el encuadre vigente");
});

test("configuración externa ausente y error del proveedor conservan la foto y permiten reintentar", async () => {
  for (const options of [{ capabilityAvailable: false }, { generationError: true }]) {
    const h = imagePicker("", options);
    h.click("Sube tu foto");
    const file = h.nodes().find((node) => node.type === "input" && node.props["aria-label"] === "Elegir foto de la galería");
    assert.ok(file);
    (file.props.onChange as (event: unknown) => void)({ target: { files: [{}] } });
    h.render();
    const action = h.nodes().find((node) => node.type === "button" && text(node).includes("CREAR CARICATURA"));
    assert.equal(action?.props.disabled, false, "el CTA no queda como placeholder gris");
    h.click("CREAR CARICATURA DESDE MI FOTO");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    h.render();
    assert.ok(h.nodes().some((node) => node.props["aria-label"] === "Editor de recorte. Arrastra para mover y pellizca para ampliar."));
    assert.match(h.text(), options.capabilityAvailable === false ? /no está configurada en DEV/ : /No pudimos crear el avatar/);
    assert.equal(h.generationRequests.length, options.capabilityAvailable === false ? 0 : 1);
  }
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
