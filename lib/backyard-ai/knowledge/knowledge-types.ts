import type { JsonObject } from "../memory/types";

export type KnowledgeSourceType = "OFFICIAL" | "VERIFIED" | "COMMUNITY" | "USER_PROVIDED" | "INFERRED";
export type KnowledgeScope = "GLOBAL" | "PERSONAL" | "GROUP";
export type KnowledgeStatus = "DRAFT" | "VERIFIED" | "RETIRED";

export type KnowledgeSource = {
  schemaVersion: 1;
  id: string;
  sourceType: KnowledgeSourceType;
  sourceName: string;
  sourceUrlOrIdentifier: string;
  retrievedAt: string;
  verifiedAt?: string;
  confidence: number;
  jurisdiction: string;
  version: string;
  locale?: string;
  scope: KnowledgeScope;
  ownerId?: string;
  groupId?: string;
  licenseName?: string;
  licenseUrl?: string;
  usageRights: "ALLOWED" | "RESTRICTED" | "UNKNOWN";
  contentDigest?: string;
  active: boolean;
};

export type KnowledgeItemKind =
  | "RULE"
  | "GAME"
  | "GAME_VARIANT"
  | "COURSE"
  | "TEE"
  | "EQUIPMENT"
  | "DEFINITION"
  | "LOCAL_RULE"
  | "OTHER";

export type KnowledgeItem = {
  schemaVersion: 1;
  id: string;
  sourceId: string;
  kind: KnowledgeItemKind;
  title: string;
  aliases: string[];
  content: JsonObject;
  locale: string;
  region?: string;
  jurisdiction: string;
  ruleset?: string;
  scope: KnowledgeScope;
  ownerId?: string;
  groupId?: string;
  status: KnowledgeStatus;
  confidence: number;
  version: string;
  validFrom?: string;
  validUntil?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeProvenance = {
  sourceId: string;
  sourceType: KnowledgeSourceType;
  sourceName: string;
  sourceUrlOrIdentifier: string;
  retrievedAt: string;
  verifiedAt?: string;
  confidence: number;
  jurisdiction: string;
  version: string;
  usageRights: KnowledgeSource["usageRights"];
  contentDigest?: string;
};

export type KnowledgeValidationIssue = {
  code:
    | "INVALID_RECORD"
    | "INVALID_ID"
    | "INVALID_DATE"
    | "INVALID_CONFIDENCE"
    | "MISSING_PROVENANCE"
    | "MISSING_VERIFICATION"
    | "SCOPE_MISMATCH"
    | "SOURCE_MISMATCH"
    | "INVALID_VALIDITY_WINDOW"
    | "UNLICENSED_EXTERNAL_USE";
  message: string;
  field?: string;
};

export type KnowledgeAudit = {
  valid: boolean;
  issues: KnowledgeValidationIssue[];
  provenance?: KnowledgeProvenance;
};
