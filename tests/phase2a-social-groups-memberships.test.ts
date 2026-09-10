import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  blockConnection,
  canSendFriendRequest,
  createFriendRequest,
  emptySocialGraph,
  frequentFriends,
  normalizeUsernameSearch,
  respondToFriendRequest,
  searchSocialProfiles,
  type SocialProfile,
} from "../features/social/domain";
import { acceptInvite, canAcceptInvite, revokeInvite, type InviteRecord } from "../features/invites/domain";
import { addGroupMember, canManageGroup, resolveGroupMemory, reviewGroupRoundTemplate, saveGroupMemory, verifyGuestClaim, type GroupV2 } from "../features/groups/domain";
import { PHASE2_FEATURE_FLAG_IDS, resolvePhase2FeatureFlags } from "../features/feature-flags/registry";
import { canUseFeature, consumeAllowance, featureAllowance, membershipEntitlement } from "../features/memberships/registry";

const root = process.cwd();

test("username search normalizes @, case, accents and never searches email", () => {
  assert.equal(normalizeUsernameSearch("  @Sáíd_Aba  "), "said_aba");
  assert.equal(normalizeUsernameSearch("said+mail@example.com"), "saidmailexample.com");
  const profiles: SocialProfile[] = [
    { userId: "u2", username: "said_aba", displayName: "Said", privacy: "FRIENDS", handicap: 8, clubName: "Privado" },
    { userId: "u3", username: "said_private", displayName: "Private", privacy: "PRIVATE" },
  ];
  const discovery = searchSocialProfiles(profiles, "@SAID_ABA", "u1", []);
  assert.deepEqual(discovery, [{ userId: "u2", username: "said_aba", displayName: "Said", avatar: null, privacy: "FRIENDS" }]);
  assert.equal(discovery[0]?.handicap, undefined);
  assert.deepEqual(searchSocialProfiles(profiles, "@SAID_ABA", "u1", [{ id: "f1", userIds: ["u1", "u2"], createdAt: "2026-09-10T00:00:00Z" }]), [profiles[0]]);
});

test("friend requests are duplicate-safe and only the addressee can accept", () => {
  const empty = emptySocialGraph("u1");
  const pending = createFriendRequest(empty, { requesterId: "u1", addresseeId: "u2", id: "r1", operationId: "op1", now: "2026-09-10T10:00:00Z" });
  assert.equal(pending.requests.length, 1);
  assert.equal(canSendFriendRequest(pending, "u1", "u2"), false);
  assert.equal(respondToFriendRequest(pending, "r1", "u1", "ACCEPTED", "2026-09-10T10:01:00Z"), pending);
  const accepted = respondToFriendRequest(pending, "r1", "u2", "ACCEPTED", "2026-09-10T10:01:00Z");
  assert.equal(accepted.friendships.length, 1);
  const recent = { ...accepted, recentPlayers: [{ userId: "u2", rounds: 4, lastPlayedAt: "2026-09-10T00:00:00Z" }] };
  assert.equal(frequentFriends(recent)[0]?.userId, "u2");
  const blocked = blockConnection(recent, "u1", "u2", "2026-09-10T10:02:00Z");
  assert.equal(blocked.friendships.length, 0);
  assert.deepEqual(blocked.blockedUserIds, ["u2"]);
});

test("secure invite state enforces token, expiry, identity and revocation", () => {
  const invite: InviteRecord = { id: "i1", targetType: "GROUP", targetId: "g1", inviterId: "u1", inviteeId: "u2", tokenHash: "abc", state: "PENDING", createdAt: "2026-09-10T10:00:00Z", expiresAt: "2026-09-11T10:00:00Z" };
  assert.equal(canAcceptInvite(invite, "u3", "abc", new Date("2026-09-10T12:00:00Z")), false);
  assert.equal(canAcceptInvite(invite, "u2", "wrong", new Date("2026-09-10T12:00:00Z")), false);
  assert.equal(acceptInvite(invite, "u2", "abc", "2026-09-10T12:00:00Z").state, "ACCEPTED");
  assert.equal(revokeInvite(invite, "u1", "2026-09-10T12:00:00Z").state, "REVOKED");
});

