/** AbortController works on Safari versions without AbortSignal.timeout/any. */
export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const original = init.signal || (input instanceof Request ? input.signal : null);
  if (original?.aborted) abort();
  else original?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); original?.removeEventListener("abort", abort); }
}
