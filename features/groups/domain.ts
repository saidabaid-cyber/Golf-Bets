export const GROUP_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export type GroupMemberV2 = {
  id: string;
  groupId: string;
  role: GroupRole;
  userId?: string | null;
  guestPlayerId?: string | null;
  displayName: string;
  joinedAt: string;
};

export type GroupRoundTemplate = {
  version: 1;
  courseId?: string | null;
  playerIds: string[];
  teeByPlayerId: Record<string, string>;
  betConfig: unknown;
  handicapBasis: "course" | "relative";
  reviewedAt?: string | null;
};

export type GroupMemory = {
  groupId: string;
  key: "LAST_ROUND" | "LAST_SUNDAY" | "DEFAULT";
  template: GroupRoundTemplate;
  sourceRoundId?: string | null;
  updatedAt: string;
  updatedBy: string;
};

export type GroupV2 = {
  id: string;
  name: string;
  image?: string | null;
  ownerId: string;
  privacy: "PRIVATE" | "MEMBERS";
  members: GroupMemberV2[];
  defaultTemplate?: GroupRoundTemplate | null;
  memory: GroupMemory[];
  createdAt: string;
  updatedAt: string;
};

export function groupRole(group: GroupV2, actorId: string): GroupRole | null {
  if (group.ownerId === actorId) return "OWNER";
  return group.members.find((member) => member.userId === actorId)?.role ?? null;
}

export function canManageGroup(group: GroupV2, actorId: string) {
  const role = groupRole(group, actorId);
  return role === "OWNER" || role === "ADMIN";
}

export function canViewGroup(group: GroupV2, actorId: string) {
  return groupRole(group, actorId) !== null;
}

export function addGroupMember(group: GroupV2, actorId: string, member: GroupMemberV2, now: string) {
  if (!canManageGroup(group, actorId) || member.groupId !== group.id) return group;
  const duplicate = group.members.some((existing) =>
    (member.userId && existing.userId === member.userId)
    || (member.guestPlayerId && existing.guestPlayerId === member.guestPlayerId));
  return duplicate ? group : { ...group, members: [...group.members, member], updatedAt: now };
}

export function saveGroupMemory(group: GroupV2, actorId: string, memory: GroupMemory) {
  if (!canManageGroup(group, actorId) || memory.groupId !== group.id || memory.updatedBy !== actorId) return group;
  return { ...group, memory: [...group.memory.filter((item) => item.key !== memory.key), memory], updatedAt: memory.updatedAt };
}

export function resolveGroupMemory(group: GroupV2, phrase: string) {
  const normalized = phrase.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const key: GroupMemory["key"] = normalized.includes("domingo")
    ? "LAST_SUNDAY"
    : normalized.includes("semana pasada") || normalized.includes("ultima")
      ? "LAST_ROUND"
      : "DEFAULT";
  return group.memory.find((memory) => memory.key === key) ?? (group.defaultTemplate ? {
    groupId: group.id,
    key: "DEFAULT" as const,
    template: group.defaultTemplate,
    updatedAt: group.updatedAt,
    updatedBy: group.ownerId,
  } : undefined);
}

export function reviewGroupRoundTemplate(template: GroupRoundTemplate, reviewedAt: string): GroupRoundTemplate {
  return { ...template, playerIds: [...template.playerIds], teeByPlayerId: { ...template.teeByPlayerId }, reviewedAt };
}

export type GuestClaim = {
  id: string;
  guestPlayerId: string;
  claimantId: string;
  createdBy: string;
  verificationMethod: "SIGNED_INVITE" | "ADMIN_REVIEW";
  state: "PENDING" | "VERIFIED" | "REJECTED" | "REVOKED";
  createdAt: string;
  verifiedAt?: string | null;
};

export function verifyGuestClaim(claim: GuestClaim, actorId: string, now: string) {
  if (claim.state !== "PENDING" || actorId !== claim.createdBy || claim.claimantId === claim.createdBy) return claim;
  return { ...claim, state: "VERIFIED" as const, verifiedAt: now };
}
