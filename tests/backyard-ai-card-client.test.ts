import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BackyardAiRequestError, requestBackyardAi } from "../lib/backyard-ai/client-api";
import {
  runScorecardPhotoAnalysis,
  ScorecardClientPipelineError,
  scorecardLocalPersistenceWarning,
  scorecardScanErrorMessage,
} from "../lib/backyard-ai/scorecard/client-pipeline";
import {
  MAX_SCORECARD_TOTAL_DATA_URL_LENGTH,
  scorecardImageByteBudget,
} from "../lib/backyard-ai/scorecard/limits";
import {
  compressScorecardPhoto,
  decodeScorecardPhoto,
  resolveScorecardPhotoCommit,
  ScorecardPhotoError,
  type DecodedScorecardPhoto,
} from "../lib/scorecard-photo";

function fakeFile(name: string) {
  return { name, type: "image/jpeg" } as File;
}

function decoded(width = 1_200, height = 900, release = () => undefined): DecodedScorecardPhoto {
  return { source: {} as CanvasImageSource, width, height, release };
}

test("Card AI analiza en memoria aunque IndexedDB falle y sí ejecuta el POST lógico", async () => {
  const analyzed: Array<Array<{ id: string; dataUrl: string }>> = [];
  const result = await runScorecardPhotoAnalysis([{ id: "photo-1", file: fakeFile("card.jpg") }], "owner-1", {
    compress: async () => new Blob(["compressed"], { type: "image/jpeg" }),
    encode: async () => "data:image/jpeg;base64,Y2FyZA==",
    persist: async () => { throw new Error("IndexedDB unavailable"); },
    analyze: async (photos) => {
      analyzed.push(photos);
      return { extraction: { version: 1 } };
    },
  });

  assert.equal(analyzed.length, 1);
  assert.deepEqual(analyzed[0].map((photo) => photo.id), ["photo-1"]);
  assert.deepEqual((await result.persistence).failedPhotoIds, ["photo-1"]);
  assert.equal(scorecardLocalPersistenceWarning(1), "No pude guardar una copia local de esta foto, pero sí puedo analizarla.");
});

test("un reescaneo analizado sin foto nueva durable conserva la evidencia anterior", () => {
  assert.deepEqual(resolveScorecardPhotoCommit(["photo-a"], []), {
    durablePhotoIds: ["photo-a"],
    newlyDurablePhotoIds: [],
    removedPhotoIds: [],
    usesPreviousFallback: true,
  });
  assert.deepEqual(resolveScorecardPhotoCommit(["photo-a"], ["photo-b"]), {
    durablePhotoIds: ["photo-b"],
    newlyDurablePhotoIds: ["photo-b"],
    removedPhotoIds: ["photo-a"],
    usesPreviousFallback: false,
  });

  const page = readFileSync("app/page.tsx", "utf8");
  const applyStart = page.indexOf("function applyScannedScorecard(");
  const applyEnd = page.indexOf("function confirmNewRound()", applyStart);
  const applyFlow = page.slice(applyStart, applyEnd);
  assert.match(applyFlow, /resolveScorecardPhotoCommit\(scorecardPhotoIds, photoIds\)/);
  assert.match(applyFlow, /setScorecardPhotoIds\(photoCommit\.durablePhotoIds\)/);
  assert.match(applyFlow, /photoCommit\.removedPhotoIds\.forEach/);
  assert.doesNotMatch(applyFlow, /scorecardPhotoIds\.filter\(\(photoId\) => !photoIds\.includes\(photoId\)\)/);
});

test("el presupuesto de compresión se adapta de una a cuatro fotos", async () => {
  const observedBudgets: number[] = [];
  const analyze = async () => ({ ok: true });
  const run = (count: number) => runScorecardPhotoAnalysis(
    Array.from({ length: count }, (_, index) => ({ id: `photo-${index + 1}`, file: fakeFile(`card-${index + 1}.jpg`) })),
    "owner-1",
    {
      compress: async (_file, maxBytes) => {
        observedBudgets.push(maxBytes ?? -1);
        return new Blob(["x"], { type: "image/jpeg" });
      },
      encode: async () => "data:image/jpeg;base64,eA==",
      persist: async () => undefined,
      analyze,
    },
  );

  const single = await run(1);
  await single.persistence;
  assert.deepEqual(observedBudgets.splice(0), [scorecardImageByteBudget(1)]);

  const four = await run(4);
  await four.persistence;
  assert.deepEqual(observedBudgets, Array(4).fill(scorecardImageByteBudget(4)));
  assert.ok(scorecardImageByteBudget(1) > scorecardImageByteBudget(4));
});

test("el cliente rechaza el agregado aun cuando cada foto preparada cabe individualmente", async () => {
  let analyzed = false;
  const encodedLength = Math.floor(MAX_SCORECARD_TOTAL_DATA_URL_LENGTH / 2) + 1;
  await assert.rejects(
    runScorecardPhotoAnalysis([
      { id: "photo-1", file: fakeFile("one.jpg") },
      { id: "photo-2", file: fakeFile("two.jpg") },
    ], "owner-1", {
      compress: async () => new Blob(["x"], { type: "image/jpeg" }),
      encode: async () => "x".repeat(encodedLength),
      persist: async () => undefined,
      analyze: async () => {
        analyzed = true;
        return { ok: true };
      },
    }),
    (error: unknown) => error instanceof ScorecardClientPipelineError
      && error.code === "photo_too_large"
      && error.message === "Las fotos superan el tamaño permitido.",
  );
  assert.equal(analyzed, false);
});

