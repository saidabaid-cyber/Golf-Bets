/** Club-level capability flags are separate from integrations. A flag alone cannot dispatch a service. */
export const ClubhouseCapabilityRegistry = [
  { key: "restaurant_menu", label: "Menú del restaurante", icon: "♧" },
  { key: "green_fees", label: "Green fees", icon: "↔" },
  { key: "member_exchange", label: "Intercambio entre socios", icon: "⇄" },
  { key: "pro_shop", label: "Pro Shop / Venta de equipo", icon: "♙" },
  { key: "tee_time", label: "Reservar tee time", icon: "▦" },
  { key: "cart_request", label: "Llamar carrito", icon: "♧" },
  { key: "events", label: "Eventos del club", icon: "▧" },
  { key: "storage", label: "Garage / Almacenamiento", icon: "▤" },
] as const;
export type ClubhouseCapabilityKey = typeof ClubhouseCapabilityRegistry[number]["key"];
export type ClubhouseConfig = { clubId: string; label: string; enabled: readonly ClubhouseCapabilityKey[] };
export type ClubhouseIntegrations = Partial<Record<ClubhouseCapabilityKey, () => void>>;
export function clubhouseCapabilities(config?: ClubhouseConfig | null, integrations: ClubhouseIntegrations = {}) {
  return ClubhouseCapabilityRegistry.map(capability => ({
    ...capability,
    action: config?.clubId && config.enabled.includes(capability.key) ? integrations[capability.key] : undefined,
  }));
}
