import type { RoundSetupAction, RoundSetupQuestion } from "../schemas/actions";
import { validateRoundSetupDraft, type RoundSetupDraft, type RoundSetupDraftIssue } from "../schemas/round-setup";
import { executeRoundSetupActions, type RejectedRoundSetupAction } from "./action-executor";
import { resolveRoundSetupContext, type RoundSetupMemoryContext, type RoundSetupMemoryTrace } from "./context-resolver";
import { parseRoundSetupIntent } from "./intent-parser";

export type RoundSetupPlan = {
  draft: RoundSetupDraft;
  actions: RoundSetupAction[];
  questions: RoundSetupQuestion[];
  configurationIssues: RoundSetupDraftIssue[];
  rejectedActions: RejectedRoundSetupAction[];
  memory: RoundSetupMemoryTrace[];
  canConfirm: boolean;
  interpretation: ReturnType<typeof parseRoundSetupIntent>;
};

/** Full pure pipeline: language -> context -> validated actions -> canonical draft. */
export function planRoundSetup(input: string, context: RoundSetupMemoryContext): RoundSetupPlan {
  const interpretation = parseRoundSetupIntent(input);
  const resolved = resolveRoundSetupContext(interpretation, context);
  const execution = executeRoundSetupActions(resolved.baseDraft, resolved.actions);
  const questions = [...resolved.questions];
  for (const rejection of execution.rejected) {
    questions.push({
      code: "invalid_action",
      field: rejection.action.type,
      prompt: rejection.validation.message,
    });
  }
  const configurationIssues = validateRoundSetupDraft(execution.draft);
  return {
    draft: execution.draft,
    actions: execution.applied,
    questions,
    configurationIssues,
    rejectedActions: execution.rejected,
    memory: resolved.memory,
    canConfirm: questions.length === 0 && configurationIssues.length === 0,
    interpretation,
  };
}
