export type SpeechRecognitionErrorLike = { error?: string; message?: string };

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export function speechRecognitionConstructor(scope: { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }) {
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null;
}

export function speechRecognitionErrorMessage(error: SpeechRecognitionErrorLike) {
  if (error.error === "not-allowed" || error.error === "service-not-allowed") return "No se concedió permiso para usar el micrófono. En iPhone revisa el permiso de micrófono de Safari y que Siri/Dictado estén habilitados. Si abriste la app desde otro navegador, prueba en Safari.";
  if (error.error === "no-speech") return "No escuchamos voz. Intenta nuevamente.";
  if (error.error === "audio-capture") return "No se encontró un micrófono disponible.";
  if (error.error === "aborted") return "Dictado cancelado.";
  if (error.error === "network") return "El servicio de dictado no tiene conexión. Revisa tu red e intenta nuevamente; puedes escribir la búsqueda.";
  if (error.error === "language-not-supported") return "Este dispositivo no tiene disponible dictado en español. Puedes escribir la búsqueda.";
  return "No fue posible usar el dictado en este momento.";
}

export const DICTATION_FALLBACK = "El dictado no está disponible en este navegador. Usa el micrófono del teclado del iPhone.";
export const DICTATION_NO_RESULT = DICTATION_FALLBACK;

/** start() must be called synchronously inside the user's tap, without awaiting
 * getUserMedia or a network request. stop() still accepts Safari's final result. */
export function createDictationSession(Recognition: SpeechRecognitionConstructor, callbacks: {
  transcript: (text: string) => void; status: (message: string) => void; listening: (value: boolean) => void; fallback?: () => void;
}) {
  const recognition = new Recognition();
  let disposed = false, received = false, failed = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (watchdog) clearTimeout(watchdog); watchdog = undefined; };
  const guard = (milliseconds: number) => {
    clear();
    watchdog = setTimeout(() => {
      if (disposed) return;
      failed = true; callbacks.listening(false);
      callbacks.status(received ? "Texto dictado. Puedes revisar la búsqueda." : DICTATION_FALLBACK);
      if (!received) callbacks.fallback?.();
      try { recognition.stop(); } catch { /* A stalled WebKit service may already be stopped. */ }
    }, milliseconds);
  };
  recognition.lang = "es-MX"; recognition.continuous = false; recognition.interimResults = true;
  recognition.onstart = () => { if (!disposed) { guard(20000); callbacks.listening(true); callbacks.status("Escuchando…"); } };
  recognition.onresult = event => {
    if (disposed) return;
    const text = Array.from(event.results).map(result => result[0]?.transcript || "").join(" ").trim();
    if (text) { received = true; callbacks.transcript(text); callbacks.status("Texto dictado. Puedes revisar la búsqueda."); }
  };
  recognition.onerror = error => { if (!disposed) { failed = true; clear(); callbacks.status(speechRecognitionErrorMessage(error)); callbacks.listening(false); callbacks.fallback?.(); } };
  recognition.onend = () => { if (!disposed) { clear(); callbacks.listening(false); if (!received && !failed) { callbacks.status(DICTATION_NO_RESULT); callbacks.fallback?.(); } } };
  return {
    start() {
      callbacks.listening(true); callbacks.status("Solicitando acceso al micrófono…");
      guard(12000);
      try { recognition.start(); } catch { clear(); failed = true; callbacks.listening(false); callbacks.status(DICTATION_FALLBACK); callbacks.fallback?.(); }
    },
    stop() { guard(5000); try { recognition.stop(); } catch { clear(); callbacks.listening(false); } },
    dispose() { disposed = true; clear(); recognition.onstart = null; recognition.onresult = null; recognition.onerror = null; recognition.onend = null; try { recognition.stop(); } catch { /* Already stopped. */ } },
  };
}
