export const INVITE_STATES = ["PENDING", "ACCEPTED", "DECLINED", "REVOKED", "EXPIRED"] as const;
export type InviteState = (typeof INVITE_STATES)[number];
export type InviteTarget = "GROUP" | "ROUND" | "GUEST_CLAIM";

export type InviteRecord = {
  id: string;
  targetType: InviteTarget;
  targetId: string;
  inviterId: string;
  inviteeId?: string | null;
  tokenHash: string;
  state: InviteState;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string | null;
  revokedAt?: string | null;
};

export function inviteExpired(invite: Pick<InviteRecord, "expiresAt">, now = new Date()) {
  const expiresAt = new Date(invite.expiresAt);
  return Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime();
}

export function canAcceptInvite(invite: InviteRecord, actorId: string, tokenHash: string, now = new Date()) {
  return invite.state === "PENDING"
    && !inviteExpired(invite, now)
    && invite.tokenHash === tokenHash
    && (!invite.inviteeId || invite.inviteeId === actorId)
    && actorId !== invite.inviterId;
}

export function acceptInvite(invite: InviteRecord, actorId: string, tokenHash: string, now: string) {
  return canAcceptInvite(invite, actorId, tokenHash, new Date(now))
    ? { ...invite, inviteeId: invite.inviteeId ?? actorId, state: "ACCEPTED" as const, acceptedAt: now }
    : invite;
}

export function revokeInvite(invite: InviteRecord, actorId: string, now: string) {
  return invite.inviterId === actorId && invite.state === "PENDING"
    ? { ...invite, state: "REVOKED" as const, revokedAt: now }
    : invite;
}

