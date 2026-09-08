import { normalizeFoursomeSegments, playOrder } from "../../engine";
import { migrateSupplementalNassau } from "../../nassau-migration";
import { initialBets } from "../../new-round-bets";
import { personalNassauBetsForRoundHoles, personalNassauComponentsForRoundHoles } from "../../personal-nassau";
import { createSupplementalBet, supplementalBetsForRoundHoles } from "../../supplemental-bets";
import type { BetConfig } from "../../types";
import type { RoundSetupAction } from "../schemas/actions";
import { cloneRoundSetupDraft, type RoundSetupDraft } from "../schemas/round-setup";
import { validateRoundSetupAction, type RoundSetupActionValidation } from "./action-validator";

export type RejectedRoundSetupAction = {
  index: number;
  action: RoundSetupAction;
  validation: Extract<RoundSetupActionValidation, { valid: false }>;
};

export type ExecuteRoundSetupActionsResult = {
  draft: RoundSetupDraft;
  applied: RoundSetupAction[];
  rejected: RejectedRoundSetupAction[];
};

function definedPatch<T extends object>(patch: T) {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function configuredParticipants(current: string[], requested: string[] | undefined, allPlayerIds: string[]) {
  if (requested) return [...requested];
  const available = new Set(allPlayerIds);
  const retained = current.filter((id) => available.has(id));
  return retained.length ? retained : [...allPlayerIds];
}

function patchValueConfig<T extends { enabled: boolean; value: number; participantIds: string[] }>(
  current: T,
  action: Extract<RoundSetupAction, { type: "configure_core_bet" }>,
  allPlayerIds: string[],
) {
  return {
    ...current,
    ...definedPatch({ enabled: action.enabled, value: action.value }),
    participantIds: configuredParticipants(current.participantIds, action.participantIds, allPlayerIds),
  };
}

function patchCounterBet(
  current: BetConfig["fish"],
  action: Extract<RoundSetupAction, { type: "configure_core_bet" }>,
  allPlayerIds: string[],
) {
  return {
    ...patchValueConfig(current, action, allPlayerIds),
    ...definedPatch({
      secondNinePressed: action.secondNinePressed,
      secondNineMultiplier: action.secondNineMultiplier,
    }),
  };
}

function patchCoreBet(draft: RoundSetupDraft, action: Extract<RoundSetupAction, { type: "configure_core_bet" }>) {
  const ids = draft.players.map((player) => player.id);
  switch (action.bet) {
    case "monkey": {
      const fallback = initialBets(ids).monkey!;
      const current = draft.bets.monkey ?? fallback;
      draft.bets.monkey = {
        ...patchValueConfig(current, action, ids.slice(0, 3)),
        participantIds: action.participantIds
          ? [...action.participantIds]
          : configuredParticipants(current.participantIds, undefined, ids.slice(0, 3)),
      };
      return;
    }
    case "rabbits":
      draft.bets.rabbits = patchValueConfig(draft.bets.rabbits, action, ids);
      return;
    case "skins":
      draft.bets.skins = {
        ...patchValueConfig(draft.bets.skins, action, ids),
        ...(action.skinsMode ? { mode: action.skinsMode, accumulate: action.skinsMode === "carry" } : {}),
      };
      return;
    case "units":
      draft.bets.units = patchValueConfig(draft.bets.units, action, ids);
      return;
    case "miniPolla":
      draft.bets.miniPolla = patchValueConfig(draft.bets.miniPolla, action, ids);
      return;
    case "vipers":
      draft.bets.vipers = patchCounterBet(draft.bets.vipers, action, ids);
      return;
    case "camels":
      draft.bets.camels = patchCounterBet(draft.bets.camels, action, ids);
      return;
    case "fish":
      draft.bets.fish = patchCounterBet(draft.bets.fish, action, ids);
      return;
    case "loba":
      draft.bets.loba = patchValueConfig(draft.bets.loba, action, ids);
      return;
    case "foursome": {
      const current = draft.bets.foursome;
      const moneyPatch: Partial<BetConfig["foursome"]> = action.value === undefined
        ? {}
        : current.mode === "points" ? { pointValue: action.value } : { fixedValue: action.value };
      draft.bets.foursome = {
        ...current,
        ...definedPatch({ enabled: action.enabled }),
        ...moneyPatch,
        participantIds: configuredParticipants(current.participantIds, action.participantIds, ids),
      };
      draft.segments = normalizeFoursomeSegments(
        draft.segments,
        playOrder(draft.startHole).slice(0, draft.roundHoles),
        draft.bets.foursome.segmentSize,
      );
    }
  }
}

export function executeRoundSetupAction(draft: RoundSetupDraft, action: RoundSetupAction): ExecuteRoundSetupActionsResult {
  return executeRoundSetupActions(draft, [action]);
}

/** Applies only fields present in validated actions; every input object is cloned. */
export function executeRoundSetupActions(draft: RoundSetupDraft, actions: readonly RoundSetupAction[]): ExecuteRoundSetupActionsResult {
  const next = cloneRoundSetupDraft(draft);
  const applied: RoundSetupAction[] = [];
  const rejected: RejectedRoundSetupAction[] = [];

  actions.forEach((action, index) => {
    const validation = validateRoundSetupAction(action, next);
    if (!validation.valid) {
      rejected.push({ index, action, validation });
      return;
    }

    switch (action.type) {
      case "replace_players": {
        const previousIds = new Set(next.players.map((player) => player.id));
        const nextIds = action.players.map((player) => player.id);
        const sameIdentities = previousIds.size === nextIds.length && nextIds.every((id) => previousIds.has(id));
        next.players = structuredClone(action.players);
        next.ownerId = action.ownerId;
        if (!sameIdentities) {
          next.bets = initialBets(nextIds);
          next.personalBets = [];
          next.supplementalBets = [];
          next.manualBets = [];
          next.ballFriendSetup = {};
          next.segments = normalizeFoursomeSegments([], playOrder(next.startHole).slice(0, next.roundHoles), next.bets.foursome.segmentSize);
          delete next.templateOrigin;
          delete next.basedOnRoundId;
        }
        break;
      }
      case "set_player_handicap":
        next.players = next.players.map((player) => player.id === action.playerId
          ? { ...player, handicap: action.handicap }
          : player);
        break;
      case "identify_course":
        next.course = null;
        next.courseSelected = false;
        next.courseIdentity = {
          name: action.courseName,
          ...(action.catalogCourseId ? { catalogCourseId: action.catalogCourseId } : {}),
          candidateCourseIds: [...action.candidateCourseIds],
        };
        break;
      case "select_course":
        next.course = structuredClone(action.course);
        next.courseSelected = true;
        next.courseIdentity = {
          name: action.course.name,
          ...(action.course.catalogCourseId ? { catalogCourseId: action.course.catalogCourseId } : {}),
          candidateCourseIds: [action.course.id],
        };
        break;
      case "set_start_hole":
        next.startHole = action.startHole;
        next.segments = normalizeFoursomeSegments(
          next.segments,
          playOrder(next.startHole).slice(0, next.roundHoles),
          next.bets.foursome.segmentSize,
        );
        break;
      case "set_round_holes": {
        next.roundHoles = action.roundHoles;
        next.personalBets = personalNassauBetsForRoundHoles(next.personalBets, action.roundHoles);
        next.supplementalBets = supplementalBetsForRoundHoles(next.supplementalBets, action.roundHoles);
        if (action.roundHoles === 9) {
          next.bets.polla = {
            ...next.bets.polla,
            second9: { ...next.bets.polla.second9, enabled: false },
            total18: { ...next.bets.polla.total18, enabled: false },
          };
        }
        const order = playOrder(next.startHole).slice(0, action.roundHoles);
        const played = new Set(order);
        next.ballFriendSetup = Object.fromEntries(Object.entries(next.ballFriendSetup)
          .filter(([hole]) => played.has(Number(hole)))
          .map(([hole, setup]) => [Number(hole), setup]));
        next.segments = normalizeFoursomeSegments(next.segments, order, next.bets.foursome.segmentSize);
        break;
      }
      case "set_handicap_basis":
        next.handicapBasis = action.handicapBasis;
        break;
      case "configure_core_bet":
        patchCoreBet(next, action);
        break;
      case "configure_group_nassau": {
        const ids = next.players.map((player) => player.id);
        const componentScope = action.componentScope ? new Set(action.componentScope) : undefined;
        const patch = <T extends BetConfig["polla"]["first9"]>(
          current: T,
          available: boolean,
          component: "first9" | "second9" | "total18",
        ) => componentScope && !componentScope.has(component) ? current : ({
          ...current,
          ...definedPatch({
            enabled: action.enabled === undefined ? undefined : action.enabled && available,
            value: action.value,
            hcpPct: action.hcpPct,
            decimals: action.decimals,
          }),
          participantIds: configuredParticipants(
            current.participantIds,
            action.participantIdsByComponent?.[component] ?? action.participantIds,
            ids,
          ),
        });
        next.bets.polla = {
          first9: patch(next.bets.polla.first9, true, "first9"),
          second9: patch(next.bets.polla.second9, next.roundHoles === 18, "second9"),
          total18: patch(next.bets.polla.total18, next.roundHoles === 18, "total18"),
        };
        if (action.source === "explicit") {
          next.presentation = { version: 1, ...next.presentation, groupNassauTerm: "nassau" };
        }
        break;
      }
      case "configure_polla_component": {
        const ids = next.players.map((player) => player.id);
        const current = next.bets.polla[action.component];
        next.bets.polla = {
          ...next.bets.polla,
          [action.component]: {
            ...current,
            ...definedPatch({ enabled: action.enabled, value: action.value, hcpPct: action.hcpPct, decimals: action.decimals }),
            participantIds: configuredParticipants(current.participantIds, action.participantIds, ids),
          },
        };
        if (action.source === "explicit") {
          next.presentation = { version: 1, ...next.presentation, groupNassauTerm: "polla" };
        }
        break;
      }
      case "configure_individual_nassau": {
        const pairIncludesOwner = action.playerAId === next.ownerId || action.playerBId === next.ownerId;
        const rivalId = action.playerAId === next.ownerId ? action.playerBId : action.playerAId;
        const personalIndex = pairIncludesOwner
          ? next.personalBets.findIndex((bet) => bet.rivalMode === "group" && bet.rivalPlayerId === rivalId)
          : -1;
        if (personalIndex >= 0) {
          const current = next.personalBets[personalIndex];
          next.personalBets[personalIndex] = {
            ...current,
            ...definedPatch({ enabled: action.enabled, baseValue: action.value }),
            components: personalNassauComponentsForRoundHoles(current.components, next.roundHoles),
          };
          break;
        }
        const matchingIndex = next.supplementalBets.findIndex((bet) => bet.type === "individual_nassau"
          && new Set([bet.playerAId, bet.playerBId]).size === 2
          && bet.playerAId !== bet.playerBId
          && [bet.playerAId, bet.playerBId].includes(action.playerAId)
          && [bet.playerAId, bet.playerBId].includes(action.playerBId));
        if (matchingIndex >= 0) {
          const current = next.supplementalBets[matchingIndex];
          if (current.type === "individual_nassau") {
            next.supplementalBets[matchingIndex] = {
              ...current,
              ...definedPatch({ enabled: action.enabled, value: action.value }),
              playerAId: action.playerAId,
              playerBId: action.playerBId,
              components: personalNassauComponentsForRoundHoles(current.components, next.roundHoles),
            };
          }
        } else if (action.enabled !== false) {
          const created = createSupplementalBet("individual_nassau", next.players, action.id, next.roundHoles);
          if (created.type === "individual_nassau") {
            const configured = {
              ...created,
              ...definedPatch({ enabled: action.enabled, value: action.value }),
              playerAId: action.playerAId,
              playerBId: action.playerBId,
            };
            const migrated = migrateSupplementalNassau({
              ownerId: next.ownerId,
              startHole: next.startHole,
              players: next.players,
              personalBets: next.personalBets,
              supplementalBets: [...next.supplementalBets, configured],
            });
            next.personalBets = migrated.personalBets;
            next.supplementalBets = migrated.supplementalBets;
          }
        }
        break;
      }
      case "configure_ball_friend": {
        const ids = next.players.map((player) => player.id);
        next.bets.ballFriend = {
          ...next.bets.ballFriend,
          ...definedPatch({ enabled: action.enabled, value: action.value }),
          participantIds: configuredParticipants(next.bets.ballFriend.participantIds, action.participantIds, ids),
        };
        if (action.teamA) {
          next.ballFriendSetup = Object.fromEntries(playOrder(next.startHole).slice(0, next.roundHoles)
            .map((hole) => [hole, { teamA: [...action.teamA!] }]));
        }
        break;
      }
      case "upsert_supplemental_bet": {
        const index = next.supplementalBets.findIndex((bet) => bet.id === action.bet.id);
        if (index >= 0) next.supplementalBets[index] = structuredClone(action.bet);
        else next.supplementalBets.push(structuredClone(action.bet));
        break;
      }
      case "remove_nassau":
        next.bets.polla = {
          first9: { ...next.bets.polla.first9, enabled: false },
          second9: { ...next.bets.polla.second9, enabled: false },
          total18: { ...next.bets.polla.total18, enabled: false },
        };
        next.personalBets = next.personalBets.map((bet) => ({ ...bet, enabled: false }));
        next.supplementalBets = next.supplementalBets.map((bet) => bet.type === "individual_nassau"
          ? { ...bet, enabled: false }
          : bet);
        break;
    }
    applied.push(action);
  });

  return { draft: next, applied, rejected };
}
