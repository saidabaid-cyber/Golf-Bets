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
  if (error.error === "not-allowed" || error.error === "service-not-allowed") return "No se concedió permiso para usar el micrófono.";
  if (error.error === "no-speech") return "No escuchamos voz. Intenta nuevamente.";
  if (error.error === "audio-capture") return "No se encontró un micrófono disponible.";
  if (error.error === "aborted") return "Dictado cancelado.";
  return "No fue posible usar el dictado en este momento.";
}
