export type LocationPermissionUiState =
  | "checking"
  | "prompt"
  | "granted"
  | "denied"
  | "query-unsupported"
  | "geolocation-unavailable"
  | "requesting"
  | "timeout"
  | "unavailable";

export type NotificationPermissionUiState =
  | "checking"
  | "default"
  | "granted"
  | "denied"
  | "unavailable"
  | "requesting";

export type DevicePermissionContext = {
  ios: boolean;
  standalone: boolean;
  notificationApi: boolean;
};

export type PermissionPresentation = {
  status: string;
  detail?: string;
  action: "request" | "retry" | "help" | "install-help" | null;
  actionLabel?: string;
};

export function devicePermissionContext(input: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standaloneDisplayMode?: boolean;
  navigatorStandalone?: boolean;
  notificationApi?: boolean;
}): DevicePermissionContext {
  const ios = /iPad|iPhone|iPod/i.test(input.userAgent || "")
    || (input.platform === "MacIntel" && (input.maxTouchPoints || 0) > 1);
  return {
    ios,
    standalone: input.standaloneDisplayMode === true || input.navigatorStandalone === true,
    notificationApi: input.notificationApi === true,
  };
}

export function locationPermissionPresentation(state: LocationPermissionUiState): PermissionPresentation {
  if (state === "checking") return { status: "Consultando permiso…", action: null };
  if (state === "requesting") return { status: "Solicitando permiso…", action: null };
  if (state === "prompt") return {
    status: "La ubicación todavía no se ha solicitado en este navegador.",
    action: "request",
    actionLabel: "Permitir ubicación",
  };
  if (state === "granted") return {
    status: "Ubicación permitida",
    detail: "The Backyard puede usarla cuando pidas campos cercanos. No puede revocar este permiso por ti.",
    action: "help",
    actionLabel: "Cómo cambiar este permiso",
  };
  if (state === "denied") return {
    status: "Ubicación bloqueada",
    detail: "El navegador no volverá a mostrar el aviso automáticamente.",
    action: "help",
    actionLabel: "Cómo habilitarla",
  };
  if (state === "query-unsupported") return {
    status: "No podemos consultar este permiso desde este navegador.",
    detail: "Puedes revisar el permiso desde los ajustes del sitio. La búsqueda manual de campos sigue disponible.",
    action: "help",
    actionLabel: "Cómo revisar este permiso",
  };
  if (state === "geolocation-unavailable") return {
    status: "La ubicación no está disponible en este navegador.",
    detail: "Puedes buscar campos manualmente.",
    action: "help",
    actionLabel: "Ver alternativas",
  };
  if (state === "timeout") return {
    status: "La solicitud de ubicación tardó demasiado.",
    detail: "Puedes reintentar o continuar con la búsqueda manual.",
    action: "retry",
    actionLabel: "Reintentar ubicación",
  };
  return {
    status: "No pudimos obtener la ubicación de este dispositivo.",
    detail: "Comprueba que la ubicación del dispositivo esté activa o busca el campo manualmente.",
    action: "retry",
    actionLabel: "Reintentar ubicación",
  };
}

export function notificationPermissionPresentation(
  state: NotificationPermissionUiState,
  context: DevicePermissionContext,
  pushBackendConfigured = false,
): PermissionPresentation {
  if (context.ios && !context.standalone) return {
    status: "Las notificaciones push requieren instalar The Backyard en la pantalla de inicio.",
    detail: "Después abre The Backyard desde su icono y regresa a Permisos.",
    action: "install-help",
    actionLabel: "Cómo instalar The Backyard",
  };
  if (!context.notificationApi || state === "unavailable") return {
    status: "Las notificaciones no están disponibles en este navegador o contexto.",
    detail: context.ios
      ? "Abre la app instalada desde su icono en la pantalla de inicio."
      : "Puedes conservar tus preferencias; este navegador no puede solicitar el permiso del dispositivo.",
    action: "help",
    actionLabel: "Más información",
  };
  if (state === "checking") return { status: "Consultando permiso…", action: null };
  if (state === "requesting") return { status: "Solicitando permiso…", action: null };
  if (state === "default") return {
    status: "Las notificaciones todavía no se han solicitado en este dispositivo.",
    detail: "El navegador mostrará su aviso al tocar el botón.",
    action: "request",
    actionLabel: "Permitir notificaciones",
  };
  if (state === "granted") return {
    status: "Permitidas en este dispositivo",
    detail: pushBackendConfigured
      ? "El permiso del navegador está listo. Tus preferencias deciden qué avisos recibir."
      : "El envío push de The Backyard todavía no está activado.",
    action: "help",
    actionLabel: "Cómo cambiar este permiso",
  };
  return {
    status: "Bloqueadas en este dispositivo",
    detail: "El navegador no permite volver a abrir el aviso automáticamente.",
    action: "help",
    actionLabel: "Cómo habilitarlas",
  };
}