test("group roles guard membership and deterministic memory remains reviewable", () => {
  const template = { version: 1 as const, playerIds: ["p1"], teeByPlayerId: { p1: "white" }, betConfig: { skins: 200 }, handicapBasis: "relative" as const };
  const group: GroupV2 = { id: "g1", name: "Domingo", ownerId: "u1", privacy: "MEMBERS", members: [], defaultTemplate: template, memory: [], createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z" };
  assert.equal(canManageGroup(group, "u1"), true);
  assert.equal(addGroupMember(group, "u2", { id: "m1", groupId: "g1", role: "MEMBER", userId: "u2", displayName: "Pedro", joinedAt: "2026-09-10T00:00:00Z" }, "2026-09-10T01:00:00Z"), group);
  const withMember = addGroupMember(group, "u1", { id: "m1", groupId: "g1", role: "MEMBER", userId: "u2", displayName: "Pedro", joinedAt: "2026-09-10T00:00:00Z" }, "2026-09-10T01:00:00Z");
  assert.equal(withMember.members.length, 1);
  const withMemory = saveGroupMemory(withMember, "u1", { groupId: "g1", key: "LAST_SUNDAY", template, updatedAt: "2026-09-10T02:00:00Z", updatedBy: "u1" });
  assert.equal(resolveGroupMemory(withMemory, "los mismos del domingo")?.key, "LAST_SUNDAY");
  const reviewed = reviewGroupRoundTemplate(template, "2026-09-10T03:00:00Z");
  assert.equal(reviewed.reviewedAt, "2026-09-10T03:00:00Z");
});

test("guest claim cannot be auto-linked by the claimant or weak identity", () => {
  const claim = { id: "c1", guestPlayerId: "p1", claimantId: "u2", createdBy: "u1", verificationMethod: "SIGNED_INVITE" as const, state: "PENDING" as const, createdAt: "2026-09-10T00:00:00Z" };
  assert.equal(verifyGuestClaim(claim, "u2", "2026-09-10T01:00:00Z"), claim);
  assert.equal(verifyGuestClaim(claim, "u1", "2026-09-10T01:00:00Z").state, "VERIFIED");
});

test("feature registry has every required unique flag and external defaults fail closed", () => {
  assert.equal(new Set(PHASE2_FEATURE_FLAG_IDS).size, PHASE2_FEATURE_FLAG_IDS.length);
  const preview = resolvePhase2FeatureFlags("preview");
  assert.equal(preview.social_v2, true);
  assert.equal(preview.push_notifications, false);
  assert.equal(preview.wearable_v1, false);
  const production = resolvePhase2FeatureFlags("production");
  assert.equal(Object.values(production).some(Boolean), false);
});

test("BETA_PRO never blocks while Free allowances are registry-driven", () => {
  assert.equal(membershipEntitlement("BETA_PRO", "SHOT_TRACKING"), "AVAILABLE");
  assert.equal(canUseFeature("BETA_PRO", "CARD_AI", { used: 999, window: "monthly", windowKey: "2026-09" }), true);
  assert.deepEqual(featureAllowance("FREE", "CARD_AI"), { limit: 2, window: "monthly" });
  const counter = { used: 1, window: "monthly" as const, windowKey: "2026-09" };
  assert.equal(consumeAllowance("FREE", "CARD_AI", counter).used, 2);
  assert.equal(canUseFeature("FREE", "CARD_AI", { ...counter, used: 2 }), false);
  assert.equal(canUseFeature(undefined, "SHOT_TRACKING"), false);
  assert.equal(canUseFeature("tampered-plan", "SHOT_TRACKING"), false);
});

test("Phase 2A migration is additive, RLS protected and stores only hashed invite tokens", () => {
  const migration = readFileSync(`${root}/supabase/migrations/202609100001_phase2_social_groups_memberships.sql`, "utf8");
  for (const table of ["social_profiles", "friend_requests", "friendships", "groups_v2", "group_memberships_v2", "group_invites_v2", "guest_player_claims_v2", "feature_entitlements"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /token_hash text not null unique/);
  assert.match(migration, /search_social_profiles_v2/);
  assert.match(migration, /private\.can_send_friend_request/);
  assert.match(migration, /insert into public\.friendships/);
  assert.match(migration, /blocked_connection_cleanup/);
  assert.match(migration, /group_invite_transition_guard/);
  assert.match(migration, /round_invite_transition_guard/);
  assert.match(migration, /handle_phase2_user_bootstrap/);
  assert.match(migration, /name = ''/);
  assert.match(migration, /username_candidate/);
  assert.match(migration, /values \(new\.id, 'BETA_PRO'/);
  assert.match(migration, /returns table\(user_id uuid, username text, display_name text, avatar_url text\)/);
  assert.match(migration, /social_profiles_self_or_friend/);
  assert.doesNotMatch(migration, /using \(user_id = \(select auth\.uid\(\)\) or privacy = 'FRIENDS'\)/);
  assert.doesNotMatch(migration, /\btoken\s+text\b/);
  assert.doesNotMatch(migration, /drop table|truncate table|user_metadata/i);
});

test("Social UI, server search, memberships and Home V2 remain reachable", () => {
  const social = readFileSync(`${root}/app/components/social-feed.tsx`, "utf8");
  const search = readFileSync(`${root}/app/api/social/search/route.ts`, "utf8");
  const membership = readFileSync(`${root}/app/components/membership-benefits.tsx`, "utf8");
  const home = readFileSync(`${root}/app/components/home-dashboard.tsx`, "utf8");
  assert.match(social, /Amigos/);
  assert.match(search, /search_social_profiles_v2/);
  assert.doesNotMatch(search, /handicap|club_name/);
  assert.match(membership, /BETA PRO/);
  assert.match(home, /RONDA ABIERTA/);
  assert.match(home, /CONFIGURAR CON BACKYARD AI/);
});
