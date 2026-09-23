/** One destination per setting; shared controls are never duplicated. */
export const ACCOUNT_SETTINGS = [
  { id: "preferences", label: "Preferencias" },
  { id: "notifications", label: "Notificaciones" },
  { id: "account", label: "Cuenta y privacidad" },
  { id: "privacy", label: "Privacidad y permisos" },
] as const;
export type AccountSettingsSection = typeof ACCOUNT_SETTINGS[number]["id"];
