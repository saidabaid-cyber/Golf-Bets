import { collectBetConfigurationIssues, type BetConfigurationIssue } from "./bet-config-validation";
import type { GroupTemplateCoreKey } from "./bets/registry";
import type { GroupGameTemplate, Player } from "./types";

/** Configuration adapter only. All validation and settlement stay in the round engine. */
export function patchGroupTemplateCore(template: GroupGameTemplate, key: GroupTemplateCoreKey, patch: Record<string, unknown>): GroupGameTemplate {
  if (key === "pollaFirst" || key === "pollaSecond" || key === "pollaTotal") {
    const component = key === "pollaFirst" ? "first9" : key === "pollaSecond" ? "second9" : "total18";
    return { ...template, betConfig: { ...template.betConfig, polla: { ...template.betConfig.polla, [component]: { ...template.betConfig.polla[component], ...patch } } } };
  }
  // The existing Excel-compatible Foursome mode ignores configured percentages.
  // As in round setup, an explicit handicap edit selects configured calculation.
  const configuredHcp = key === "foursome" && ["hcpPct", "decimals", "baseMode"].some((field) => Object.hasOwn(patch, field))
    ? { handicapMethod: "configured" as const }
    : {};
  return { ...template, betConfig: { ...template.betConfig, [key]: { ...template.betConfig[key], ...patch, ...configuredHcp } } };
}

/** Missing future-round identities/HCP/pairs may be saved as explicit pending work.
 * Invalid prices/modes/multipliers remain errors. Round preflight is NOT relaxed. */
export function isFutureRoundTemplateIssue(issue: BetConfigurationIssue) {
  return issue.code === "active-bet-handicaps"
    || issue.code === "personal-owner"
    || issue.code === "foursome-pairs"
    || issue.code === "foursome-fixed-base"
    || issue.code === "ball-friend-fixed-base"
    || /-participants(?:-selection)?$/.test(issue.code)
    || /^personal-.+-rival$/.test(issue.code)
    || /^supplemental-.+-(?:players|team)$/.test(issue.code);
}

export function groupTemplateConfigurationIssues(template: GroupGameTemplate, players: Player[]) {
  const issues = collectBetConfigurationIssues({
    players,
    ownerId: template.ownerMemberId,
    bets: template.betConfig,
    segments: template.foursomeSegments,
    personalBets: template.personalBets,
    supplementalBets: template.supplementalBets,
    manualBets: template.manualBets,
    roundHoles: template.roundDefaults.roundHoles,
    startHole: template.roundDefaults.startHole,
    handicapBasis: template.roundDefaults.handicapBasis,
  });
  return { blocking: issues.filter((issue) => !isFutureRoundTemplateIssue(issue)), pending: issues.filter(isFutureRoundTemplateIssue) };
}
