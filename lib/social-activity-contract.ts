/** Shared API shape. Server rows and canonical round snapshots, never client captions, own the facts. */
export type SocialActivityKind = "ROUND_COMPLETED" | "ACHIEVEMENT" | "EQUIPMENT_UPDATED";
export type SocialActivityAudience = "OWNER" | "FRIENDS";

export type SocialActivityPreferences = {
  /** Explicit master audience choice, separate from public directory visibility. */
  enabledForFriends?: boolean;
  shareRounds: boolean;
  shareAchievements: boolean;
  shareEquipment: boolean;
  shareCourses: boolean;
  notifyLike: boolean;
  notifyComment: boolean;
  notifyAttest: boolean;
  notifyFriendAchievement: boolean;
  notifyEquipment: boolean;
  notifyFriendRequest: boolean;
  updatedAt: string | null;
};

export type SocialActivityAuthor = {
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type SocialRoundCard = {
  roundId: string;
  localRoundId: string;
  date: string;
  courseName: string;
  teeName: string | null;
  holesPlayed: number;
  ownerScore: number | null;
  coursePar: number | null;
  totalOnly?: true;
  toPar?: number;
  putts?: number;
  girPct?: number;
  firPct?: number;
  /** Only account-linked participants with independently authorized social cards. */
  leaderboard?: Array<{userId:string;name:string;avatarUrl:string|null;score:number;toPar?:number;holes:number}>;
  /** Only captured, non-financial hole facts are exposed to the eligible audience. */
  scorecard?: Array<{ hole: number; par: number; score: number | null }>;
};

export type SocialActivityCard = {
  id: string;
  type: SocialActivityKind;
  audience: SocialActivityAudience;
  author: SocialActivityAuthor;
  createdAt: string;
  sourceVersion: number;
  currentHash: string;
  roundId: string | null;
  round: SocialRoundCard | null;
  equipment?: {items:Array<{id:string;category:string;brand:string;model:string;imageUrl?:string}>;total:number};
  achievements: string[];
  courseEvent?: import("./new-course-activity").NewCoursePlayedEvent;
  likesCount: number;
  likedByMe: boolean;
  commentsCount: number;
  attestCount: number;
  isAttestedByMe: boolean;
  canAttest: boolean;
  requiresParticipantConfirmation: boolean;
  participantPlayerKey: string | null;
  /** The target for attestation is the real account-linked author, never a name from the query. */
  targetUserId: string | null;
};

export type SocialActivityPage = {
  data: SocialActivityCard[];
  nextCursor: string | null;
};

export type SocialActivityDetail = { data: SocialActivityCard };

export type SocialNotification = {
  id: string;
  type: "like" | "comment" | "attest" | "friend_achievement" | "equipment" | "friend_request" | "friend_accepted" | "group_invite" | "round_invite" | "round_started" | "round_finished" | "scorecard_ready";
  activityId: string;
  createdAt: string;
  readAt: string | null;
  person?: SocialActivityAuthor | null;
  courseName?: string | null;
};

export type SocialNotificationPage = { data: SocialNotification[]; nextCursor: string | null };

export type SocialPreferencesResult = { data: SocialActivityPreferences };

export type SocialComment = {
  id: string;
  activityId: string;
  author: SocialActivityAuthor;
  text: string;
  createdAt: string;
};

export type SocialMutationErrorCode =
  | "AUTH_REQUIRED" | "CLOUD_UNAVAILABLE" | "SOCIAL_SCHEMA_PENDING"
  | "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "STALE_REVISION"
  | "PARTICIPANT_CONFIRMATION_REQUIRED" | "PARTICIPANT_NOT_LINKED"
  | "ATTEST_SELF" | "ALREADY_ATTESTED" | "COMMENT_TOO_LONG" | "MUTATION_FAILED";

export type SocialMutationBody = {
  code?: SocialMutationErrorCode;
  error?: string;
  data?: unknown;
};

export type SocialLikeRequest = { expectedHash: string };
export type SocialCommentRequest = { text: string; expectedHash: string };
export type SocialParticipantConfirmRequest = {
  playerKey: string;
  /** Advisory display version; expectedHash is the authoritative material CAS. */
  expectedVersion: number;
  expectedHash: string;
};
export type SocialAttestRequest = {
  targetUserId: string;
  /** Advisory display version; cosmetic cloud revisions with the same SHA remain valid. */
  expectedVersion: number;
  expectedHash: string;
};
