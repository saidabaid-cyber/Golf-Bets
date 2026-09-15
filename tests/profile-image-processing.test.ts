import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { validateProfileAvatarUrl } from "../lib/account-state";
import {
  PROFILE_IMAGE_MAX_BYTES,
  PROFILE_IMAGE_MAX_DATA_URL_LENGTH,
  compressedProfileImageDataUrl,
  profileImageErrorMessage,
  profileImageFormatForFile,
  profileImageFormatFromBytes,
  profileImageFromFile,
} from "../lib/profile-image";

function bytes(value: number[]) { return new Uint8Array(value); }
function heicHeader(majorBrand = "heic", compatibleBrand = "mif1") {
  const header = new Uint8Array(24);
  header.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);
  header.set(Buffer.from(majorBrand, "ascii"), 8);
  header.set(Buffer.from(compatibleBrand, "ascii"), 16);
  return header;
}

function restoreProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

async function withCanvasBrowser<T>(bitmap: (file: File, options: ImageBitmapOptions) => Promise<unknown>, run: () => Promise<T>) {
  const bitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const createUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const created: string[] = [];
  const revoked: string[] = [];
  const realCreateUrl = URL.createObjectURL.bind(URL);
  const realRevokeUrl = URL.revokeObjectURL.bind(URL);
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, value: bitmap });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: (tag: string) => {
    assert.equal(tag, "canvas");
    return createCanvas(1, 1);
  } } });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (file: File) => {
    const url = realCreateUrl(file);
    created.push(url);
    return url;
  } });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: (url: string) => {
    revoked.push(url);
    realRevokeUrl(url);
  } });
  try { return { result: await run(), created, revoked }; }
  finally {
    restoreProperty(globalThis, "createImageBitmap", bitmapDescriptor);
    restoreProperty(globalThis, "document", documentDescriptor);
    restoreProperty(URL, "createObjectURL", createUrlDescriptor);
    restoreProperty(URL, "revokeObjectURL", revokeUrlDescriptor);
  }
}

function coloredSource(width: number, height: number, landscape: boolean) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#00c000";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#ff0000";
  if (landscape) {
    ctx.fillRect(0, 0, width / 6, height);
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(width * 5 / 6, 0, width / 6, height);
  } else {
    ctx.fillRect(0, 0, width, height / 6);
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(0, height * 5 / 6, width, height / 6);
  }
  return new File([canvas.toBuffer("image/png")], landscape ? "landscape.png" : "portrait.png", { type: "image/png" });
}

