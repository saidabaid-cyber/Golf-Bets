import { socialBody, socialHttp } from "../../../../lib/social-http.server";
import { EMPTY_COMPLETION_CHOICES, profileCompletion, validCompletionChoices } from "../../../../lib/profile-completion";
import { normalizeEquipmentProfile } from "../../../../lib/golf-equipment";
import { BACKYARD_INDEX_METADATA_KEY, parseIndexPreference } from "../../../../lib/backyard-index-preferences";
import type { SocialContext } from "../../../../lib/social-activity.server";
async function read(ctx: SocialContext) {
 const [profile, user, choices, equipment, ghin] = await Promise.all([
  ctx.client.from("profiles").select("display_name,username,avatar_url").eq("id", ctx.userId).single(),
  ctx.client.auth.getUser(),
  ctx.client.from("profile_completion_choices").select("handicap_choice,manual_hcp,not_applicable").eq("user_id", ctx.userId).maybeSingle(),
  ctx.client.from("player_equipment_profiles").select("snapshot,version").eq("user_id", ctx.userId).maybeSingle(),
  ctx.client.from("player_handicap_provider_profiles").select("association_status,handicap_index").eq("owner_id", ctx.userId).eq("provider", "GHIN").eq("association_status", "VERIFIED").maybeSingle(),
 ]);
 if (profile.error || user.error || choices.error || equipment.error || ghin.error) throw new Error("COMPLETION_READ_FAILED");
 const metadata = user.data.user?.user_metadata || {};
 const golf = metadata.backyard_golf_profile_v1 || {};
 const decisions = choices.data || EMPTY_COMPLETION_CHOICES;
 const equipmentProfile = normalizeEquipmentProfile(equipment.data?.snapshot, ctx.userId);
 const indexPreference = parseIndexPreference(metadata[BACKYARD_INDEX_METADATA_KEY], ctx.userId);
 const indexResolution = indexPreference?.handicapSource === "GHIN" ? "GHIN" as const
  : indexPreference?.enabled ? "BACKYARD" as const
  : indexPreference ? "NONE" as const : null;
 return { choices: decisions,
  equipmentRevision: equipmentProfile ? { version: equipment.data?.version || 0, updatedAt: equipmentProfile.updatedAt } : null,
  progress: profileCompletion({ displayName: profile.data.display_name, avatarUrl: profile.data.avatar_url, username: profile.data.username,
  givenName: metadata.given_name, familyName: metadata.family_name, handedness: golf.handedness, homeClub: golf.homeClub, preferredTee: golf.preferredTee,
  indexEnabled: indexPreference?.enabled === true, indexResolution,
  indexValue: indexResolution === "GHIN" && typeof ghin.data?.handicap_index === "number" ? ghin.data.handicap_index : null,
  equipment: equipmentProfile, choices: decisions }) };
}
export async function GET(request: Request) { return socialHttp(request, read); }
export async function PUT(request: Request) {
 return socialHttp(request, async ctx => {
  const body = await socialBody(request);
  if (!validCompletionChoices(body)) throw Object.assign(new Error(), { status:400, code:"INVALID_REQUEST" });
  const { error } = await ctx.client.from("profile_completion_choices").upsert({ user_id: ctx.userId, handicap_choice: body.handicap_choice, manual_hcp: body.manual_hcp, not_applicable: [...new Set(body.not_applicable)], updated_at: new Date().toISOString() });
  if (error) throw error;
  return read(ctx);
 });
}
