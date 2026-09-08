export class BackyardAiRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "BackyardAiRequestError";
    this.status = status;
    this.code = code;
  }
}

export async function requestBackyardAi<T>(path: string, payload: unknown, timeoutMs = 30_000) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
  if (!response.ok) {
    throw new BackyardAiRequestError(
      response.status,
      typeof body?.error === "string" ? body.error : "Backyard AI no pudo completar la solicitud.",
      typeof body?.code === "string" ? body.code : undefined,
    );
  }
  return body as T;
}

export function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("No se pudo leer la foto."));
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer la foto."));
    reader.readAsDataURL(blob);
  });
}
