/** Shared validation and presentation; no credentials or provider logic. */
export function normalizedInvitationEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export type GroupInvitation = {
  id: string; group_id: string; group_name: string; recipient_label: string;
  state: "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED";
  delivery_status: "NOT_SENT" | "SENDING" | "ACCEPTED_BY_PROVIDER" | "FAILED";
  error_code?: string; expires_at: string; outgoing: boolean;
};
export type BackyardGroupUser = { user_id: string; username: string; display_name: string; avatar_url: string | null; is_friend: boolean };

export function invitationStatus(invite: GroupInvitation) {
  if (invite.state === "ACCEPTED") return "Aceptada";
  if (invite.state !== "PENDING") return invite.state === "REVOKED" ? "Revocada" : "Rechazada";
  if (Date.parse(invite.expires_at) <= Date.now()) return "Vencida";
  if (invite.delivery_status === "FAILED") return "Envío fallido · puedes reintentar";
  if (invite.delivery_status === "SENDING") return "Enviando…";
  if (invite.delivery_status === "ACCEPTED_BY_PROVIDER") return "Pendiente de aceptar · proveedor aceptó el correo; entrega no confirmada";
  return "Pendiente de aceptar · correo no enviado";
}

export function parseGroupInvitationLink(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const id = params.get("groupInvite"), token = params.get("token");
  return id && /^[0-9a-f-]{36}$/i.test(id) && token && /^[0-9a-f]{64}$/.test(token) ? { invitationId: id, token } : null;
}