function jpegWithExifOrientation6(jpeg: Buffer) {
  // APP1 Exif, little-endian TIFF, orientation tag 0x0112 = 6 (90° CW).
  const app1 = Buffer.from([0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0,
    0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0,
    6, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

test("MIME y bytes rechazan no-imágenes y formatos suplantados", () => {
  assert.equal(profileImageFormatFromBytes(bytes([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
  assert.equal(profileImageFormatFromBytes(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "png");
  assert.equal(profileImageFormatFromBytes(Buffer.from("RIFF1234WEBP", "ascii")), "webp");
  assert.equal(profileImageFormatFromBytes(heicHeader()), "heic");
  assert.equal(profileImageFormatFromBytes(heicHeader("mif1", "heic")), "heic");
  assert.equal(profileImageFormatForFile("image/heif", heicHeader("mif1", "mif1")), "heif", "HEIF estructural requiere decoder nativo después");
  assert.throws(() => profileImageFormatForFile("image/heic", heicHeader("mif1", "mif1")), /image_type/);
  assert.equal(profileImageFormatFromBytes(heicHeader("avif", "mif1")), null);
  assert.equal(profileImageFormatFromBytes(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\">", "ascii")), null);
  assert.throws(() => profileImageFormatForFile("image/png", bytes([0xff, 0xd8, 0xff])), /image_type/);
  assert.throws(() => profileImageFormatForFile("image/svg+xml", Buffer.from("<svg>", "ascii")), /image_content/);
  assert.equal(profileImageFormatForFile("", bytes([0xff, 0xd8, 0xff])), "jpeg", "MIME vacío exige firma reconocida");
});

test("fuente mayor a 20 MB falla antes de crear URL con mensaje exacto", async () => {
  const file = new File([new Uint8Array(PROFILE_IMAGE_MAX_BYTES + 1)], "large.jpg", { type: "image/jpeg" });
  await assert.rejects(profileImageFromFile(file), (error: unknown) => profileImageErrorMessage(error) === "Esta imagen es demasiado grande. Elige una imagen menor a 20 MB.");
});

test("crop horizontal real produce avatar 512×512 sin bandas laterales y persistible", async () => {
  const file = coloredSource(600, 400, true);
  let orientation: string | undefined;
  const { result: encoded, created, revoked } = await withCanvasBrowser(async (source, options) => {
    orientation = options.imageOrientation;
    return loadImage(Buffer.from(await source.arrayBuffer()));
  }, () => profileImageFromFile(file));
  assert.equal(orientation, "from-image");
  assert.deepEqual(revoked, created);
  assert.equal(created.length, 1);
  assert.ok(encoded.length <= PROFILE_IMAGE_MAX_DATA_URL_LENGTH);
  assert.equal(validateProfileAvatarUrl(encoded).ok, true);
  const decoded = await loadImage(Buffer.from(encoded.split(",")[1], "base64"));
  assert.equal(decoded.width, 512);
  assert.equal(decoded.height, 512);
  const resultCanvas = createCanvas(512, 512);
  const ctx = resultCanvas.getContext("2d");
  ctx.drawImage(decoded, 0, 0);
  for (const x of [8, 256, 503]) {
    const pixel = ctx.getImageData(x, 256, 1, 1).data;
    assert.ok(pixel[1] > pixel[0] * 2 && pixel[1] > pixel[2] * 2, `x=${x} permanece verde tras crop`);
  }
});

test("crop vertical real respeta 320 de Grupo sin deformación", async () => {
  const file = coloredSource(400, 600, false);
  const { result: encoded } = await withCanvasBrowser(async source => loadImage(Buffer.from(await source.arrayBuffer())), () => profileImageFromFile(file, 320));
  const decoded = await loadImage(Buffer.from(encoded.split(",")[1], "base64"));
  assert.equal(decoded.width, 320);
  assert.equal(decoded.height, 320);
  const resultCanvas = createCanvas(320, 320);
  const ctx = resultCanvas.getContext("2d");
  ctx.drawImage(decoded, 0, 0);
  for (const y of [8, 160, 311]) {
    const pixel = ctx.getImageData(160, y, 1, 1).data;
    assert.ok(pixel[1] > pixel[0] * 2 && pixel[1] > pixel[2] * 2, `y=${y} permanece verde tras crop`);
  }
});

test("tamaño solicitado se limita a 64..512 sin cambiar aspecto", async () => {
  const file = coloredSource(128, 128, true);
  for (const [requested, expected] of [[20, 64], [1024, 512]] as const) {
    const { result: encoded } = await withCanvasBrowser(async input => loadImage(Buffer.from(await input.arrayBuffer())), () => profileImageFromFile(file, requested));
    const decoded = await loadImage(Buffer.from(encoded.split(",")[1], "base64"));
    assert.deepEqual([decoded.width, decoded.height], [expected, expected]);
  }
});

test("EXIF orientación 6 nativa se aplica una vez antes del crop", async () => {
  const source = createCanvas(160, 80);
  const sourceCtx = source.getContext("2d");
  sourceCtx.fillStyle = "#ff0000";
  sourceCtx.fillRect(0, 0, 80, 80);
  sourceCtx.fillStyle = "#0000ff";
  sourceCtx.fillRect(80, 0, 80, 80);
  const file = new File([jpegWithExifOrientation6(source.toBuffer("image/jpeg"))], "oriented.jpg", { type: "image/jpeg" });
  const native = await loadImage(Buffer.from(await file.arrayBuffer()));
  assert.deepEqual([native.width, native.height], [80, 160], "decoder respeta EXIF 6");
  let requestedOrientation: string | undefined;
  const { result: encoded } = await withCanvasBrowser(async (input, options) => {
    requestedOrientation = options.imageOrientation;
    return loadImage(Buffer.from(await input.arrayBuffer()));
  }, () => profileImageFromFile(file));
  assert.equal(requestedOrientation, "from-image");
  const decoded = await loadImage(Buffer.from(encoded.split(",")[1], "base64"));
  const output = createCanvas(512, 512);
  const ctx = output.getContext("2d");
  ctx.drawImage(decoded, 0, 0);
  const top = ctx.getImageData(256, 40, 1, 1).data;
  const bottom = ctx.getImageData(256, 472, 1, 1).data;
  assert.ok(top[0] > top[2] * 2, "parte superior queda roja tras orientación");
  assert.ok(bottom[2] > bottom[0] * 2, "parte inferior queda azul tras orientación");
});

test("HEIC requiere decodificación nativa segura y libera URL en error", async () => {
  const file = new File([heicHeader()], "phone.heic", { type: "image/heic" });
  const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
  Object.defineProperty(globalThis, "Image", { configurable: true, value: undefined });
  try {
    const { created, revoked } = await withCanvasBrowser(async () => { throw new Error("unsupported_codec"); }, async () => {
      await assert.rejects(profileImageFromFile(file), (error: unknown) => profileImageErrorMessage(error) === "Este navegador no puede abrir esta foto HEIC/HEIF. Elige JPEG, PNG o WebP.");
    });
    assert.deepEqual(revoked, created);
    assert.equal(created.length, 1);
  } finally { restoreProperty(globalThis, "Image", imageDescriptor); }
});

test("fallback HTMLImageElement registra handlers antes de src y procesa PNG", async () => {
  const file = coloredSource(200, 100, true);
  const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
  let hadHandlerBeforeSrc = false;
  class ImmediateImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decoding = "";
    naturalWidth = 200;
    naturalHeight = 100;
    set src(_value: string) {
      hadHandlerBeforeSrc = typeof this.onload === "function" && typeof this.onerror === "function";
      this.onload?.();
    }
  }
  Object.defineProperty(globalThis, "Image", { configurable: true, value: ImmediateImage });
  try {
    const { created, revoked } = await withCanvasBrowser(async () => { throw new Error("bitmap_option_not_supported"); }, async () => {
      const blank = createCanvas(512, 512);
      const encoded = blank.toDataURL("image/jpeg", .5);
      const originalCreateElement = (globalThis.document as Document).createElement;
      Object.defineProperty(globalThis.document, "createElement", { configurable: true, value: () => ({ width: 0, height: 0, getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: () => {} }), toDataURL: (type: string) => type === "image/webp" ? "data:image/png;base64,AAAA" : encoded }) });
      try { assert.ok((await profileImageFromFile(file)).startsWith("data:image/jpeg;base64,")); }
      finally { Object.defineProperty(globalThis.document, "createElement", { configurable: true, value: originalCreateElement }); }
    });
    assert.equal(hadHandlerBeforeSrc, true);
    assert.deepEqual(revoked, created);
  } finally { restoreProperty(globalThis, "Image", imageDescriptor); }
});

test("HEIC decodificable por navegador produce WebP/JPEG y cierra bitmap", async () => {
  const file = new File([heicHeader()], "phone.heif", { type: "image/heif" });
  const source = createCanvas(512, 512);
  const ctx = source.getContext("2d");
  ctx.fillStyle = "#118a43";
  ctx.fillRect(0, 0, 512, 512);
  let closeCalls = 0;
  const { result: encoded, created, revoked } = await withCanvasBrowser(async () => Object.assign(source, { close: () => { closeCalls += 1; } }), () => profileImageFromFile(file));
  assert.ok(/^data:image\/(?:webp|jpeg);base64,/.test(encoded));
  assert.equal(validateProfileAvatarUrl(encoded).ok, true);
  assert.equal(closeCalls, 1);
  assert.deepEqual(revoked, created);
});

test("fallo de compresión después de decode cierra bitmap y revoca URL", async () => {
  const file = coloredSource(400, 400, true);
  const source = createCanvas(400, 400);
  let closeCalls = 0;
  const { created, revoked } = await withCanvasBrowser(async () => Object.assign(source, { close: () => { closeCalls += 1; } }), async () => {
    const originalCreateElement = (globalThis.document as Document).createElement;
    Object.defineProperty(globalThis.document, "createElement", { configurable: true, value: () => ({ width: 0, height: 0, getContext: () => ({ fillStyle: "", fillRect: () => {}, drawImage: () => {} }), toDataURL: () => "data:image/png;base64,AAAA" }) });
    try { await assert.rejects(profileImageFromFile(file), /image_encoded_size/); }
    finally { Object.defineProperty(globalThis.document, "createElement", { configurable: true, value: originalCreateElement }); }
  });
  assert.equal(closeCalls, 1);
  assert.deepEqual(revoked, created);
});

test("encoder usa JPEG cuando WebP cae a PNG y reduce calidad hasta presupuesto", () => {
  const calls: Array<{ type: string; quality: number | undefined }> = [];
  const output = compressedProfileImageDataUrl({ toDataURL: (type?: string, quality?: number) => {
    calls.push({ type: type || "", quality });
    if (type === "image/webp") return "data:image/png;base64,AAAA";
    return `data:image/jpeg;base64,${"A".repeat(quality && quality > .6 ? PROFILE_IMAGE_MAX_DATA_URL_LENGTH : 100)}`;
  } });
  assert.ok(output.startsWith("data:image/jpeg;base64,"));
  assert.ok(output.length <= PROFILE_IMAGE_MAX_DATA_URL_LENGTH);
  assert.equal(calls[0].type, "image/webp");
  assert.ok(calls.some(call => call.type === "image/jpeg" && (call.quality || 1) <= .6));
  assert.throws(() => compressedProfileImageDataUrl({ toDataURL: (type = "image/png") => `data:${type};base64,${"A".repeat(PROFILE_IMAGE_MAX_DATA_URL_LENGTH)}` }), /image_encoded_size/);
});
