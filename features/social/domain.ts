export const SOCIAL_PRIVACY_LEVELS = ["PRIVATE", "FRIENDS"] as const;
export type SocialPrivacyLevel = (typeof SOCIAL_PRIVACY_LEVELS)[number];
export const CONNECTION_STATES = ["PENDING", "ACCEPTED", "REJECTED", "BLOCKED", "CANCELLED"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export type SocialProfile = {
  userId: string;
  username: string;
  displayName: string;
  avatar?: string | null;
  handicap?: number | null;
  clubName?: string | null;
  privacy: SocialPrivacyLevel;
};

export type FriendRequest = {
  id: string;
  requesterId: string;
  addresseeId: string;
  state: ConnectionState;
  createdAt: string;
  updatedAt: string;
  operationId: string;
};

export type Friendship = {
  id: string;
  userIds: readonly [string, string];
  createdAt: string;
};

export type SocialGraph = {
  ownerId: string;
  requests: FriendRequest[];
  friendships: Friendship[];
  blockedUserIds: string[];
  recentPlayers: Array<{ userId: string; lastPlayedAt: string; rounds: number }>;
};

export function normalizeUsernameSearch(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "")
    .slice(0, 40);
}

export function socialProfileVisibleTo(profile: SocialProfile, viewerId: string, friendships: readonly Friendship[]) {
  if (profile.userId === viewerId) return true;
  if (profile.privacy === "PRIVATE") return false;
  return friendships.some((friendship) => friendship.userIds.includes(profile.userId) && friendship.userIds.includes(viewerId));
}

export function searchSocialProfiles(
  profiles: readonly SocialProfile[],
  query: unknown,
  viewerId: string,
  friendships: readonly Friendship[],
  limit = 20,
) {
  const normalized = normalizeUsernameSearch(query);
  if (!normalized) return [];
  return profiles
    .filter((profile) => profile.userId !== viewerId)
    .filter((profile) => normalizeUsernameSearch(profile.username).includes(normalized))
    .filter((profile) => socialProfileVisibleTo(profile, viewerId, friendships) || profile.privacy === "FRIENDS")
    .sort((left, right) => {
      const leftExact = normalizeUsernameSearch(left.username) === normalized ? 0 : 1;
      const rightExact = normalizeUsernameSearch(right.username) === normalized ? 0 : 1;
      return leftExact - rightExact || left.username.localeCompare(right.username);
    })
    .slice(0, Math.max(1, Math.min(50, Math.trunc(limit))));
}

function pairKey(first: string, second: string) {
  return [first, second].sort().join(":");
}

export function canSendFriendRequest(graph: SocialGraph, requesterId: string, addresseeId: string) {
  if (!requesterId || !addresseeId || requesterId === addresseeId) return false;
  if (graph.blockedUserIds.includes(addresseeId)) return false;
  if (graph.friendships.some((friendship) => pairKey(...friendship.userIds) === pairKey(requesterId, addresseeId))) return false;
  return !graph.requests.some((request) => request.state === "PENDING" && pairKey(request.requesterId, request.addresseeId) === pairKey(requesterId, addresseeId));
}

export function createFriendRequest(
  graph: SocialGraph,
  input: { requesterId: string; addresseeId: string; id: string; operationId: string; now: string },
) {
  if (input.requesterId !== graph.ownerId || !canSendFriendRequest(graph, input.requesterId, input.addresseeId)) return graph;
  const request: FriendRequest = {
    id: input.id,
    requesterId: input.requesterId,
    addresseeId: input.addresseeId,
    state: "PENDING",
    createdAt: input.now,
    updatedAt: input.now,
    operationId: input.operationId,
  };
  return { ...graph, requests: [...graph.requests, request] };
}

export function respondToFriendRequest(
  graph: SocialGraph,
  requestId: string,
  actorId: string,
  action: "ACCEPTED" | "REJECTED",
  now: string,
) {
  const request = graph.requests.find((candidate) => candidate.id === requestId);
  if (!request || request.state !== "PENDING" || request.addresseeId !== actorId) return graph;
  const requests = graph.requests.map((candidate) => candidate.id === requestId ? { ...candidate, state: action, updatedAt: now } : candidate);
  if (action === "REJECTED") return { ...graph, requests };
  const key = pairKey(request.requesterId, request.addresseeId);
  const friendship = graph.friendships.find((candidate) => pairKey(...candidate.userIds) === key);
  return {
    ...graph,
    requests,
    friendships: friendship ? graph.friendships : [...graph.friendships, {
      id: `friendship:${key}`,
      userIds: [request.requesterId, request.addresseeId].sort() as [string, string],
      createdAt: now,
    }],
  };
}

export function removeFriend(graph: SocialGraph, actorId: string, otherId: string) {
  if (actorId !== graph.ownerId) return graph;
  return { ...graph, friendships: graph.friendships.filter((friendship) => pairKey(...friendship.userIds) !== pairKey(actorId, otherId)) };
}

export function blockConnection(graph: SocialGraph, actorId: string, otherId: string, now: string) {
  if (actorId !== graph.ownerId || actorId === otherId || !otherId) return graph;
  const withoutFriend = removeFriend(graph, actorId, otherId);
  return {
    ...withoutFriend,
    blockedUserIds: withoutFriend.blockedUserIds.includes(otherId) ? withoutFriend.blockedUserIds : [...withoutFriend.blockedUserIds, otherId],
    requests: withoutFriend.requests.map((request) => pairKey(request.requesterId, request.addresseeId) === pairKey(actorId, otherId) && request.state === "PENDING"
      ? { ...request, state: "BLOCKED", updatedAt: now }
      : request),
  };
}

export function frequentFriends(graph: SocialGraph, limit = 8) {
  const friendIds = new Set(graph.friendships.flatMap((friendship) => friendship.userIds).filter((id) => id !== graph.ownerId));
  return graph.recentPlayers
    .filter((player) => friendIds.has(player.userId))
    .sort((left, right) => right.rounds - left.rounds || right.lastPlayedAt.localeCompare(left.lastPlayedAt))
    .slice(0, limit);
}

export function emptySocialGraph(ownerId: string): SocialGraph {
  return { ownerId, requests: [], friendships: [], blockedUserIds: [], recentPlayers: [] };
}