test("preparación multi-foto usa allSettled y analiza todas las fotos utilizables", async () => {
  const analyzedIds: string[] = [];
  const result = await runScorecardPhotoAnalysis([
    { id: "damaged", file: fakeFile("damaged.jpg") },
    { id: "readable", file: fakeFile("readable.jpg") },
  ], "owner-1", {
    compress: async (file) => {
      if (file.name === "damaged.jpg") throw new ScorecardPhotoError("photo_open_failed", "No pude abrir la foto.");
      return new Blob(["compressed"], { type: "image/jpeg" });
    },
    encode: async () => "data:image/jpeg;base64,Y2FyZA==",
    persist: async () => undefined,
    analyze: async (photos) => {
      analyzedIds.push(...photos.map((photo) => photo.id));
      return { ok: true };
    },
  });

  assert.deepEqual(analyzedIds, ["readable"]);
  assert.deepEqual(result.preparedPhotoIds, ["readable"]);
  assert.deepEqual(result.preparationFailures.map((failure) => failure.photoId), ["damaged"]);
  assert.deepEqual((await result.persistence).persistedPhotoIds, ["readable"]);
});

test("Safari usa HTMLImageElement cuando createImageBitmap no existe o falla", async () => {
  let fallbackCalls = 0;
  const withoutBitmap = await decodeScorecardPhoto(new Blob(), {
    imageElement: async () => {
      fallbackCalls += 1;
      return decoded();
    },
  });
  assert.equal(withoutBitmap.width, 1_200);

  const withRejectedBitmap = await decodeScorecardPhoto(new Blob(), {
    bitmap: async () => { throw new Error("Safari bitmap failure"); },
    imageElement: async () => {
      fallbackCalls += 1;
      return decoded(900, 1_200);
    },
  });
  assert.equal(withRejectedBitmap.height, 1_200);
  assert.equal(fallbackCalls, 2);
});

test("un canvas sin contexto produce error de compresión tipado y libera la imagen", async () => {
  let released = false;
  await assert.rejects(
    compressScorecardPhoto(fakeFile("card.jpg"), {
      decoders: {
        imageElement: async () => decoded(1_200, 900, () => { released = true; }),
      },
      createCanvas: () => ({ width: 0, height: 0, getContext: () => null }) as unknown as HTMLCanvasElement,
    }),
    (error: unknown) => error instanceof ScorecardPhotoError && error.code === "photo_compression_failed" && error.message === "No pude comprimir la foto.",
  );
  assert.equal(released, true);
});

test("errores de configuración, timeout, proveedor y validación tienen mensajes específicos", () => {
  assert.equal(scorecardScanErrorMessage(new BackyardAiRequestError(503, "raw", "missing_config")), "Backyard AI no está configurado.");
  assert.equal(scorecardScanErrorMessage(new BackyardAiRequestError(504, "raw", "timeout")), "El análisis tardó demasiado.");
  assert.equal(scorecardScanErrorMessage(new BackyardAiRequestError(502, "raw", "provider_error")), "El proveedor no pudo leer la imagen.");
  assert.equal(scorecardScanErrorMessage(new BackyardAiRequestError(502, "raw", "invalid_extraction")), "La respuesta no pasó validación.");
});

test("requestBackyardAi implementa timeout sin depender de AbortSignal.timeout", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  })) as typeof fetch;
  try {
    await assert.rejects(
      requestBackyardAi("/api/backyard-ai/scorecard", {}, 5),
      (error: unknown) => error instanceof BackyardAiRequestError && error.code === "timeout",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("scanner no depende de IndexedDB y mantiene el CTA visible sobre la navegación móvil", () => {
  const scanner = readFileSync("app/components/backyard-ai/scorecard-scanner.tsx", "utf8");
  const correction = readFileSync("app/components/backyard-ai/scorecard-correction.tsx", "utf8");
  assert.match(scanner, /runScorecardPhotoAnalysis\(photosForScan, storageOwnerId/);
  assert.doesNotMatch(scanner, /readScorecardPhoto/);
  assert.doesNotMatch(scanner, /await saveScorecardPhoto/);
  assert.match(scanner, /AI_IMAGE_PROCESSING_CONSENT/);
  assert.match(scanner, /CAPTURAR MANUALMENTE/);
  assert.match(scanner, /scanButtonRef\.current\?\.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(scanner, /ref=\{scanButtonRef\}/);
  assert.match(correction, /recognizedScoreCount[\s\S]*expectedScoreCount[\s\S]*scores reconocidos/);
});

test("telemetría server registra sólo proveedor, modelo, estado, latencia y código técnico", () => {
  const route = readFileSync("app/api/backyard-ai/scorecard/route.ts", "utf8");
  assert.match(route, /Promise\.allSettled/);
  assert.match(route, /partial:\s*\{ failedPhotoCount:/);
  const start = route.indexOf("function logScorecardProvider");
  const end = route.indexOf("function scorecardInstructions");
  const logger = route.slice(start, end);
  assert.match(logger, /provider:\s*"openai"/);
  assert.match(logger, /model:/);
  assert.match(logger, /status:/);
  assert.match(logger, /latencyMs:/);
  assert.match(logger, /errorCode:/);
  assert.doesNotMatch(logger, /dataUrl|image_url|roundHint|playerNames|photoId/);
});
