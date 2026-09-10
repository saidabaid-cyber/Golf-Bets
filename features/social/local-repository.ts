import { CONNECTION_STATES, emptySocialGraph, searchSocialProfiles, type SocialGraph, type SocialProfile } from "./domain";

const KEY_PREFIX = "backyard:phase2:social:";

export interface SocialRepository {
  loadGraph(ownerId: string): Promise<SocialGraph>;
  saveGraph(graph: SocialGraph): Promise<void>;
  searchProfiles(query: string, viewerId: string, limit?: number): Promise<SocialProfile[]>;
}

function parseGraph(value: string | null, ownerId: string): SocialGraph {
  if (!value) return emptySocialGraph(ownerId);
  try {
    const raw = JSON.parse(value) as Partial<SocialGraph>;
    if (raw.ownerId !== ownerId) return emptySocialGraph(ownerId);
    return {
      ownerId,
      requests: Array.isArray(raw.requests) ? raw.requests.filter((request) => request && CONNECTION_STATES.includes(request.state)) : [],
      friendships: Array.isArray(raw.friendships) ? raw.friendships.filter((item) => item && Array.isArray(item.userIds) && item.userIds.length === 2) : [],
      blockedUserIds: Array.isArray(raw.blockedUserIds) ? raw.blockedUserIds.filter((id): id is string => typeof id === "string") : [],
      recentPlayers: Array.isArray(raw.recentPlayers) ? raw.recentPlayers.filter((item) => item && typeof item.userId === "string") : [],
    } as SocialGraph;
  } catch {
    return emptySocialGraph(ownerId);
  }
}

export function createLocalSocialRepository(storage: Storage, directory: readonly SocialProfile[]): SocialRepository {
  return {
    async loadGraph(ownerId) {
      return parseGraph(storage.getItem(`${KEY_PREFIX}${ownerId}`), ownerId);
    },
    async saveGraph(graph) {
      storage.setItem(`${KEY_PREFIX}${graph.ownerId}`, JSON.stringify(graph));
    },
    async searchProfiles(query, viewerId, limit = 20) {
      const graph = parseGraph(storage.getItem(`${KEY_PREFIX}${viewerId}`), viewerId);
      return searchSocialProfiles(directory, query, viewerId, graph.friendships, limit);
    },
  };
}
