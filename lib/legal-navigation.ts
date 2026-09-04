export type LegalReturnContext = "account" | "onboarding" | "access";

export function legalReturnDestination(value: string | null) {
  if (value === "account") return { href: "/?screen=account", label: "← Regresar a Mi Cuenta" };
  if (value === "onboarding") return { href: "/", label: "← Regresar al consentimiento" };
  if (value === "access") return { href: "/", label: "← Regresar al acceso" };
  return { href: "/", label: "← Volver a The Backyard" };
}

export function preserveLegalReturn(href: string, value: string | null) {
  if (!value || !["account", "onboarding", "access"].includes(value)) return href;
  const [path, hash = ""] = href.split("#");
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}returnTo=${value}${hash ? `#${hash}` : ""}`;
}
